// Real reachability probe.
//
// `navigator.onLine` is best-effort — it only flips when the OS reports
// zero network interfaces. On captive Wi-Fi, VPN drops, or a stalled
// Supabase route the browser cheerfully claims to be online. This module
// pairs the browser signal with a periodic HEAD ping against our own
// `/api/public/health` endpoint so the app can distinguish "browser
// says online" from "server actually reachable".
//
// The single active poller is shared across all React consumers via a
// module-level singleton and a Set of listeners; we don't want every
// hook instance racing its own timers.

import { useEffect, useState } from "react";

const HEALTH_URL = "/api/public/health";
const PING_TIMEOUT_MS = 4000;
const INTERVAL_ONLINE_MS = 60_000;
const INTERVAL_OFFLINE_MS = 8_000;

type Listener = (reachable: boolean) => void;

let currentReachable = true;
let currentTimer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<boolean> | null = null;
const listeners = new Set<Listener>();

function notify(next: boolean): void {
  if (next === currentReachable) return;
  currentReachable = next;
  for (const l of listeners) {
    try {
      l(next);
    } catch {
      // Listener errors must never take down the poller.
    }
  }
}

async function probe(): Promise<boolean> {
  if (typeof fetch === "undefined") return true;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (inflight) return inflight;
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
    : null;
  inflight = (async () => {
    try {
      const res = await fetch(HEALTH_URL, {
        method: "HEAD",
        cache: "no-store",
        signal: controller?.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
      inflight = null;
    }
  })();
  return inflight;
}

function scheduleNext(): void {
  if (typeof window === "undefined") return;
  if (currentTimer) clearTimeout(currentTimer);
  const delay = currentReachable ? INTERVAL_ONLINE_MS : INTERVAL_OFFLINE_MS;
  currentTimer = setTimeout(tick, delay);
}

async function tick(): Promise<void> {
  const ok = await probe();
  notify(ok);
  scheduleNext();
}

/** Force an immediate probe. Resolves with the freshest reachable value. */
export async function pingNow(): Promise<boolean> {
  const ok = await probe();
  notify(ok);
  scheduleNext();
  return ok;
}

/** Subscribe to reachability changes. Returns an unsubscribe. */
export function subscribeReachable(cb: Listener): () => void {
  listeners.add(cb);
  ensurePollerStarted();
  return () => {
    listeners.delete(cb);
  };
}

let pollerStarted = false;
function ensurePollerStarted(): void {
  if (pollerStarted || typeof window === "undefined") return;
  pollerStarted = true;
  const kick = () => {
    void pingNow();
  };
  window.addEventListener("online", kick);
  window.addEventListener("offline", () => notify(false));
  window.addEventListener("focus", kick);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kick();
  });
  scheduleNext();
}

export function isReachable(): boolean {
  return currentReachable;
}

/** React hook: returns `true` when we've confirmed the server is reachable. */
export function useReachable(): boolean {
  const [state, setState] = useState<boolean>(() => currentReachable);
  useEffect(() => subscribeReachable(setState), []);
  return state;
}
