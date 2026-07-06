/**
 * Web-app → browser-extension bridge (Phase 10.2 handoff).
 *
 * When the vault is unlocked in the web app, this helper can push the
 * decrypted account list to the Aegis extension's service worker via
 * `chrome.runtime.sendMessage` (works cross-origin because the
 * extension's manifest lists this app's origin in `externally_connectable`).
 *
 * The SW keeps the accounts in memory for at most `ttlMs` (capped at
 * 5 min server-side); after that the extension is locked again and the
 * user must resync from the web app.
 *
 * This module intentionally has NO side effects at import time. It's a
 * pure function that returns `{ ok: false, reason: 'no_extension' }`
 * when Chrome APIs aren't present, so it's safe to call from any
 * environment (SSR, sandbox preview, tests).
 */

import type { DecryptedAccount } from "@/lib/vault-accounts";

/**
 * Read the extension's runtime ID from the DOM. The Aegis extension's
 * `announce.js` content script stamps `data-aegis-extension-id` on
 * <html> at document_start when it's installed, so any user who has
 * the extension gets auto-detected — no hardcoded ID, no config.
 */
function discoverExtensionId(): string | null {
  if (typeof document === "undefined") return null;
  const id = document.documentElement?.dataset?.aegisExtensionId;
  return id && id.length > 0 ? id : null;
}

export function isExtensionInstalled(): boolean {
  return discoverExtensionId() !== null;
}

type SendResult =
  | { ok: true; accountCount: number; syncSeq: number }
  | { ok: false; reason: "no_extension" | "no_id" | "send_failed"; detail?: string };

export type ExtensionState =
  | { ok: true; unlocked: boolean; accountCount: number; expiresAt: number; syncSeq: number; syncedAt: number; userId: string }
  | { ok: false; reason: "no_extension" | "no_id" | "send_failed"; detail?: string };

interface ChromeRuntimeLike {
  sendMessage: (
    id: string,
    msg: unknown,
    cb: (res: Record<string, unknown> | undefined) => void,
  ) => void;
  lastError?: { message?: string };
}

function getRuntime(): ChromeRuntimeLike | null {
  if (typeof globalThis === "undefined") return null;
  const g = globalThis as { chrome?: { runtime?: ChromeRuntimeLike } };
  return g.chrome?.runtime ?? null;
}

function stripToExtShape(a: DecryptedAccount) {
  return {
    id: a.id,
    issuer: a.issuer,
    label: a.label,
    secret: a.secret,
    algorithm: a.algorithm,
    digits: a.digits,
    period: a.period,
    otp_type: a.otp_type,
  };
}

/**
 * Module-local monotonic sync counter. Bumped on every successful
 * `syncVaultToExtension` so the heartbeat can detect that the extension
 * is running with a stale vault (SW restart, TTL expiry, another tab
 * pushed a newer copy).
 */
let LOCAL_SYNC_SEQ = 0;

export function getLocalSyncSeq(): number {
  return LOCAL_SYNC_SEQ;
}

/* ------------------------------------------------------------------ */
/*  Pairing key + HMAC signing (PR 3 defence-in-depth)                */
/* ------------------------------------------------------------------ */

const PAIRING_LS_PREFIX = "aegis:ext:pairing:";

const pairingCache = new Map<string, string>();

function readPairing(extId: string): string | null {
  if (pairingCache.has(extId)) return pairingCache.get(extId)!;
  try {
    const v = localStorage.getItem(PAIRING_LS_PREFIX + extId);
    if (v) pairingCache.set(extId, v);
    return v;
  } catch {
    return null;
  }
}

function storePairing(extId: string, key: string): void {
  pairingCache.set(extId, key);
  try {
    localStorage.setItem(PAIRING_LS_PREFIX + extId, key);
  } catch {
    /* private browsing */
  }
}

function clearPairing(extId: string): void {
  pairingCache.delete(extId);
  try {
    localStorage.removeItem(PAIRING_LS_PREFIX + extId);
  } catch {
    /* ignore */
  }
}

async function fetchPairingKey(runtime: ChromeRuntimeLike, extId: string): Promise<string | null> {
  const res = await new Promise<Record<string, unknown> | undefined>((resolve) => {
    try {
      runtime.sendMessage(extId, { type: "GET_PAIRING" }, (r) => resolve(r));
    } catch {
      resolve(undefined);
    }
  });
  if (res && res.ok && typeof res.pairingKey === "string" && res.pairingKey.length >= 32) {
    storePairing(extId, res.pairingKey);
    return res.pairingKey;
  }
  return null;
}

