// Vault crypto: PBKDF2 (SHA-256, 600k iterations — OWASP baseline) key
// derivation, AES-GCM wrap/unwrap for the Data Encryption Key (DEK), and
// AES-GCM secret encryption. All primitives are WebCrypto — no extra deps.
//
// Design:
// - Passphrase + per-user salt → KEK (256-bit AES-GCM).
// - Random 256-bit DEK is generated once, wrapped by KEK, stored server-side
//   as `vault_meta.recovery_wrapped_key` (+ iv).
// - Every TOTP secret is encrypted with the DEK using AES-GCM (fresh iv).
// - Passphrase never leaves the device. Losing it = permanent code loss.
//
// PBKDF2 is a pragmatic default (native, no WASM). Argon2id can drop in
// later by swapping deriveKekFromPassphrase without changing storage shape.

// -----------------------------------------------------------------------------
// VERSIONING CONTRACT
// -----------------------------------------------------------------------------
// VAULT_CRYPTO_VERSION pins the stored-form primitives of the vault:
//   - KDF (algorithm + parameters + salt length)
//   - DEK wrap shape (AES-GCM, iv length, tag length)
//   - Secret encryption shape (AES-GCM, iv length, AAD binding)
//
// ANY change to any of the above (e.g. Argon2id migration, adding AAD binding,
// changing iv length) MUST bump this constant AND ship a migrator that
// re-derives / re-wraps / re-encrypts existing rows. Never mutate a primitive
// silently — clients on the old version would irretrievably lose access.
//
// v1 (current): PBKDF2-SHA256, 600k iterations, 16-byte salt, AES-GCM 12-byte
//               iv, no AAD. OWASP baseline as of 2024.
// v2 (planned): Argon2id (m=64MiB, t=3, p=1) + AAD binding = user_id||account_id.
export const VAULT_CRYPTO_VERSION = 1 as const;

const PBKDF2_ITERATIONS = 600_000;
const KDF_ALGO = "PBKDF2-SHA256-600k";

const enc = new TextEncoder();
const dec = new TextDecoder();

export const KDF_ALGORITHM = KDF_ALGO;

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

async function deriveKekFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
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

export async function createNewVaultKey(passphrase: string): Promise<{
  salt: Uint8Array;
  wrappedKey: Uint8Array;
  wrappedKeyIv: Uint8Array;
  dek: CryptoKey;
  rawDek: Uint8Array;
  kdfAlgorithm: string;
}> {
  const salt = randomBytes(16);
  const kek = await deriveKekFromPassphrase(passphrase, salt);

  // Generate the DEK as raw random bytes so we can keep a copy in memory
  // for downstream device-local wrapping (PIN / biometric) without ever
  // marking the imported CryptoKey `extractable`. AES-GCM.wrapKey with a
  // "raw" format is byte-identical to encrypting the raw key material, so
  // the on-disk format is unchanged.
  const rawDek = randomBytes(32);
  const iv = randomBytes(12);
  const wrapped = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    kek,
    rawDek as unknown as BufferSource,
  );

  const dek = await crypto.subtle.importKey(
    "raw",
    rawDek as unknown as BufferSource,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable — raw bytes are held separately in memory
    ["encrypt", "decrypt"],
  );

  return {
    salt,
    wrappedKey: new Uint8Array(wrapped),
    wrappedKeyIv: iv,
    dek,
    rawDek,
    kdfAlgorithm: KDF_ALGO,
  };
}

export async function unwrapVaultKey(
  passphrase: string,
  salt: Uint8Array,
  wrappedKey: Uint8Array,
  wrappedKeyIv: Uint8Array,
): Promise<{ dek: CryptoKey; rawDek: Uint8Array }> {
  const kek = await deriveKekFromPassphrase(passphrase, salt);
  // Decrypt to raw bytes rather than unwrapping to a CryptoKey, so we can
  // (a) hand the caller a non-extractable DEK CryptoKey, and (b) keep the
  // raw bytes in memory for device-local re-wrapping under a PIN /
  // biometric key. Ciphertext is identical to AES-GCM.wrapKey("raw", …).
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: wrappedKeyIv as unknown as BufferSource },
      kek,
      wrappedKey as unknown as BufferSource,
    ),
  );
  const dek = await crypto.subtle.importKey(
    "raw",
    plaintext as unknown as BufferSource,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return { dek, rawDek: plaintext };
}

// Rotate the master passphrase without changing the DEK itself. The DEK
// stays the same, so every existing ciphertext in `vault_accounts` remains
// valid — we only re-wrap it with a fresh KEK derived from the new
// passphrase and a fresh salt.
export async function rewrapVaultKey(
  currentPassphrase: string,
  newPassphrase: string,
  currentSalt: Uint8Array,
  currentWrappedKey: Uint8Array,
  currentWrappedKeyIv: Uint8Array,
): Promise<{
  salt: Uint8Array;
  wrappedKey: Uint8Array;
  wrappedKeyIv: Uint8Array;
  kdfAlgorithm: string;
}> {
  const oldKek = await deriveKekFromPassphrase(currentPassphrase, currentSalt);
  const rawDek = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: currentWrappedKeyIv as unknown as BufferSource },
      oldKek,
      currentWrappedKey as unknown as BufferSource,
    ),
  );
  const newSalt = randomBytes(16);
  const newKek = await deriveKekFromPassphrase(newPassphrase, newSalt);
  const newIv = randomBytes(12);
  const wrapped = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: newIv as unknown as BufferSource },
    newKek,
    rawDek as unknown as BufferSource,
  );
  // Best-effort scrub of the transient plaintext copy.
  rawDek.fill(0);
  return {
    salt: newSalt,
    wrappedKey: new Uint8Array(wrapped),
    wrappedKeyIv: newIv,
    kdfAlgorithm: KDF_ALGO,
  };
}


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
