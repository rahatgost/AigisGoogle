// Biometric (WebAuthn PRF) lock → unlock → enroll integration test.
//
// The real flow uses a platform authenticator (Touch ID / Windows Hello) that
// exposes the PRF extension. In tests we install a deterministic PRF
// simulator: for a given (credentialId, prfSalt) pair it always returns the
// same 32 bytes, which is exactly what a real authenticator does. That lets
// enroll() wrap the DEK and unlock() unwrap it back byte-for-byte.
//
// What this test proves:
//   1. enrollBiometric accepts raw DEK bytes (mirrors the PIN flow refactor).
//   2. After lockVault() clears the in-memory DEK, unlockWithBiometric()
//      recovers the SAME 32-byte DEK from the stored wrapped blob.
//   3. Ciphertext produced with the original DEK still decrypts under the
//      DEK returned by biometric unlock — i.e. switching sessions
//      (lock → unlock via biometrics) preserves access to old data.

import { describe, it, expect, beforeEach } from "vitest";
import {
  createNewVaultKey,
  encryptSecret,
  decryptSecret,
} from "./vault-crypto";
import {
  setVaultKey,
  getVaultKey,
  getVaultRawKey,
  lockVault,
  isVaultUnlocked,
} from "./vault-session";

// ---- window + WebAuthn PRF mock -------------------------------------------

interface FakeCredential {
  rawId: ArrayBuffer;
  getClientExtensionResults: () => {
    prf?: { results?: { first?: ArrayBuffer } };
  };
}

// Deterministic PRF: HMAC-SHA256(credentialId, prfSalt) → 32 bytes. Matches
// the real authenticator contract (same input → same output every time).
async function prfEval(credentialId: Uint8Array, salt: Uint8Array): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    credentialId as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, salt as unknown as BufferSource);
}

function installWebAuthnMock() {
  // Persistent credential store across create/get in a single test.
  let storedCredentialId: Uint8Array | null = null;

  const fakeAuthenticator = {
    async create(opts: {
      publicKey: {
        extensions?: { prf?: { eval?: { first?: BufferSource } } };
      };
    }): Promise<FakeCredential> {
      const credId = crypto.getRandomValues(new Uint8Array(16));
      storedCredentialId = credId;
      const saltBuf = opts.publicKey.extensions?.prf?.eval?.first;
      const salt = saltBuf ? new Uint8Array(saltBuf as ArrayBuffer) : new Uint8Array();
      const prfOut = await prfEval(credId, salt);
      return {
        rawId: new Uint8Array(credId).buffer as ArrayBuffer,
        getClientExtensionResults: () => ({ prf: { results: { first: prfOut } } }),
      };
    },
    async get(opts: {
      publicKey: {
        allowCredentials?: Array<{ id: BufferSource }>;
        extensions?: { prf?: { eval?: { first?: BufferSource } } };
      };
    }): Promise<FakeCredential> {
      const idBuf = opts.publicKey.allowCredentials?.[0]?.id;
      const credId = idBuf
        ? new Uint8Array(idBuf as ArrayBuffer)
        : (storedCredentialId ?? new Uint8Array(16));
      const saltBuf = opts.publicKey.extensions?.prf?.eval?.first;
      const salt = saltBuf ? new Uint8Array(saltBuf as ArrayBuffer) : new Uint8Array();
      const prfOut = await prfEval(credId, salt);
      return {
        rawId: new Uint8Array(credId).buffer as ArrayBuffer,
        getClientExtensionResults: () => ({ prf: { results: { first: prfOut } } }),
      };
    },
  };

  const fakeWindow = {
    localStorage: globalThis.localStorage,
    setTimeout,
    clearTimeout,
    location: { hostname: "localhost" },
    PublicKeyCredential: {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
    },
  };

  Object.defineProperty(globalThis, "window", {
    value: fakeWindow,
    configurable: true,
    writable: true,
  });

  // navigator.credentials — the module calls it directly (not via window).
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true, credentials: fakeAuthenticator },
    configurable: true,
    writable: true,
  });
}

