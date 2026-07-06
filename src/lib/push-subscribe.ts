/**
 * Client-side WebPush subscribe helper (Phase 10.3).
 *
 * Runs in the browser. Asks the browser to subscribe to WebPush using
 * the server's VAPID public key (exposed via `VITE_VAPID_PUBLIC_KEY`),
 * then registers the resulting endpoint with the server via
 * `registerPushSubscription`. Idempotent — calling twice with the same
 * browser upserts.
 *
 * Failure modes (all returned, none thrown):
 *   - `unsupported`    — no SW / no PushManager / no Notification
 *   - `not_configured` — VITE_VAPID_PUBLIC_KEY missing at build time
 *   - `denied`         — user rejected the permission prompt
 *   - `subscribe_failed` — browser refused (usually flaky push service)
 */

import { useServerFn } from "@tanstack/react-start";
import {
  registerPushSubscription,
  unregisterPushSubscription,
} from "@/lib/push.functions";

export type SubscribeResult =
  | { ok: true; endpoint: string }
  | {
      ok: false;
      reason: "unsupported" | "not_configured" | "denied" | "subscribe_failed";
      detail?: string;
    };

function b64urlToUint8Array(base64url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function b64urlEncode(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function subscribeToPush(
  registerFn: (input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
  }) => Promise<unknown>,
): Promise<SubscribeResult> {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return { ok: false, reason: "unsupported" };
  }

  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapid) return { ok: false, reason: "not_configured" };

  const perm =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "denied" };

  const reg = await navigator.serviceWorker.ready;

  let sub: PushSubscription;
  try {
    const appServerKey = b64urlToUint8Array(vapid);
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // Copy into a fresh ArrayBuffer so TS doesn't widen to SharedArrayBuffer.
      applicationServerKey: appServerKey.slice().buffer,
    });
  } catch (e) {
    return {
      ok: false,
      reason: "subscribe_failed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  const p256dh = b64urlEncode(sub.getKey("p256dh"));
  const auth = b64urlEncode(sub.getKey("auth"));

  await registerFn({
    endpoint: sub.endpoint,
    p256dh,
    auth,
    userAgent: navigator.userAgent,
  });

  return { ok: true, endpoint: sub.endpoint };
}

/** React hook wrapping the raw helper with the server-fn binding. */
export function usePushSubscribe() {
  const register = useServerFn(registerPushSubscription);
  const unregister = useServerFn(unregisterPushSubscription);
  return {
    subscribe: () =>
      subscribeToPush(async (input) => {
        await register({ data: input });
      }),
    unsubscribe: async (): Promise<{ ok: boolean }> => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator))
        return { ok: false };
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return { ok: true };
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await unregister({ data: { endpoint } });
      return { ok: true };
    },
  };
}
