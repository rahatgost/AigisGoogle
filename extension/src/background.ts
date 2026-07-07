/**
 * MV3 service worker (Phase 10.2).
 *
 * The SW owns three responsibilities:
 *
 *   1. **In-memory unlocked vault** — a plaintext account list handed in
 *      by the web app via `SYNC_VAULT` (external, allow-listed origin
 *      only). Cleared automatically after `IDLE_LOCK_MS` of inactivity
 *      so a compromised popup can't exfiltrate secrets indefinitely.
 *
 *   2. **TOTP generation** — computes the current code on demand using
 *      `otpauth` (same library the web app uses, so the code path is
 *      byte-identical). Secrets never leave the SW.
 *
 *   3. **Clipboard auto-clear** — when the user hits "Copy", the SW
 *      returns the code to the caller (content script or popup) and
 *      arms a 30 s alarm. When the alarm fires, we tell the caller to
 *      overwrite the clipboard with an empty string. Best-effort:
 *      if the tab is gone we can't reach it, but the browser will
 *      typically clear on focus loss anyway.
 */

/// <reference types="chrome" />

import * as OTPAuth from "otpauth";
import type { Algorithm, DecryptedAccount, OtpType } from "@/lib/vault-accounts";
import { rankMatches, normalizeHost } from "@/lib/domain-match";

/* --------------------------------------------------------------------- */
/*  Types                                                                */
/* --------------------------------------------------------------------- */

// A trimmed shape of `DecryptedAccount` that the extension actually needs.
// Keeping this narrower than the web-app type means the SYNC_VAULT payload
// can't accidentally include fields (cache flags, sort orders) that are
// meaningless outside the vault UI.
export interface ExtAccount {
  id: string;
  issuer: string;
  label: string;
  secret: string; // base32
  algorithm: Algorithm;
  digits: number;
  period: number;
  otp_type: OtpType;
}

interface UnlockedState {
  accounts: ExtAccount[];
  expiresAt: number; // epoch ms
  userId: string;
  syncedAt: number; // epoch ms of last SYNC_VAULT
  syncSeq: number;  // monotonic counter set by the web app
}

export type Message =
  | { type: "PING" }
  | { type: "GET_VERSION" }
  | { type: "GET_STATE" }
  | { type: "GET_PAIRING" }
  | { type: "LOCK" }
  | {
      type: "SYNC_VAULT";
      userId: string;
      accounts: ExtAccount[];
      ttlMs?: number;
      syncSeq?: number;
      ts?: number;
      nonce?: string;
      sig?: string;
    }
  | { type: "MATCH_HOST"; host: string }
  | { type: "GET_CODE"; accountId: string }
  | { type: "CLIPBOARD_ARMED"; tabId: number; accountId: string };


export type Response =
  | { ok: true; [k: string]: unknown }
  | { ok: false; error: string };

/* --------------------------------------------------------------------- */
/*  State                                                                */
/* --------------------------------------------------------------------- */

const IDLE_LOCK_MS = 5 * 60 * 1000;
const CLIPBOARD_CLEAR_MS = 30 * 1000;

/**
 * Verbose SW logging for heartbeat / eviction / lock testing.
 * See docs/extension-heartbeat-test.md. Flip to false to silence.
 */
const SW_DEBUG = true;
function swLog(...args: unknown[]): void {
  if (SW_DEBUG) console.log("[aegis-sw]", ...args);
}

// Held in the SW's globalThis. MV3 will evict this when the worker is
// suspended (~30 s of idleness) — that's a feature, not a bug: the vault
// re-locks itself when nobody's looking.
let unlocked: UnlockedState | null = null;

// Track which tab holds a code we asked to clear, so we don't wipe the
// clipboard while the user is copying on a different site.
const pendingClears = new Map<number, { accountId: string; alarmName: string }>();

function isUnlocked(): boolean {
  if (!unlocked) return false;
  if (Date.now() > unlocked.expiresAt) {
    unlocked = null;
    void updateBadge();
    return false;
  }
  return true;
}

function touch() {
  if (unlocked) unlocked.expiresAt = Date.now() + IDLE_LOCK_MS;
}

