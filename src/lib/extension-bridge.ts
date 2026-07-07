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

/* ------------------------------------------------------------------ */
/*  Trusted-extension allowlist                                       */
/* ------------------------------------------------------------------ */
//
// Security invariant (fix for `ext_bridge_spoof`):
// The web app must NEVER send decrypted vault secrets to an arbitrary
// browser extension. Extension IDs advertised via DOM attributes are
// attacker-controlled — any installed extension with a content script
// on this origin can stamp `data-aegis-extension-id` on <html> and
// pretend to be Aegis. Chrome/Firefox both guarantee that a given
// extension ID can only be installed if signed by the corresponding
// store key, so pinning to an allowlist of published IDs is a strong
// defence: an attacker cannot ship an extension under our ID.
//
// The allowlist is populated at build time from the (comma-separated)
// `VITE_EXT_TRUSTED_IDS` env var, plus the hardcoded published IDs
// below (add real Chrome Web Store / Firefox Add-ons IDs here as
// listings go live). Unpacked/dev builds have unpredictable IDs, so
// developers must set `VITE_EXT_ALLOW_UNPACKED=true` to opt in; this
// logs a loud warning and MUST NEVER be enabled in production builds.

const PUBLISHED_EXTENSION_IDS: readonly string[] = [
  // Populate with the real CWS + AMO IDs once the extension is
  // published. Example shape (Chrome IDs are 32 lowercase letters;
  // Firefox IDs are UUID-style or an email-like slug):
  //   "abcdefghijklmnopabcdefghijklmnop",  // Chrome Web Store
  //   "aegis@lovable.dev",                 // Firefox Add-ons
];

function envRaw(name: string): string | undefined {
  try {
    const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
    const v = viteEnv?.[name];
    if (v !== undefined && v !== "") return v;
  } catch {
    /* import.meta.env unavailable */
  }
  try {
    // Fallback for node/test runtimes where import.meta.env isn't a proxy
    // over process.env (vitest stubs process.env, not import.meta.env, on
    // the node pool).
    const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
    const v = g.process?.env?.[name];
    if (v !== undefined && v !== "") return v;
  } catch {
    /* no process */
  }
  return undefined;
}

function envList(name: string): string[] {
  const raw = envRaw(name);
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function envFlag(name: string): boolean {
  const raw = envRaw(name);
  return raw === "true" || raw === "1";
}

const TRUSTED_EXTENSION_IDS: ReadonlySet<string> = new Set([
  ...PUBLISHED_EXTENSION_IDS,
  ...envList("VITE_EXT_TRUSTED_IDS"),
]);

const ALLOW_UNPACKED = envFlag("VITE_EXT_ALLOW_UNPACKED");

let warnedUnpacked = false;
let warnedUntrusted = false;

/**
 * Read the extension's runtime ID from the DOM and verify it is a
 * *trusted* Aegis extension before returning it. Any ID that isn't in
 * the published allowlist is refused — the caller sees "no extension
 * installed" and never sends vault data to the impersonator. Dev builds
 * can opt in via `VITE_EXT_ALLOW_UNPACKED=true`.
 */
function discoverExtensionId(): string | null {
  if (typeof document === "undefined") return null;
  const id = document.documentElement?.dataset?.aegisExtensionId;
  if (!id || id.length === 0) return null;
  if (TRUSTED_EXTENSION_IDS.has(id)) return id;
  if (ALLOW_UNPACKED) {
    if (!warnedUnpacked && typeof console !== "undefined") {
      warnedUnpacked = true;
      console.warn(
        `[aegis] Trusting unpacked/dev extension id="${id}" because ` +
          `VITE_EXT_ALLOW_UNPACKED=true. Never enable this flag in production builds.`,
      );
    }
    return id;
  }
  if (!warnedUntrusted && typeof console !== "undefined") {
    warnedUntrusted = true;
    console.warn(
      `[aegis] Refusing to sync vault to extension id="${id}": not in the ` +
        `trusted allowlist. If this is your own build, set VITE_EXT_TRUSTED_IDS ` +
        `to include it (or VITE_EXT_ALLOW_UNPACKED=true for local development).`,
    );
  }
  return null;
}

/** Test-only escape hatch so unit tests can inspect / reset warning state. */
export const __testing = {
  isTrusted: (id: string) => TRUSTED_EXTENSION_IDS.has(id),
  allowUnpacked: () => ALLOW_UNPACKED,
};

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

/**
 * Public helper for the "Re-pair" button on the Security page. Wipes the
 * cached pairing key for the currently-detected extension so the next
 * SYNC_VAULT triggers a fresh GET_PAIRING handshake.
 */
export function clearExtensionPairing(): boolean {
  const id = discoverExtensionId();
  if (!id) return false;
  clearPairing(id);
  return true;
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
    // Sign the payload. If we don't yet have a pairing key, fetch one.
    // Retry once on `bad_sig` by clearing the cached key and re-fetching
    // (SW might have regenerated on reinstall).
    let attempt = 0;
    let lastDetail: string | undefined;
    while (attempt < 2) {
      const pairingKey = await ensurePairingKey(runtime, id);
      if (!pairingKey) {
        lastDetail = "no_pairing_key";
        break;
      }
      const ts = Date.now();
      const nonce = randomNonce();
      const accountsDigest = await sha256Hex(JSON.stringify(totp));
      const canonical = `SYNC_VAULT\n${params.userId}\n${nextSeq}\n${ts}\n${nonce}\n${accountsDigest}`;
      const sig = await hmacHex(pairingKey, canonical);

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
              ts,
              nonce,
              sig,
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
      lastDetail = result.detail;
      // Only retry if the SW says our HMAC or pairing state is off.
      if (result.detail === "bad_sig" || result.detail === "unsigned") {
        clearPairing(id);
        attempt += 1;
        continue;
      }
      break;
    }
    if (lastDetail) return { ok: false, reason: "send_failed", detail: lastDetail };
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

