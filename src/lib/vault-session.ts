// In-memory vault session. The DEK never touches localStorage or
// sessionStorage — it lives only in this module's closure. A hard refresh
// or tab close wipes it, forcing re-unlock.
//
// Also owns the auto-lock timer (default 5 minutes of inactivity).

import { useEffect, useState } from "react";

const AUTO_LOCK_MS = 5 * 60 * 1000;

let dek: CryptoKey | null = null;
let lockTimer: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function scheduleAutoLock() {
  if (typeof window === "undefined") return;
  if (lockTimer !== null) window.clearTimeout(lockTimer);
  lockTimer = window.setTimeout(() => {
    lockVault();
  }, AUTO_LOCK_MS);
}

export function setVaultKey(key: CryptoKey) {
  dek = key;
  scheduleAutoLock();
  emit();
}

export function getVaultKey(): CryptoKey | null {
  if (dek) scheduleAutoLock();
  return dek;
}

export function isVaultUnlocked(): boolean {
  return dek !== null;
}

export function lockVault() {
  if (lockTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(lockTimer);
    lockTimer = null;
  }
  dek = null;
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useVaultUnlocked(): boolean {
  const [unlocked, setUnlocked] = useState<boolean>(() => isVaultUnlocked());
  useEffect(() => {
    return subscribe(() => setUnlocked(isVaultUnlocked()));
  }, []);
  return unlocked;
}

// Bump the auto-lock timer on user activity. Call once from the app shell.
export function useActivityKeepAlive() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const bump = () => {
      if (dek) scheduleAutoLock();
    };
    const events = ["pointerdown", "keydown", "visibilitychange"] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, bump);
    };
  }, []);
}
