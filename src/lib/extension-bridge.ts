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

/** Default extension IDs. Users can add their unpacked dev extension via override. */
const AEGIS_EXTENSION_IDS: readonly string[] = [
  "obmldhfkhjgmibnkbffjpblemdkdibip",
];

type SendResult =
  | { ok: true; accountCount: number }
  | { ok: false; reason: "no_extension" | "no_id" | "send_failed"; detail?: string };

interface ChromeRuntimeLike {
  sendMessage: (
    id: string,
    msg: unknown,
    cb: (res: { ok?: boolean; accountCount?: number; error?: string } | undefined) => void,
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

export async function syncVaultToExtension(params: {
  userId: string;
  accounts: DecryptedAccount[];
  ttlMs?: number;
  /** Override the extension ID list (test seams). */
  extensionIds?: readonly string[];
}): Promise<SendResult> {
  const runtime = getRuntime();
  if (!runtime) return { ok: false, reason: "no_extension" };

  const ids = params.extensionIds ?? AEGIS_EXTENSION_IDS;
  if (ids.length === 0) return { ok: false, reason: "no_id" };

  const totp = params.accounts
    .filter((a) => a.otp_type !== "hotp")
    .map(stripToExtShape);

  for (const id of ids) {
    const result: SendResult = await new Promise((resolve) => {
      try {
        runtime.sendMessage(
          id,
          { type: "SYNC_VAULT", userId: params.userId, accounts: totp, ttlMs: params.ttlMs },
          (res) => {
            const err = runtime.lastError?.message;
            if (err) {
              resolve({ ok: false, reason: "send_failed", detail: err });
              return;
            }
            if (res?.ok) resolve({ ok: true, accountCount: res.accountCount ?? totp.length });
            else resolve({ ok: false, reason: "send_failed", detail: res?.error ?? "unknown" });
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
    if (result.ok) return result;
  }
  return { ok: false, reason: "send_failed" };
}