installWebAuthnMock();

// Now that the mock is in place, import the module under test. (Import
// after mock setup so any module-scope reads see the fakes.)
const { enrollBiometric, unlockWithBiometric, isBiometricEnabled, disableBiometric } =
  await import("./biometric");

const USER_ID = "test-user-bio";
const USER_EMAIL = "bio@example.com";
const PASSPHRASE = "correct horse battery staple";

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

beforeEach(() => {
  globalThis.localStorage.clear();
  lockVault();
});

describe("biometric: lock → unlock → enroll integration", () => {
  it("recovers the same DEK after lock, and old ciphertext still decrypts", async () => {
    // 1. Onboard: create a vault, snapshot the raw DEK, and hydrate the session.
    const created = await createNewVaultKey(PASSPHRASE);
    const originalDek = new Uint8Array(created.rawDek);
    setVaultKey(created.dek, created.rawDek);
    expect(isVaultUnlocked()).toBe(true);

    // 2. Encrypt a secret with the runtime DEK — this is the "old ciphertext"
    //    we'll try to decrypt after switching sessions via biometrics.
    const oldCipher = await encryptSecret(getVaultKey()!, "JBSWY3DPEHPK3PXP");

    // 3. User enables biometric unlock. Uses raw bytes from the session,
    //    mirroring the PIN refactor — no extractable DEK required.
    const dekBytes = getVaultRawKey()!;
    await enrollBiometric({ userId: USER_ID, userEmail: USER_EMAIL, dekBytes });
    expect(isBiometricEnabled(USER_ID)).toBe(true);

    // 4. Simulate session end: lock the vault. Raw DEK is zeroed & dropped.
    lockVault();
    expect(isVaultUnlocked()).toBe(false);
    expect(getVaultRawKey()).toBeNull();

    // 5. New session: unlock via biometrics. Must recover the SAME DEK bytes.
    const unlocked = await unlockWithBiometric(USER_ID);
    expect(unlocked.dek.extractable).toBe(false);
    expect(bytesEqual(originalDek, unlocked.rawDek)).toBe(true);

    // 6. Hydrate the session with the recovered DEK and decrypt the old
    //    ciphertext produced before the lock. This is the core invariant:
    //    switching sessions (fresh unlock) must never lose access to data.
    setVaultKey(unlocked.dek, unlocked.rawDek);
    const restored = await decryptSecret(getVaultKey()!, oldCipher.ciphertext, oldCipher.iv);
    expect(restored).toBe("JBSWY3DPEHPK3PXP");

    // 7. And a fresh encrypt/decrypt still round-trips under the new DEK.
    const newCipher = await encryptSecret(getVaultKey()!, "second-secret");
    expect(await decryptSecret(getVaultKey()!, newCipher.ciphertext, newCipher.iv)).toBe(
      "second-secret",
    );
  });

  it("rejects a bad-length DEK payload without writing enrollment", async () => {
    await expect(
      enrollBiometric({
        userId: USER_ID,
        userEmail: USER_EMAIL,
        dekBytes: new Uint8Array(16),
      }),
    ).rejects.toThrow(/invalid vault key/i);
    expect(isBiometricEnabled(USER_ID)).toBe(false);
  });

  it("disableBiometric wipes the blob so unlock reports not-set-up", async () => {
    const { rawDek } = await createNewVaultKey(PASSPHRASE);
    await enrollBiometric({ userId: USER_ID, userEmail: USER_EMAIL, dekBytes: rawDek });
    expect(isBiometricEnabled(USER_ID)).toBe(true);

    const result = disableBiometric(USER_ID);
    expect(result.removed).toBe(true);
    expect(isBiometricEnabled(USER_ID)).toBe(false);

    await expect(unlockWithBiometric(USER_ID)).rejects.toThrow(/isn't set up/i);
  });
});
