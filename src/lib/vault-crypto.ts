// Vault crypto: passphrase → KEK → AES-GCM wrap/unwrap of the DEK, plus
// AES-GCM secret encryption. All AES primitives are WebCrypto; Argon2id
// is provided by `hash-wasm` (WASM, works in browser + Node).
//
// KDF versions supported
// ----------------------
// v1 (legacy, still readable):
//   PBKDF2-SHA256, 600k iterations, 16-byte salt.
//   `kdf_algorithm` string: "PBKDF2-SHA256-600k".
//
// v2 (default for new vaults + all re-wraps):
//   Argon2id, m=19456 KiB (~19 MiB), t=2, p=1, 16-byte salt.
//   These are OWASP 2024's memory-constrained recommendation, which is
//   the right tradeoff for a mobile-first PWA: strong GPU resistance
//   without OOM'ing older phones.
//   `kdf_algorithm` string: "argon2id-m19456-t2-p1"
//   Params are encoded in the string so we can retune later (e.g. bump
//   to m=65536) without a schema migration; every read parses the
//   string it stored with.
//
// Migration path
// --------------
// On a successful v1 unlock the caller can invoke `upgradeKdfToV2` to
// re-wrap the exact same DEK under Argon2id, then persist the new
// (salt, wrapped, iv, algorithm) tuple. The DEK itself never changes,
// so every existing ciphertext in `vault_accounts` remains valid — this
// is a KEK rotation, not a key rotation.
//
// Absolutely NEVER change what an existing algorithm string means. If
// you want new params, mint a new string (`argon2id-m65536-t3-p1`, etc.)
// and add a new branch to `deriveKekForAlgorithm`. Reinterpreting an
// existing string would silently lock every user who stored it.

import { argon2id } from "hash-wasm";

// -----------------------------------------------------------------------------
// VERSIONING CONTRACT
// -----------------------------------------------------------------------------
// VAULT_CRYPTO_VERSION pins the *default* stored-form primitives for new
// vaults. Older algorithms remain readable indefinitely — see the dispatch
// in `deriveKekForAlgorithm`.
//
// v1: PBKDF2-SHA256, 600k iterations, 16-byte salt, AES-GCM 12-byte iv.
// v2 (current default): Argon2id (m=19MiB, t=2, p=1) + everything else same.
export const VAULT_CRYPTO_VERSION = 2 as const;

// Algorithm identifier strings — literal values are part of the on-disk
// contract, do not rename or reformat them.
export const KDF_ALGO_V1 = "PBKDF2-SHA256-600k";
export const KDF_ALGO_V2 = "argon2id-m19456-t2-p1";

// Params baked into KDF_ALGO_V2. Bump by minting a new string.
const ARGON2_V2 = { memoryKiB: 19_456, iterations: 2, parallelism: 1 } as const;

const PBKDF2_ITERATIONS = 600_000;

// Back-compat alias — some routes still import `KDF_ALGORITHM` expecting
// the current default. Prefer the version-specific constants above.
export const KDF_ALGORITHM = KDF_ALGO_V2;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

/* -------------------- KDF dispatch -------------------- */

interface Argon2Params {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

/**
 * Parse "argon2id-m<mem>-t<iter>-p<par>" into params. Returns null when
 * the string doesn't match — caller decides what to do (typically:
 * refuse to unlock).
 */
function parseArgon2Algo(algo: string): Argon2Params | null {
  const m = /^argon2id-m(\d+)-t(\d+)-p(\d+)$/.exec(algo);
  if (!m) return null;
  const memoryKiB = Number(m[1]);
  const iterations = Number(m[2]);
  const parallelism = Number(m[3]);
  if (!Number.isFinite(memoryKiB) || !Number.isFinite(iterations) || !Number.isFinite(parallelism)) {
    return null;
  }
  // Guard against absurd values that could hang or crash the tab. These
  // ceilings are far above anything we'd ever legitimately store.
  if (memoryKiB > 1_048_576 || iterations > 32 || parallelism > 16) return null;
  return { memoryKiB, iterations, parallelism };
}

async function deriveKekPbkdf2(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey", "encrypt", "decrypt"],
  );
}

