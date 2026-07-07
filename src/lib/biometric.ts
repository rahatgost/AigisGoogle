/**
 * Biometric unlock for Aegis vault.
 *
 * Security model
 * --------------
 * We use the WebAuthn PRF extension (prf / hmac-secret). The authenticator
 * derives a per-credential secret from a fixed salt each time the user
 * successfully passes userVerification (Face ID / Touch ID / Windows Hello).
 * That secret is stretched via HKDF into an AES-GCM wrap key which unwraps
 * the DEK.
 *
 * The wrap key material is NEVER written to storage. Only the
 * credentialId, the PRF salt, and the (wrapped DEK + iv) live in
 * localStorage. An attacker with read access to localStorage cannot decrypt
 * the DEK without producing a genuine authenticator assertion, so biometric
 * unlock is a real cryptographic gate rather than a UX gate.
 *
 * If the platform authenticator does not support PRF, enrollment is
 * refused — we do not fall back to storing a plaintext wrap key. The
 * passphrase remains the source of truth in every case.
 */

import { randomBytes } from "@/lib/vault-crypto";

const BIO_STORAGE_PREFIX = "aegis.bio.v2.";
const BIO_LEGACY_PREFIX = "aegis.bio.v1.";
const BIO_PENDING_KEY = "aegis.bio.pending";

interface StoredCredential {
  v: 2;
  credentialId: string; // base64url
  prfSalt: string; // base64
  wrappedDek: string; // base64
  wrappedDekIv: string; // base64
  createdAt: number;
}

/* ---------------- base64 helpers ---------------- */

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64Url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToBytes(b64url: string): Uint8Array {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  return b64ToBytes(b64url.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

/* ---------------- support detection ---------------- */

export async function isBiometricSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!window.PublicKeyCredential) return false;
  try {
    const available =
      await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return !!available;
  } catch {
    return false;
  }
}

export function isBiometricEnabled(userId: string): boolean {
  if (typeof window === "undefined") return false;
  // Only v2 (PRF-backed) enrollments count. Legacy v1 is treated as not
  // enrolled so the UI prompts the user to re-enroll under the new model.
  return !!window.localStorage.getItem(BIO_STORAGE_PREFIX + userId);
}

/**
 * Detects a stale v1 enrollment that predates the PRF-based model.
 * Callers can surface a "please re-enable biometric unlock" message.
 */
export function hasLegacyBiometric(userId: string): boolean {
  if (typeof window === "undefined") return false;
  return !!window.localStorage.getItem(BIO_LEGACY_PREFIX + userId);
}

export function clearLegacyBiometric(userId: string): void {
  try {
    window.localStorage.removeItem(BIO_LEGACY_PREFIX + userId);
  } catch {
    /* ignore */
  }
}

/* ---------------- pending flag (set in onboarding) ---------------- */

