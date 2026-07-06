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
}

export type Message =
  | { type: "PING" }
  | { type: "GET_VERSION" }
  | { type: "GET_STATE" }
  | { type: "LOCK" }
  | { type: "SYNC_VAULT"; userId: string; accounts: ExtAccount[]; ttlMs?: number }
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
    return false;
  }
  return true;
}

function touch() {
  if (unlocked) unlocked.expiresAt = Date.now() + IDLE_LOCK_MS;
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

function handle(msg: Message, sender: chrome.runtime.MessageSender): Response {
  switch (msg.type) {
    case "PING":
      return { ok: true };

    case "GET_VERSION":
      return { ok: true, version: chrome.runtime.getManifest().version };

    case "GET_STATE": {
      const unlockedNow = isUnlocked();
      touch();
      return {
        ok: true,
        unlocked: unlockedNow,
        accountCount: unlockedNow ? unlocked!.accounts.length : 0,
        expiresAt: unlockedNow ? unlocked!.expiresAt : 0,
      };
    }

    case "LOCK":
      unlocked = null;
      return { ok: true };

    case "SYNC_VAULT": {
      if (typeof msg.userId !== "string" || msg.userId.length === 0 || msg.userId.length > MAX_USERID_LEN) {
        return { ok: false, error: "bad_user_id" };
      }
      if (!Array.isArray(msg.accounts)) return { ok: false, error: "bad_payload" };
      if (msg.accounts.length > MAX_ACCOUNTS) return { ok: false, error: "too_many_accounts" };
      // Validate every row; reject the whole batch on any failure so we
      // never store a partially-corrupt vault.
      const cleaned: ExtAccount[] = [];
      for (const raw of msg.accounts) {
        if (!validateAccount(raw)) return { ok: false, error: "bad_account_shape" };
        cleaned.push(raw);
      }
      const ttl = Math.min(Math.max(msg.ttlMs ?? IDLE_LOCK_MS, 30_000), IDLE_LOCK_MS);
      unlocked = {
        accounts: cleaned,
        userId: msg.userId,
        expiresAt: Date.now() + ttl,
      };
      return { ok: true, accountCount: cleaned.length };
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
    if (unlocked && Date.now() > unlocked.expiresAt) unlocked = null;
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
  try {
    sendResponse(handle(msg, sender));
  } catch (e) {
    sendResponse({ ok: false, error: e instanceof Error ? e.message : "error" });
  }
  return true;
});

chrome.runtime.onMessageExternal.addListener((msg: Message, sender, sendResponse) => {
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : undefined);
  if (!originAllowed(origin)) {
    sendResponse({ ok: false, error: "forbidden_origin" });
    return;
  }
  // External senders may only sync or query state — never mint codes
  // (that path is popup/content-script only, to keep code emission tied
  // to a user action inside the extension surface).
  if (msg.type !== "SYNC_VAULT" && msg.type !== "GET_STATE" && msg.type !== "PING" && msg.type !== "LOCK") {
    sendResponse({ ok: false, error: "forbidden_message" });
    return;
  }
  // Rate-limit SYNC_VAULT per origin to make a hostile script that lands
  // on an allow-listed origin unable to spam the SW with vault swaps.
  if (msg.type === "SYNC_VAULT" && !checkRate(origin!)) {
    sendResponse({ ok: false, error: "rate_limited" });
    return;
  }
  try {
    sendResponse(handle(msg, sender));
  } catch (e) {
    sendResponse({ ok: false, error: e instanceof Error ? e.message : "error" });
  }
});

// Re-exported for the popup's typed sendMessage.
export type { DecryptedAccount };