/* --------------------------------------------------------------------- */
/*  Toolbar badge / title reflects lock state                            */
/* --------------------------------------------------------------------- */

async function updateBadge(): Promise<void> {
  try {
    if (isUnlocked() && unlocked) {
      await chrome.action.setBadgeBackgroundColor({ color: "#3c8c5a" });
      await chrome.action.setBadgeText({ text: String(unlocked.accounts.length) });
      await chrome.action.setTitle({
        title: `Aegis · ${unlocked.accounts.length} account${unlocked.accounts.length === 1 ? "" : "s"} unlocked`,
      });
    } else {
      await chrome.action.setBadgeBackgroundColor({ color: "#b47a2d" });
      await chrome.action.setBadgeText({ text: "" });
      await chrome.action.setTitle({ title: "Aegis · locked" });
    }
  } catch {
    /* action API may be unavailable during SW startup on Firefox */
  }
}

/* --------------------------------------------------------------------- */
/*  Origin allow-list (defence-in-depth vs `externally_connectable`)      */
/* --------------------------------------------------------------------- */

// Baked at build time from VITE_APP_URL / VITE_APP_PREVIEW_URL — see
// `extension/vite.config.ts`. Kept in sync with
// manifest.externally_connectable.matches by the same build step. Wildcard
// *.lovable.app is intentionally NOT here — every Lovable project would
// otherwise be able to push a vault at us.
declare const __AEGIS_APP_ORIGIN__: string;
declare const __AEGIS_APP_PREVIEW_ORIGIN__: string;

const ALLOWED_EXTERNAL_ORIGINS: ReadonlySet<string> = new Set(
  [__AEGIS_APP_ORIGIN__, __AEGIS_APP_PREVIEW_ORIGIN__, "http://localhost:8080"].filter(
    (o): o is string => typeof o === "string" && o.length > 0,
  ),
);

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  return ALLOWED_EXTERNAL_ORIGINS.has(origin);
}



/* --------------------------------------------------------------------- */
/*  Rate limiting + payload validation for external messages             */
/* --------------------------------------------------------------------- */

const SYNC_MIN_INTERVAL_MS = 1000;
const MAX_ACCOUNTS = 500;
const MAX_ISSUER_LEN = 256;
const MAX_LABEL_LEN = 256;
const MAX_SECRET_LEN = 512; // base32 secret; 512 fits any realistic issuer
const MAX_USERID_LEN = 128;
const ALLOWED_ALGORITHMS: ReadonlySet<string> = new Set(["SHA1", "SHA256", "SHA512"]);
const ALLOWED_OTP_TYPES: ReadonlySet<string> = new Set(["totp", "hotp", "steam"]);

const lastSyncAtByOrigin = new Map<string, number>();

function checkRate(origin: string): boolean {
  const now = Date.now();
  const last = lastSyncAtByOrigin.get(origin) ?? 0;
  if (now - last < SYNC_MIN_INTERVAL_MS) return false;
  lastSyncAtByOrigin.set(origin, now);
  return true;
}

function validateAccount(a: unknown): a is ExtAccount {
  if (!a || typeof a !== "object") return false;
  const o = a as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length === 0 || o.id.length > 128) return false;
  if (typeof o.issuer !== "string" || o.issuer.length > MAX_ISSUER_LEN) return false;
  if (typeof o.label !== "string" || o.label.length > MAX_LABEL_LEN) return false;
  if (typeof o.secret !== "string" || o.secret.length === 0 || o.secret.length > MAX_SECRET_LEN) return false;
  if (typeof o.algorithm !== "string" || !ALLOWED_ALGORITHMS.has(o.algorithm)) return false;
  if (typeof o.digits !== "number" || !Number.isInteger(o.digits) || o.digits < 4 || o.digits > 10) return false;
  if (typeof o.period !== "number" || !Number.isInteger(o.period) || o.period < 5 || o.period > 300) return false;
  if (typeof o.otp_type !== "string" || !ALLOWED_OTP_TYPES.has(o.otp_type)) return false;
  return true;
}

