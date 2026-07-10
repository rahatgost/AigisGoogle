/**
 * PIN unlock for Aegis vault.
 *
 * Security model
 * --------------
 * A short PIN (4–8 digits) is stretched via PBKDF2-HMAC-SHA256 with a
 * per-user random salt to a 256-bit AES-GCM wrap key that unwraps the DEK.
 * We store only the wrapped DEK + IV + salt + PBKDF2 iterations in
 * localStorage. The PIN never leaves the device and is never persisted.
 *
 * An attacker with read access to the wrapped blob still needs to run
 * PBKDF2 (600 000 iterations) per PIN guess — combined with the app-level
 * throttle in `unlock-throttle.ts` this makes online guessing infeasible
 * and raises the cost of offline guessing meaningfully.
 *
 * If the platform lacks PBKDF2 in WebCrypto, enrollment is refused —
 * we do not fall back to a weaker derivation. The passphrase remains the
 * source of truth in every case.
 */

import { randomBytes } from "@/lib/vault-crypto";

const PIN_STORAGE_PREFIX = "aegis.pin.v1.";
const PIN_PENDING_KEY = "aegis.pin.pending";
const PBKDF2_ITERATIONS = 600_000;

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

interface StoredPin {
  v: 1;
  salt: string; // base64
  iterations: number;
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

/* ---------------- key derivation ---------------- */

async function wrapKeyFromPin(
  pin: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin) as unknown as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as unknown as BufferSource,
      iterations,
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/* ---------------- state ---------------- */

export function isPinEnabled(userId: string): boolean {
  if (typeof window === "undefined") return false;
  return !!window.localStorage.getItem(PIN_STORAGE_PREFIX + userId);
}

export function markPinPending() {
  try {
    window.localStorage.setItem(PIN_PENDING_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearPinPending() {
  try {
    window.localStorage.removeItem(PIN_PENDING_KEY);
  } catch {
    /* ignore */
  }
}

export function isPinPending(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PIN_PENDING_KEY) === "1";
}

/* ---------------- enroll / unlock / disable ---------------- */

export async function enrollPin(params: {
  userId: string;
  pin: string;
  dek: CryptoKey;
}): Promise<void> {
  if (params.pin.length < PIN_MIN_LENGTH || params.pin.length > PIN_MAX_LENGTH) {
    throw new Error(`PIN must be ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digits.`);
  }
  if (!/^\d+$/.test(params.pin)) {
    throw new Error("PIN must contain digits only.");
  }
  const salt = randomBytes(16);
  const wrapKey = await wrapKeyFromPin(params.pin, salt, PBKDF2_ITERATIONS);
  const iv = randomBytes(12);
  const wrapped = await crypto.subtle.wrapKey("raw", params.dek, wrapKey, {
    name: "AES-GCM",
    iv: iv as unknown as BufferSource,
  });
  const stored: StoredPin = {
    v: 1,
    salt: bytesToB64(salt),
    iterations: PBKDF2_ITERATIONS,
    wrappedDek: bytesToB64(new Uint8Array(wrapped)),
    wrappedDekIv: bytesToB64(iv),
    createdAt: Date.now(),
  };
  window.localStorage.setItem(PIN_STORAGE_PREFIX + params.userId, JSON.stringify(stored));
  clearPinPending();
}

export async function unlockWithPin(userId: string, pin: string): Promise<CryptoKey> {
  const raw = window.localStorage.getItem(PIN_STORAGE_PREFIX + userId);
  if (!raw) throw new Error("PIN isn't set up on this device.");
  const stored = JSON.parse(raw) as StoredPin;
  const salt = b64ToBytes(stored.salt);
  const iv = b64ToBytes(stored.wrappedDekIv);
  const wrapKey = await wrapKeyFromPin(pin, salt, stored.iterations);
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

export function disablePin(userId: string): { removed: boolean } {
  if (typeof window === "undefined") return { removed: false };
  const key = PIN_STORAGE_PREFIX + userId;
  const had = window.localStorage.getItem(key) !== null;
  try {
    window.localStorage.removeItem(key);
  } catch {
    return { removed: false };
  }
  return { removed: had || window.localStorage.getItem(key) === null };
}