async function deriveKekArgon2id(
  passphrase: string,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<CryptoKey> {
  // hash-wasm returns the raw 32-byte hash; import as AES-GCM 256.
  const raw = await argon2id({
    password: passphrase.normalize("NFKC"),
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memoryKiB,
    hashLength: 32,
    outputType: "binary",
  });
  return crypto.subtle.importKey(
    "raw",
    raw as unknown as BufferSource,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey", "encrypt", "decrypt"],
  );
}

async function deriveKekForAlgorithm(
  passphrase: string,
  salt: Uint8Array,
  algorithm: string,
): Promise<CryptoKey> {
  if (algorithm === KDF_ALGO_V1) return deriveKekPbkdf2(passphrase, salt);
  const params = parseArgon2Algo(algorithm);
  if (params) return deriveKekArgon2id(passphrase, salt, params);
  throw new Error(
    `Vault was created with an unsupported key algorithm (${algorithm}). Please update the app.`,
  );
}

/* -------------------- create / unwrap / rewrap -------------------- */

/**
 * Create a brand-new vault key. Always uses the current default KDF
 * (v2 / Argon2id). Returns everything the caller needs to persist plus
 * a runtime, non-extractable DEK.
 */
export async function createNewVaultKey(passphrase: string): Promise<{
  salt: Uint8Array;
  wrappedKey: Uint8Array;
  wrappedKeyIv: Uint8Array;
  dek: CryptoKey;
  kdfAlgorithm: string;
}> {
  const salt = randomBytes(16);
  const kek = await deriveKekForAlgorithm(passphrase, salt, KDF_ALGO_V2);

  const dek = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // extractable so we can wrap it
    ["encrypt", "decrypt"],
  );

  const iv = randomBytes(12);
  const wrapped = await crypto.subtle.wrapKey("raw", dek, kek, {
    name: "AES-GCM",
    iv: iv as unknown as BufferSource,
  });

  // Re-import DEK as non-extractable for runtime use.
  const rawDek = await crypto.subtle.exportKey("raw", dek);
  const runtimeDek = await crypto.subtle.importKey(
    "raw",
    rawDek,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  return {
    salt,
    wrappedKey: new Uint8Array(wrapped),
    wrappedKeyIv: iv,
    dek: runtimeDek,
    kdfAlgorithm: KDF_ALGO_V2,
  };
}

/**
 * Unwrap an existing vault key. The `algorithm` argument picks the KDF —
 * legacy PBKDF2 vaults still unlock alongside the new Argon2id default.
 *
 * Overload: the legacy 4-arg call site (no algorithm) is preserved and
 * defaults to the current version, matching pre-v2 behaviour.
 */
export async function unwrapVaultKey(
  passphrase: string,
  salt: Uint8Array,
  wrappedKey: Uint8Array,
  wrappedKeyIv: Uint8Array,
  algorithm: string = KDF_ALGO_V2,
): Promise<CryptoKey> {
  const kek = await deriveKekForAlgorithm(passphrase, salt, algorithm);
  return crypto.subtle.unwrapKey(
    "raw",
    wrappedKey as unknown as BufferSource,
    kek,
    { name: "AES-GCM", iv: wrappedKeyIv as unknown as BufferSource },
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Rotate the master passphrase. The DEK stays the same (every existing
 * ciphertext remains valid); we re-wrap it under a fresh KEK derived from
 * the new passphrase. The output KDF is always the current default —
 * rotating a v1 vault also upgrades it to v2 as a side effect.
 */
export async function rewrapVaultKey(
  currentPassphrase: string,
  newPassphrase: string,
  currentSalt: Uint8Array,
  currentWrappedKey: Uint8Array,
  currentWrappedKeyIv: Uint8Array,
  currentAlgorithm: string = KDF_ALGO_V2,
): Promise<{
  salt: Uint8Array;
  wrappedKey: Uint8Array;
  wrappedKeyIv: Uint8Array;
  kdfAlgorithm: string;
}> {
  const oldKek = await deriveKekForAlgorithm(currentPassphrase, currentSalt, currentAlgorithm);
  const dek = await crypto.subtle.unwrapKey(
    "raw",
    currentWrappedKey as unknown as BufferSource,
    oldKek,
    { name: "AES-GCM", iv: currentWrappedKeyIv as unknown as BufferSource },
    { name: "AES-GCM", length: 256 },
    true, // extractable so we can wrap under the new KEK
    ["encrypt", "decrypt"],
  );
  const newSalt = randomBytes(16);
  const newKek = await deriveKekForAlgorithm(newPassphrase, newSalt, KDF_ALGO_V2);
  const newIv = randomBytes(12);
  const wrapped = await crypto.subtle.wrapKey("raw", dek, newKek, {
    name: "AES-GCM",
    iv: newIv as unknown as BufferSource,
  });
  return {
    salt: newSalt,
    wrappedKey: new Uint8Array(wrapped),
    wrappedKeyIv: newIv,
    kdfAlgorithm: KDF_ALGO_V2,
  };
}

/* -------------------- v1 → v2 in-place upgrade -------------------- */

export function needsKdfUpgrade(algorithm: string): boolean {
  return algorithm !== KDF_ALGO_V2;
}

/**
 * Re-wrap the same DEK under Argon2id (v2) after a successful v1 unlock.
 * Callers pass the plaintext passphrase they just used to unlock — we
 * never touch storage, only produce the new tuple. Caller persists it.
 *
 * This is intentionally separate from `rewrapVaultKey` (which changes the
 * passphrase); this function keeps the same passphrase and only upgrades
 * the KDF.
 */
export async function upgradeKdfToV2(
  passphrase: string,
  currentSalt: Uint8Array,
  currentWrappedKey: Uint8Array,
  currentWrappedKeyIv: Uint8Array,
  currentAlgorithm: string,
): Promise<{
  salt: Uint8Array;
  wrappedKey: Uint8Array;
  wrappedKeyIv: Uint8Array;
  kdfAlgorithm: string;
}> {
  return rewrapVaultKey(
    passphrase,
    passphrase,
    currentSalt,
    currentWrappedKey,
    currentWrappedKeyIv,
    currentAlgorithm,
  );
}

/* -------------------- secret encryption -------------------- */

export async function encryptSecret(
  dek: CryptoKey,
  plaintext: string,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    dek,
    enc.encode(plaintext),
  );
  return { ciphertext: new Uint8Array(ct), iv };
}

export async function decryptSecret(
  dek: CryptoKey,
  ciphertext: Uint8Array,
  iv: Uint8Array,
): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    dek,
    ciphertext as unknown as BufferSource,
  );
  return dec.decode(pt);
}

/* -------------------- bytea helpers -------------------- */

// Supabase `bytea` round-trips as either a Uint8Array (already binary) or a
// hex-prefixed string like "\\x0102..", or a base64 string. Normalize all.
export function toBytes(input: unknown): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === "string") {
    if (input.startsWith("\\x") || /^[0-9a-fA-F]+$/.test(input)) {
      const hex = input.startsWith("\\x") ? input.slice(2) : input;
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    }
    // Fallback: base64
    const bin = atob(input);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (
    input &&
    typeof input === "object" &&
    "type" in (input as object) &&
    (input as { type?: string }).type === "Buffer"
  ) {
    return new Uint8Array((input as { data: number[] }).data);
  }
  throw new Error("Unsupported bytea payload");
}

// Encode Uint8Array as Postgres bytea hex literal ("\x0102..") — the format
// PostgREST accepts on insert. Passing a Uint8Array directly to supabase-js
// gets JSON-stringified into {"0":1,...} which silently corrupts the row.
export function toByteaHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return "\\x" + hex;
}
