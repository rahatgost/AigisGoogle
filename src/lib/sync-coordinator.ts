// Cross-tab sync coordinator.
//
// Two problems solved:
//   1. Offline queues (outbox, tag queue) previously flushed only on the
//      raw `online` window event. That fires when `navigator.onLine`
//      flips — which lies about captive Wi-Fi and VPN drops — and never
//      fires when the user switches tabs back from a background window
//      that lost connectivity silently.
//   2. If two tabs of the app are open, both race to flush the same
//      queue on reconnect, producing duplicate mutations.
//
// This module offers a single subscribe entrypoint:
//
//     onSyncOpportunity(() => flushEverything())
//
// It fires the callback when any of these happens AND the caller wins a
// short cross-tab lock (BroadcastChannel-based, best-effort):
//   • the server becomes reachable (real probe, not just navigator.onLine)
//   • the tab becomes visible again
//   • the window regains focus
//   • an explicit `requestSyncNow()` call from anywhere in the app
//
// Failing back gracefully: if BroadcastChannel is unavailable (older
// Safari, extension contexts) every tab just flushes — duplicate work
// but never data loss, since server-side upserts are idempotent for the
// mutations we queue.

import { subscribeReachable, isReachable, pingNow } from "./reachability";

const CHANNEL_NAME = "aegis-sync-v1";
const LOCK_TTL_MS = 5_000;

type SyncCb = () => void | Promise<void>;

const callbacks = new Set<SyncCb>();
let channel: BroadcastChannel | null = null;
let started = false;
let lastRunAt = 0;

function safeChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", (ev) => {
      if (ev.data?.type === "sync-claim") {
        // Another tab is about to flush — record its claim so we back off.
        lastRunAt = Math.max(lastRunAt, ev.data.at ?? Date.now());
      }
    });
    return channel;
  } catch {
    return null;
  }
}

function tryClaim(): boolean {
  const now = Date.now();
  if (now - lastRunAt < LOCK_TTL_MS) return false;
  lastRunAt = now;
  const ch = safeChannel();
  if (ch) {
    try {
      ch.postMessage({ type: "sync-claim", at: now });
    } catch {
      // best-effort
    }
  }
  return true;
}

async function runAll(): Promise<void> {
  for (const cb of callbacks) {
    try {
      await cb();
    } catch {
      // Individual callback failures never block siblings.
    }
  }
}

function trigger(): void {
  if (!isReachable()) return;
  if (!tryClaim()) return;
  void runAll();
}

function ensureStarted(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  safeChannel();

  subscribeReachable((ok) => {
    if (ok) trigger();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void pingNow().then((ok) => {
        if (ok) trigger();
      });
    }
  });

  window.addEventListener("focus", () => {
    void pingNow().then((ok) => {
      if (ok) trigger();
    });
  });
}

/**
 * Register a callback to run when a sync opportunity arrives and this
 * tab wins the cross-tab lock. Returns an unsubscribe.
 */
export function onSyncOpportunity(cb: SyncCb): () => void {
  callbacks.add(cb);
  ensureStarted();
  // Fire once at subscribe if we're already reachable so a freshly
  // mounted vault flushes its pre-existing queue.
  if (isReachable()) {
    // Defer to next tick so subscribers can finish wiring first.
    queueMicrotask(() => {
      if (tryClaim()) void cb();
    });
  }
  return () => {
    callbacks.delete(cb);
  };
}

/** Explicit user- or app-triggered flush (e.g. after enqueuing work). */
export async function requestSyncNow(): Promise<void> {
  ensureStarted();
  const ok = await pingNow();
  if (!ok) return;
  if (!tryClaim()) return;
  await runAll();
}
