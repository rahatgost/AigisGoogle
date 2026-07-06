/**
 * WebPush sender (server-only, Workers-compatible).
 *
 * Uses @block65/webcrypto-web-push, which builds VAPID JWTs + aes128gcm
 * payload encryption entirely on top of WebCrypto — no Node built-ins,
 * safe to import in a Cloudflare Worker.
 *
 * Env vars (secrets):
 *   VAPID_PUBLIC_KEY   — base64url ECDSA P-256 public key
 *   VAPID_PRIVATE_KEY  — base64url ECDSA P-256 private key
 *   VAPID_SUBJECT      — mailto:  or https:// contact URI (RFC 8292)
 *
 * If any of those are missing, `sendApprovalPush` returns
 * `{ ok: false, reason: 'not_configured' }` and does not throw — the
 * approval nonce is still minted so the user can approve directly from
 * the receiving device's UI without the OS-level push notification.
 */

import { buildPushPayload } from "@block65/webcrypto-web-push";

export interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SendResult =
  | { ok: true; delivered: number; failed: number; goneEndpoints: string[] }
  | { ok: false; reason: "not_configured" | "no_subscriptions"; delivered?: 0 };

interface SendParams {
  subscriptions: readonly StoredPushSubscription[];
  /** Small JSON payload delivered to the SW's `push` event. */
  message: {
    title: string;
    body: string;
    /** Deep link the notification click should open. */
    url: string;
    /** Server-minted nonce id — the receiver validates via `consumePushNonce`. */
    nonceId: string;
  };
  /** Push urgency (RFC 8030). Approvals are "high" — user is waiting. */
  urgency?: "low" | "normal" | "high";
  /** TTL in seconds. Short — the nonce itself expires in ~2 min anyway. */
  ttlSeconds?: number;
}

function readVapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/**
 * Fan out a push to every subscription. Endpoints that respond 404/410
 * are returned in `goneEndpoints` so the caller can prune them from the
 * DB (browsers reissue endpoints on reset, so stale rows accumulate).
 */
export async function sendApprovalPush(params: SendParams): Promise<SendResult> {
  const vapid = readVapid();
  if (!vapid) return { ok: false, reason: "not_configured" };
  if (params.subscriptions.length === 0)
    return { ok: false, reason: "no_subscriptions" };

  const goneEndpoints: string[] = [];
  let delivered = 0;
  let failed = 0;

  await Promise.all(
    params.subscriptions.map(async (sub) => {
      try {
        const req = await buildPushPayload(
          {
            data: params.message,
            options: {
              ttl: params.ttlSeconds ?? 90,
              urgency: params.urgency ?? "high",
              topic: "aegis-approval",
            },
          },
          {
            endpoint: sub.endpoint,
            expirationTime: null,
            keys: { auth: sub.auth, p256dh: sub.p256dh },
          },
          vapid,
        );
        const res = await fetch(sub.endpoint, {
          method: req.method,
          headers: req.headers,
          // Uint8Array is a valid BodyInit in Workers/fetch.
          body: req.body as unknown as BodyInit,
        });
        if (res.status === 404 || res.status === 410) {
          goneEndpoints.push(sub.endpoint);
          failed++;
          return;
        }
        if (!res.ok) {
          failed++;
          return;
        }
        delivered++;
      } catch {
        failed++;
      }
    }),
  );

  return { ok: true, delivered, failed, goneEndpoints };
}
