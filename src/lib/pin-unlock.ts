/**
 * PIN quick-unlock for Aegis vault.
 *
 * Security model
 * --------------
 * A 4–6 digit PIN is much weaker than a master passphrase, so PIN unlock is
 * strictly a *device-local* convenience gate. The user must first unlock with
 * their master passphrase; we then wrap the DEK a second time under a
 * PIN-derived key and stash the blob in localStorage on this device only.
 *
 *   PIN + per-blob salt --PBKDF2(600k, SHA-256)--> AES-GCM wrap key
 *   wrap key + iv       --AES-GCM.wrapKey---------> wrappedDek
 *
 * Brute-force protection
 * ----------------------
 * A malicious script with localStorage access could try every 4–6 digit PIN
 * offline. We can't stop that, but we CAN stop casual brute-force on the
 * user's own device: after 5 consecutive failed attempts we wipe the blob,
 * forcing a fresh master-passphrase unlock. The failed-attempt counter
 * lives in the same JSON blob so it's tied to the credential.
 *
 * PIN never leaves the device. It is not synced, not persisted server-side,
 * and never leaves this module in plaintext.
 */

import { randomBytes } from "@/lib/vault-crypto";

const PIN_STORAGE_PREFIX = "aegis.pin.v1.";
const MAX_ATTEMPTS = 5;
const PIN_KDF_ITERATIONS = 600_000;

interface StoredPin {
  v: 1;
  salt: string; // base64
  wrappedDek: string; // base64
  wrappedDekIv: string; // base64
  attempts: number; // failed attempts since last success
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

/* ---------------- storage helpers ---------------- */

function storageKey(userId: string): string {
  return PIN_STORAGE_PREFIX + userId;
}

function readBlob(userId: string): StoredPin | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPin;
    if (parsed.v !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBlob(userId: string, blob: StoredPin): void {
  window.localStorage.setItem(storageKey(userId), JSON.stringify(blob));
}

/* ---------------- public API ---------------- */

export function isPinEnabled(userId: string): boolean {
  return readBlob(userId) !== null;
}

export function getPinAttemptsRemaining(userId: string): number {
  const blob = readBlob(userId);
  if (!blob) return MAX_ATTEMPTS;
  return Math.max(0, MAX_ATTEMPTS - blob.attempts);
}

export function disablePin(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
}

/**
 * Validate PIN format. Digits only, length 4-6.
 */
export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

/**
 * Detects PINs that are trivial to brute-force even under a rate limit:
 * all-same digits, ascending/descending sequences, and a small hand-picked
 * common list. Returns a human-readable reason when weak, else null.
 */
export function assessPinWeakness(pin: string): string | null {
  if (!isValidPin(pin)) return "PIN must be 4–6 digits.";

  // All same digit: 0000, 1111, ...
  if (/^(\d)\1+$/.test(pin)) {
    return "PIN can't be all the same digit.";
  }

  // Ascending or descending sequences: 1234, 123456, 4321, 987654, ...
  let asc = true;
  let desc = true;
  for (let i = 1; i < pin.length; i++) {
    const d = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (d !== 1) asc = false;
    if (d !== -1) desc = false;
  }
  if (asc || desc) return "PIN can't be a simple sequence like 1234.";

  // Common leaked-PIN list (short curated set).
  const common = new Set([
    "1212", "0101", "1010", "1122", "2211", "1313", "2020", "6969", "4321",
    "1004", "2000", "1004", "0007", "2580", "5683", "7777", "0852",
    "123123", "121212", "112233", "101010", "112211", "159753", "147258",
    "789456", "456789", "252525", "159357", "013579", "246810",
  ]);
  if (common.has(pin)) return "That PIN is too common. Please choose another.";

  return null;
}

/* ---------------- KDF ---------------- */

async function deriveWrapKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: PIN_KDF_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/* ---------------- enroll ---------------- */

export async function enrollPin(params: {
  userId: string;
  pin: string;
  dek: CryptoKey;
}): Promise<void> {
  const weakness = assessPinWeakness(params.pin);
  if (weakness) throw new Error(weakness);

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const wrapKey = await deriveWrapKey(params.pin, salt);
  const wrapped = await crypto.subtle.wrapKey("raw", params.dek, wrapKey, {
    name: "AES-GCM",
    iv: iv as unknown as BufferSource,
  });

  const blob: StoredPin = {
    v: 1,
    salt: bytesToB64(salt),
    wrappedDek: bytesToB64(new Uint8Array(wrapped)),
    wrappedDekIv: bytesToB64(iv),
    attempts: 0,
    createdAt: Date.now(),
  };
  writeBlob(params.userId, blob);
}

/* ---------------- unlock ---------------- */

export class PinUnlockError extends Error {
  code: "not-enrolled" | "wrong-pin" | "locked-out";
  attemptsRemaining: number;
  constructor(
    code: "not-enrolled" | "wrong-pin" | "locked-out",
    message: string,
    attemptsRemaining: number,
  ) {
    super(message);
    this.code = code;
    this.attemptsRemaining = attemptsRemaining;
  }
}

export async function unlockWithPin(userId: string, pin: string): Promise<CryptoKey> {
  const blob = readBlob(userId);
  if (!blob) {
    throw new PinUnlockError("not-enrolled", "PIN unlock isn't set up on this device.", 0);
  }

  const salt = b64ToBytes(blob.salt);
  const iv = b64ToBytes(blob.wrappedDekIv);
  const wrapped = b64ToBytes(blob.wrappedDek);

  try {
    const wrapKey = await deriveWrapKey(pin, salt);
    const dek = await crypto.subtle.unwrapKey(
      "raw",
      wrapped as unknown as BufferSource,
      wrapKey,
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    // Success — clear the failure counter.
    if (blob.attempts !== 0) {
      writeBlob(userId, { ...blob, attempts: 0 });
    }
    return dek;
  } catch {
    // Wrong PIN. Increment counter; wipe if we hit the ceiling.
    const nextAttempts = blob.attempts + 1;
    if (nextAttempts >= MAX_ATTEMPTS) {
      disablePin(userId);
      throw new PinUnlockError(
        "locked-out",
        "Too many wrong PIN attempts. PIN unlock has been disabled on this device — please use your passphrase.",
        0,
      );
    }
    writeBlob(userId, { ...blob, attempts: nextAttempts });
    const remaining = MAX_ATTEMPTS - nextAttempts;
    throw new PinUnlockError(
      "wrong-pin",
      `Wrong PIN. ${remaining} ${remaining === 1 ? "attempt" : "attempts"} remaining.`,
      remaining,
    );
  }
}