/* --------------------------------------------------------------------- */
/*  Pairing key + HMAC anti-replay (PR 3)                                */
/* --------------------------------------------------------------------- */
/*
 * Defence-in-depth on top of `externally_connectable`. The SW mints a
 * random 32-byte key on first install and persists it in
 * chrome.storage.local. Any allow-listed origin can fetch it once via
 * GET_PAIRING. Subsequent SYNC_VAULT calls MUST include:
 *   - ts    : epoch-ms, must be within ±60 s of the SW clock
 *   - nonce : opaque string (≤64 chars), single-use per 5-min window
 *   - sig   : hex HMAC-SHA256 over the canonical string below
 *
 * canonical = `SYNC_VAULT\n${userId}\n${syncSeq}\n${ts}\n${nonce}\n${sha256(JSON.stringify(cleanedAccounts))}`
 *
 * A hostile script that lands on an allow-listed origin still has the
 * pairing key (both share localStorage on that origin), so HMAC is not
 * a confidentiality boundary — it exists to make replay attacks and
 * tampered-in-transit payloads impossible.
 */

const PAIRING_STORAGE_KEY = "aegisPairingKey";
const HMAC_MAX_SKEW_MS = 60_000;
const NONCE_TTL_MS = 5 * 60_000;
const nonceCache = new Map<string, number>();

let cachedPairingKey: string | null = null;

async function getPairingKey(): Promise<string> {
  if (cachedPairingKey) return cachedPairingKey;
  const stored = await chrome.storage.local.get(PAIRING_STORAGE_KEY);
  const existing = stored[PAIRING_STORAGE_KEY];
  if (typeof existing === "string" && existing.length >= 32) {
    cachedPairingKey = existing;
    return existing;
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes));
  await chrome.storage.local.set({ [PAIRING_STORAGE_KEY]: b64 });
  cachedPairingKey = b64;
  swLog("pairing key generated");
  return b64;
}
// Warm the cache on SW start so verifySig can be synchronous-ish after boot.
void getPairingKey();