export function markBiometricPending() {
  try {
    window.localStorage.setItem(BIO_PENDING_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearBiometricPending() {
  try {
    window.localStorage.removeItem(BIO_PENDING_KEY);
  } catch {
    /* ignore */
  }
}

export function isBiometricPending(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(BIO_PENDING_KEY) === "1";
}

/* ---------------- PRF helpers ---------------- */

/**
 * Derive an AES-GCM wrap key from raw PRF output. PRF gives us up to 32
 * bytes of authenticator-bound entropy; we run it through HKDF-SHA256 to
 * bind it to a stable info string and yield a fresh 256-bit AES key.
 */
async function wrapKeyFromPrf(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0) as unknown as BufferSource,
      info: new TextEncoder().encode("aegis.bio.v2.wrap") as unknown as BufferSource,
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}


interface PrfExtensionResults {
  prf?: { results?: { first?: ArrayBuffer } };
}

function readPrfFirst(cred: PublicKeyCredential | null): ArrayBuffer | null {
  if (!cred) return null;
  const results = (cred.getClientExtensionResults?.() ?? {}) as PrfExtensionResults;
  const first = results.prf?.results?.first;
  return first ?? null;
}

/* ---------------- enroll ---------------- */

export async function enrollBiometric(params: {
  userId: string;
  userEmail: string;
  dekBytes: Uint8Array;
}): Promise<void> {
  if (!(await isBiometricSupported())) {
    throw new Error("Biometric authentication isn't available on this device.");
  }
  if (params.dekBytes.byteLength !== 32) {
    throw new Error("Invalid vault key — please re-unlock and try again.");
  }

  const challenge = randomBytes(32);
  const userIdBytes = new TextEncoder().encode(params.userId);
  const prfSalt = randomBytes(32);

  // 1. Create the platform credential and request the PRF extension.
  //    Chromium exposes PRF output at create() time; Safari only at get().
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge as unknown as BufferSource,
      rp: { name: "Aegis", id: window.location.hostname },
      user: {
        id: userIdBytes as unknown as BufferSource,
        name: params.userEmail,
        displayName: params.userEmail,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60_000,
      attestation: "none",
      extensions: {
        prf: { eval: { first: prfSalt as unknown as BufferSource } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error("Enrollment was cancelled.");

  const credentialId = new Uint8Array(credential.rawId);

  // 2. Try to read PRF output from create(). If unavailable, immediately
  //    call get() with the same salt so the authenticator produces it.
  let prfOutput = readPrfFirst(credential);
  if (!prfOutput) {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32) as unknown as BufferSource,
        allowCredentials: [
          {
            id: credentialId as unknown as BufferSource,
            type: "public-key",
            transports: ["internal"],
          },
        ],
        userVerification: "required",
        timeout: 60_000,
        rpId: window.location.hostname,
        extensions: {
          prf: { eval: { first: prfSalt as unknown as BufferSource } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    prfOutput = readPrfFirst(assertion);
  }

  if (!prfOutput || prfOutput.byteLength < 16) {
    // No PRF support → we refuse to store a plaintext wrap key. The
    // passphrase remains the sole gate.
    throw new Error(
      "This device's biometric authenticator doesn't support secure key binding (PRF). Please continue using your passphrase.",
    );
  }

  // 3. Derive wrap key from PRF output and encrypt the raw DEK bytes.
  const wrapKey = await wrapKeyFromPrf(prfOutput);
  const iv = randomBytes(12);
  const wrapped = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    wrapKey,
    params.dekBytes as unknown as BufferSource,
  );

  const stored: StoredCredential = {
    v: 2,
    credentialId: bytesToB64Url(credentialId),
    prfSalt: bytesToB64(prfSalt),
    wrappedDek: bytesToB64(new Uint8Array(wrapped)),
    wrappedDekIv: bytesToB64(iv),
    createdAt: Date.now(),
  };

  window.localStorage.setItem(BIO_STORAGE_PREFIX + params.userId, JSON.stringify(stored));
  clearLegacyBiometric(params.userId);
  clearBiometricPending();
}


/* ---------------- unlock ---------------- */

export async function unlockWithBiometric(userId: string): Promise<CryptoKey> {
  const raw = window.localStorage.getItem(BIO_STORAGE_PREFIX + userId);
  if (!raw) {
    // Legacy v1 blobs are intentionally not honored — they leaked the wrap
    // key. Surface a clear message so the caller can prompt re-enrollment.
    if (hasLegacyBiometric(userId)) {
      clearLegacyBiometric(userId);
      throw new Error(
        "Biometric unlock was updated to a more secure model. Please re-enable it from Security settings after signing in with your passphrase.",
      );
    }
    throw new Error("Biometrics isn't set up on this device.");
  }

  const stored = JSON.parse(raw) as StoredCredential;
  if (stored.v !== 2) {
    throw new Error("Biometric setup is out of date. Please re-enable it from Security settings.");
  }

  const challenge = randomBytes(32);
  const credentialId = b64UrlToBytes(stored.credentialId);
  const prfSalt = b64ToBytes(stored.prfSalt);

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge as unknown as BufferSource,
      allowCredentials: [
        {
          id: credentialId as unknown as BufferSource,
          type: "public-key",
          transports: ["internal"],
        },
      ],
      userVerification: "required",
      timeout: 60_000,
      rpId: window.location.hostname,
      extensions: {
        prf: { eval: { first: prfSalt as unknown as BufferSource } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error("Biometric check was cancelled.");

  const prfOutput = readPrfFirst(assertion);
  if (!prfOutput || prfOutput.byteLength < 16) {
    throw new Error(
      "This device didn't return the expected biometric key material. Please unlock with your passphrase.",
    );
  }

  const wrapKey = await wrapKeyFromPrf(prfOutput);
  const iv = b64ToBytes(stored.wrappedDekIv);
  return crypto.subtle.unwrapKey(
    "raw",
    b64ToBytes(stored.wrappedDek) as unknown as BufferSource,
    wrapKey,
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/* ---------------- disable / reset ---------------- */

/**
 * Remove biometric enrollment for this user on this device. Returns a
 * verification result so callers can surface an accurate success/failure
 * message instead of assuming removal worked.
 */
export function disableBiometric(userId: string): { removed: boolean; error?: string } {
  if (typeof window === "undefined") {
    return { removed: false, error: "Storage isn't available in this context." };
  }
  const primaryKey = BIO_STORAGE_PREFIX + userId;
  const legacyKey = BIO_LEGACY_PREFIX + userId;
  const hadAny =
    window.localStorage.getItem(primaryKey) !== null ||
    window.localStorage.getItem(legacyKey) !== null;

  try {
    window.localStorage.removeItem(primaryKey);
    window.localStorage.removeItem(legacyKey);
  } catch (err) {
    return {
      removed: false,
      error: err instanceof Error ? err.message : "Storage rejected the write.",
    };
  }

  // Verify: re-read localStorage. If either key still exists, storage
  // silently rejected the delete (rare — private mode, quota, extensions).
  const stillThere =
    window.localStorage.getItem(primaryKey) !== null ||
    window.localStorage.getItem(legacyKey) !== null;
  if (stillThere) {
    return { removed: false, error: "Device storage still reports the credential." };
  }

  // hadAny=false means it was already gone — still a successful end state.
  return { removed: true, error: hadAny ? undefined : "No enrollment was present." };
}