async function ensurePairingKey(runtime: ChromeRuntimeLike, extId: string): Promise<string | null> {
  const cached = readPairing(extId);
  if (cached) return cached;
  return fetchPairingKey(runtime, extId);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(buf: ArrayBuffer): string {
  const arr = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, "0");
  return s;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return bytesToHex(buf);
}

async function hmacHex(keyB64: string, msg: string): Promise<string> {
  const rawKey = b64ToBytes(keyB64);
  // Copy into a fresh ArrayBuffer so TS's stricter BufferSource typing accepts it.
  const keyBuf = new ArrayBuffer(rawKey.byteLength);
  new Uint8Array(keyBuf).set(rawKey);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return bytesToHex(sig);
}

function randomNonce(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}


export async function syncVaultToExtension(params: {
  userId: string;
  accounts: DecryptedAccount[];
  ttlMs?: number;
  /** Override the extension ID list (test seams). */
  extensionIds?: readonly string[];
}): Promise<SendResult> {
  const runtime = getRuntime();
  if (!runtime) return { ok: false, reason: "no_extension" };

  const discovered = discoverExtensionId();
  const ids = params.extensionIds ?? (discovered ? [discovered] : []);
  if (ids.length === 0) return { ok: false, reason: "no_id" };

  const totp = params.accounts
    .filter((a) => a.otp_type !== "hotp")
    .map(stripToExtShape);

  const nextSeq = LOCAL_SYNC_SEQ + 1;

  for (const id of ids) {
    const result: SendResult = await new Promise((resolve) => {
      try {
        runtime.sendMessage(
          id,
          {
            type: "SYNC_VAULT",
            userId: params.userId,
            accounts: totp,
            ttlMs: params.ttlMs,
            syncSeq: nextSeq,
          },
          (res) => {
            const err = runtime.lastError?.message;
            if (err) {
              resolve({ ok: false, reason: "send_failed", detail: err });
              return;
            }
            if (res?.ok) {
              const count = typeof res.accountCount === "number" ? res.accountCount : totp.length;
              const seq = typeof res.syncSeq === "number" ? res.syncSeq : nextSeq;
              resolve({ ok: true, accountCount: count, syncSeq: seq });
            } else {
              const detail = typeof res?.error === "string" ? res.error : "unknown";
              resolve({ ok: false, reason: "send_failed", detail });
            }
          },
        );
      } catch (e) {
        resolve({
          ok: false,
          reason: "send_failed",
          detail: e instanceof Error ? e.message : "throw",
        });
      }
    });
    if (result.ok) {
      LOCAL_SYNC_SEQ = nextSeq;
      return result;
    }
  }
  return { ok: false, reason: "send_failed" };
}

/**
 * Cheap read-only ping: asks the extension SW for current state (unlocked
 * flag, account count, sync counter). Used by the heartbeat to detect SW
 * eviction / TTL expiry without shipping any vault contents.
 */
export async function pingExtensionState(extensionIds?: readonly string[]): Promise<ExtensionState> {
  const runtime = getRuntime();
  if (!runtime) return { ok: false, reason: "no_extension" };

  const discovered = discoverExtensionId();
  const ids = extensionIds ?? (discovered ? [discovered] : []);
  if (ids.length === 0) return { ok: false, reason: "no_id" };

  for (const id of ids) {
    const result: ExtensionState = await new Promise((resolve) => {
      try {
        runtime.sendMessage(id, { type: "GET_STATE" }, (res) => {
          const err = runtime.lastError?.message;
          if (err) {
            resolve({ ok: false, reason: "send_failed", detail: err });
            return;
          }
          if (!res?.ok) {
            const detail = typeof res?.error === "string" ? res.error : "unknown";
            resolve({ ok: false, reason: "send_failed", detail });
            return;
          }
          resolve({
            ok: true,
            unlocked: !!res.unlocked,
            accountCount: typeof res.accountCount === "number" ? res.accountCount : 0,
            expiresAt: typeof res.expiresAt === "number" ? res.expiresAt : 0,
            syncSeq: typeof res.syncSeq === "number" ? res.syncSeq : 0,
            syncedAt: typeof res.syncedAt === "number" ? res.syncedAt : 0,
            userId: typeof res.userId === "string" ? res.userId : "",
          });
        });
      } catch (e) {
        resolve({
          ok: false,
          reason: "send_failed",
          detail: e instanceof Error ? e.message : "throw",
        });
      }
    });
    if (result.ok) return result;
  }
  return { ok: false, reason: "send_failed" };
}