function sweepNonces(now: number): void {
  if (nonceCache.size < 256) return;
  for (const [n, t] of nonceCache) {
    if (now - t > NONCE_TTL_MS) nonceCache.delete(n);
  }
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(keyB64: string, msg: string): Promise<string> {
  const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySyncSig(
  keyB64: string,
  msg: { userId: string; syncSeq: number; ts: number; nonce: string; sig: string; accounts: ExtAccount[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = Date.now();
  if (!Number.isFinite(msg.ts) || Math.abs(now - msg.ts) > HMAC_MAX_SKEW_MS) {
    return { ok: false, error: "stale_ts" };
  }
  if (typeof msg.nonce !== "string" || msg.nonce.length === 0 || msg.nonce.length > 64) {
    return { ok: false, error: "bad_nonce" };
  }
  sweepNonces(now);
  if (nonceCache.has(msg.nonce)) return { ok: false, error: "replay" };
  if (typeof msg.sig !== "string" || msg.sig.length !== 64) {
    return { ok: false, error: "bad_sig_shape" };
  }
  const accountsDigest = await sha256Hex(JSON.stringify(msg.accounts));
  const canonical = `SYNC_VAULT\n${msg.userId}\n${msg.syncSeq}\n${msg.ts}\n${msg.nonce}\n${accountsDigest}`;
  const expected = await hmacHex(keyB64, canonical);
  if (!constantTimeEq(expected, msg.sig)) return { ok: false, error: "bad_sig" };
  nonceCache.set(msg.nonce, now);
  return { ok: true };
}

/* --------------------------------------------------------------------- */
/*  TOTP                                                                 */
/* --------------------------------------------------------------------- */

function generateCode(account: ExtAccount): string {
  if (account.otp_type === "hotp") {
    throw new Error("HOTP not supported in extension");
  }
  const totp = new OTPAuth.TOTP({
    issuer: account.issuer,
    label: account.label,
    algorithm: account.algorithm,
    digits: account.digits,
    period: account.period,
    secret: OTPAuth.Secret.fromBase32(account.secret),
  });
  return totp.generate();
}

/* --------------------------------------------------------------------- */
/*  Handlers                                                             */
/* --------------------------------------------------------------------- */

// SYNC_VAULT / GET_PAIRING are async (crypto.subtle + chrome.storage).
async function handle(msg: Message, sender: chrome.runtime.MessageSender): Promise<Response> {
  switch (msg.type) {
    case "PING":
      return { ok: true };

    case "GET_VERSION":
      return { ok: true, version: chrome.runtime.getManifest().version };

    case "GET_PAIRING": {
      const pairingKey = await getPairingKey();
      swLog("GET_PAIRING issued");
      return { ok: true, pairingKey };
    }

    case "GET_STATE": {
      const unlockedNow = isUnlocked();
      touch();
      swLog("GET_STATE", { unlocked: unlockedNow, seq: unlockedNow ? unlocked!.syncSeq : 0, count: unlockedNow ? unlocked!.accounts.length : 0 });
      return {
        ok: true,
        unlocked: unlockedNow,
        accountCount: unlockedNow ? unlocked!.accounts.length : 0,
        expiresAt: unlockedNow ? unlocked!.expiresAt : 0,
        // syncSeq lets the web app detect a stale extension cache without
        // shipping any account contents — it's just a monotonic counter
        // the web app owns. Zero means "never synced this SW lifetime".
        syncSeq: unlockedNow ? unlocked!.syncSeq : 0,
        syncedAt: unlockedNow ? unlocked!.syncedAt : 0,
        userId: unlockedNow ? unlocked!.userId : "",
      };
    }

    case "LOCK":
      swLog("LOCK requested");
      unlocked = null;
      return { ok: true };

    case "SYNC_VAULT": {
      if (typeof msg.userId !== "string" || msg.userId.length === 0 || msg.userId.length > MAX_USERID_LEN) {
        swLog("SYNC_VAULT reject: bad_user_id");
        return { ok: false, error: "bad_user_id" };
      }
      if (!Array.isArray(msg.accounts)) { swLog("SYNC_VAULT reject: bad_payload"); return { ok: false, error: "bad_payload" }; }
      if (msg.accounts.length > MAX_ACCOUNTS) { swLog("SYNC_VAULT reject: too_many_accounts", msg.accounts.length); return { ok: false, error: "too_many_accounts" }; }
      let seq = 0;
      if (msg.syncSeq !== undefined) {
        if (
          typeof msg.syncSeq !== "number" ||
          !Number.isFinite(msg.syncSeq) ||
          msg.syncSeq < 0 ||
          !Number.isInteger(msg.syncSeq)
        ) {
          swLog("SYNC_VAULT reject: bad_sync_seq", msg.syncSeq);
          return { ok: false, error: "bad_sync_seq" };
        }
        seq = msg.syncSeq;
      }
      const cleaned: ExtAccount[] = [];
      for (const raw of msg.accounts) {
        if (!validateAccount(raw)) { swLog("SYNC_VAULT reject: bad_account_shape"); return { ok: false, error: "bad_account_shape" }; }
        cleaned.push(raw);
      }
      // HMAC gate — see the pairing block above for the canonical string.
      // Required for every external call. Popup / same-extension pushes
      // (rare — the popup does not push) may omit and use origin trust.
      const isExternal = !!sender.origin && sender.id !== chrome.runtime.id;
      if (isExternal) {
        if (typeof msg.ts !== "number" || typeof msg.nonce !== "string" || typeof msg.sig !== "string") {
          swLog("SYNC_VAULT reject: unsigned external call");
          return { ok: false, error: "unsigned" };
        }
        const key = await getPairingKey();
        const verdict = await verifySyncSig(key, {
          userId: msg.userId,
          syncSeq: seq,
          ts: msg.ts,
          nonce: msg.nonce,
          sig: msg.sig,
          accounts: cleaned,
        });
        if (!verdict.ok) {
          swLog("SYNC_VAULT reject:", verdict.error);
          return { ok: false, error: verdict.error };
        }
      }
      const ttl = Math.min(Math.max(msg.ttlMs ?? IDLE_LOCK_MS, 30_000), IDLE_LOCK_MS);
      const now = Date.now();
      unlocked = {
        accounts: cleaned,
        userId: msg.userId,
        expiresAt: now + ttl,
        syncedAt: now,
        syncSeq: seq,
      };
      swLog("SYNC_VAULT ok", { seq, count: cleaned.length, ttlMs: ttl, signed: isExternal });
      return { ok: true, accountCount: cleaned.length, syncSeq: seq, syncedAt: now };
    }


    case "MATCH_HOST": {
      if (!isUnlocked()) return { ok: false, error: "locked" };
      touch();
      const host = normalizeHost(msg.host);
      if (!host) return { ok: true, matches: [] };
      const ranked = rankMatches(host, unlocked!.accounts);
      return {
        ok: true,
        matches: ranked.map((r) => ({
          id: r.account.id,
          issuer: r.account.issuer,
          label: r.account.label,
          score: r.score,
        })),
      };
    }

    case "GET_CODE": {
      if (!isUnlocked()) return { ok: false, error: "locked" };
      touch();
      const acct = unlocked!.accounts.find((a) => a.id === msg.accountId);
      if (!acct) return { ok: false, error: "not_found" };
      try {
        const code = generateCode(acct);
        return { ok: true, code, period: acct.period };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "totp_error" };
      }
    }

    case "CLIPBOARD_ARMED": {
      // Content script has just written a code to the clipboard on
      // behalf of a user. Schedule the 30 s clear here so a page reload
      // in the source tab can't cancel it.
      const tabId = msg.tabId ?? sender.tab?.id;
      if (typeof tabId !== "number") return { ok: false, error: "no_tab" };
      const alarmName = `clip-clear-${tabId}-${Date.now()}`;
      pendingClears.set(tabId, { accountId: msg.accountId, alarmName });
      chrome.alarms.create(alarmName, { when: Date.now() + CLIPBOARD_CLEAR_MS });
      return { ok: true, clearInMs: CLIPBOARD_CLEAR_MS };
    }

    default:
      return { ok: false, error: "unknown_message" };
  }
}

/* --------------------------------------------------------------------- */
/*  Wiring                                                               */
/* --------------------------------------------------------------------- */

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("aegis-keepalive", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "aegis-keepalive") {
    void chrome.storage.local.get("__aegis_touch");
    // Also GC the unlocked vault if idle.
    if (unlocked && Date.now() > unlocked.expiresAt) {
      swLog("TTL expired, clearing unlocked vault");
      unlocked = null;
    }
    return;
  }
  if (alarm.name.startsWith("clip-clear-")) {
    for (const [tabId, entry] of pendingClears.entries()) {
      if (entry.alarmName !== alarm.name) continue;
      pendingClears.delete(tabId);
      // Ask the content script in that tab to overwrite the clipboard.
      chrome.tabs
        .sendMessage(tabId, { type: "CLEAR_CLIPBOARD" })
        .catch(() => {
          /* tab probably closed — nothing we can do from the SW */
        });
    }
  }
});

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  handle(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : "error" }));
  return true; // keep the port open for the async response
});

chrome.runtime.onMessageExternal.addListener((msg: Message, sender, sendResponse) => {
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : undefined);
  if (!originAllowed(origin)) {
    swLog("external reject: forbidden_origin", origin);
    sendResponse({ ok: false, error: "forbidden_origin" });
    return;
  }
  // External senders may only sync, pair, or query state — never mint codes.
  const externalAllowed: ReadonlySet<string> = new Set([
    "SYNC_VAULT",
    "GET_STATE",
    "GET_PAIRING",
    "PING",
    "LOCK",
  ]);
  if (!externalAllowed.has(msg.type)) {
    swLog("external reject: forbidden_message", msg.type);
    sendResponse({ ok: false, error: "forbidden_message" });
    return;
  }
  if (msg.type === "SYNC_VAULT" && !checkRate(origin!)) {
    swLog("SYNC_VAULT rate_limited", origin);
    sendResponse({ ok: false, error: "rate_limited" });
    return;
  }
  handle(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : "error" }));
  return true;
});

// Re-exported for the popup's typed sendMessage.
export type { DecryptedAccount };
