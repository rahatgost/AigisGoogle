// Scheduled automatic encrypted cloud backups.
//
// The user picks an *auto-backup passphrase* once (independent of the vault
// passphrase). We AES-GCM-wrap that passphrase using the in-memory DEK and
// stash the ciphertext in localStorage — so while the vault is unlocked the
// scheduler can silently produce a new encrypted `.avf`, upload it to the
// private `vault-backups` bucket, and prune older auto copies. The server
// never sees the passphrase or plaintext secrets: same zero-knowledge
// envelope as manual encrypted export.
//
// Trigger model: purely client-side. When the vault is unlocked and the app
// is open, we check every 15 minutes whether a backup is due; we also run a
// check immediately on unlock. Nothing runs while the vault is locked (no
// DEK → nothing to encrypt with).

import { listAccounts } from "@/lib/vault-accounts";
import {
  deleteCloudBackup,
  listCloudBackups,
  uploadCloudBackup,
} from "@/lib/vault-cloud-backup";
import {
  getVaultKey,
  isVaultUnlocked,
  subscribe as subscribeVaultSession,
} from "@/lib/vault-session";

export type AutoBackupFrequency = "daily" | "weekly";

export interface AutoBackupSettings {
  enabled: boolean;
  frequency: AutoBackupFrequency;
  keep: number; // max auto copies retained in cloud
  lastAt: string | null; // ISO
  lastError: string | null;
}

const PREFIX = "aegis.autobackup.";
const AUTO_LABEL = "auto";
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 min
const DEFAULT_KEEP = 5;

function key(userId: string, k: string) {
  return `${PREFIX}${userId}.${k}`;
}

function safeGet(k: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
}

function safeSet(k: string, v: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (v === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch {
    // ignore
  }
}

export function getAutoBackupSettings(userId: string): AutoBackupSettings {
  const freqRaw = safeGet(key(userId, "frequency"));
  const keepRaw = safeGet(key(userId, "keep"));
  const keep = Number(keepRaw);
  return {
    enabled: safeGet(key(userId, "enabled")) === "1",
    frequency: freqRaw === "weekly" ? "weekly" : "daily",
    keep: Number.isFinite(keep) && keep > 0 ? Math.min(keep, 30) : DEFAULT_KEEP,
    lastAt: safeGet(key(userId, "lastAt")),
    lastError: safeGet(key(userId, "lastError")),
  };
}

function writeSettings(userId: string, patch: Partial<AutoBackupSettings>) {
  if (patch.enabled !== undefined) safeSet(key(userId, "enabled"), patch.enabled ? "1" : null);
  if (patch.frequency !== undefined) safeSet(key(userId, "frequency"), patch.frequency);
  if (patch.keep !== undefined) safeSet(key(userId, "keep"), String(patch.keep));
  if (patch.lastAt !== undefined) safeSet(key(userId, "lastAt"), patch.lastAt);
  if (patch.lastError !== undefined) safeSet(key(userId, "lastError"), patch.lastError);
  emit(userId);
}

// --- passphrase wrapping (DEK-encrypted, kept in localStorage) ---

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return typeof btoa !== "undefined" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
}

function fromB64(b64: string): Uint8Array {
  const s = typeof atob !== "undefined" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function wrapPassphrase(dek: CryptoKey, passphrase: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dek, enc.encode(passphrase)),
  );
  return JSON.stringify({ iv: toB64(iv), ct: toB64(ct) });
}

async function unwrapPassphrase(dek: CryptoKey, blob: string): Promise<string> {
  const { iv, ct } = JSON.parse(blob) as { iv: string; ct: string };
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(iv) },
    dek,
    fromB64(ct),
  );
  return dec.decode(pt);
}

export function hasStoredPassphrase(userId: string): boolean {
  return safeGet(key(userId, "pass")) !== null;
}

export async function enableAutoBackup(
  userId: string,
  passphrase: string,
  opts: { frequency: AutoBackupFrequency; keep: number },
): Promise<void> {
  if (passphrase.length < 10) throw new Error("Passphrase must be at least 10 characters.");
  const dek = getVaultKey();
  if (!dek) throw new Error("Unlock your vault to enable auto-backup.");
  const blob = await wrapPassphrase(dek, passphrase);
  safeSet(key(userId, "pass"), blob);
  writeSettings(userId, {
    enabled: true,
    frequency: opts.frequency,
    keep: Math.max(1, Math.min(30, opts.keep)),
    lastError: null,
  });
  scheduleFor(userId);
}

export function disableAutoBackup(userId: string) {
  safeSet(key(userId, "pass"), null);
  writeSettings(userId, { enabled: false, lastError: null });
  stopFor(userId);
}

export function updateAutoBackupSettings(
  userId: string,
  patch: { frequency?: AutoBackupFrequency; keep?: number },
) {
  writeSettings(userId, patch);
}

// --- scheduler ---

const timers = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();
const running = new Set<string>();

function emit(userId: string) {
  const set = listeners.get(userId);
  if (!set) return;
  for (const fn of set) fn();
}

export function subscribeAutoBackup(userId: string, fn: () => void): () => void {
  let set = listeners.get(userId);
  if (!set) {
    set = new Set();
    listeners.set(userId, set);
  }
  set.add(fn);
  return () => set!.delete(fn);
}

function intervalMs(freq: AutoBackupFrequency): number {
  return freq === "weekly" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

function isDue(settings: AutoBackupSettings): boolean {
  if (!settings.enabled) return false;
  if (!settings.lastAt) return true;
  const last = Date.parse(settings.lastAt);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= intervalMs(settings.frequency);
}

async function pruneOldAutoBackups(userId: string, keep: number) {
  const all = await listCloudBackups(userId);
  const autos = all.filter((b) => b.fileName.includes(`-${AUTO_LABEL}.avf`));
  // listCloudBackups returns newest first — drop past the keep boundary.
  const stale = autos.slice(keep);
  for (const s of stale) {
    try {
      await deleteCloudBackup(s.name);
    } catch {
      // best-effort prune; ignore
    }
  }
}

export async function runAutoBackupNow(userId: string): Promise<void> {
  if (running.has(userId)) return;
  const settings = getAutoBackupSettings(userId);
  if (!settings.enabled) return;
  const dek = getVaultKey();
  if (!dek) return; // locked
  const wrapped = safeGet(key(userId, "pass"));
  if (!wrapped) {
    writeSettings(userId, {
      enabled: false,
      lastError: "Saved passphrase missing — re-enable auto-backup.",
    });
    return;
  }
  running.add(userId);
  try {
    const passphrase = await unwrapPassphrase(dek, wrapped);
    const accounts = await listAccounts(dek);
    if (accounts.length === 0) {
      writeSettings(userId, { lastError: "Vault is empty — nothing to back up." });
      return;
    }
    await uploadCloudBackup(userId, accounts, passphrase, { label: AUTO_LABEL });
    writeSettings(userId, { lastAt: new Date().toISOString(), lastError: null });
    void pruneOldAutoBackups(userId, settings.keep);
  } catch (err) {
    writeSettings(userId, {
      lastError: err instanceof Error ? err.message : "Auto-backup failed.",
    });
  } finally {
    running.delete(userId);
  }
}

function scheduleFor(userId: string) {
  if (typeof window === "undefined") return;
  stopFor(userId);
  const settings = getAutoBackupSettings(userId);
  if (!settings.enabled) return;
  // Run once immediately if due.
  if (isVaultUnlocked() && isDue(settings)) {
    void runAutoBackupNow(userId);
  }
  const id = window.setInterval(() => {
    if (!isVaultUnlocked()) return;
    const s = getAutoBackupSettings(userId);
    if (isDue(s)) void runAutoBackupNow(userId);
  }, CHECK_INTERVAL_MS);
  timers.set(userId, id);
}

function stopFor(userId: string) {
  if (typeof window === "undefined") return;
  const t = timers.get(userId);
  if (t !== undefined) {
    window.clearInterval(t);
    timers.delete(userId);
  }
}

// Wire into vault session so we (re)start on unlock, stop on lock.
let sessionUnsub: (() => void) | null = null;
let activeUserId: string | null = null;

export function initAutoBackup(userId: string) {
  activeUserId = userId;
  if (sessionUnsub) sessionUnsub();
  sessionUnsub = subscribeVaultSession(() => {
    if (!activeUserId) return;
    if (isVaultUnlocked()) scheduleFor(activeUserId);
    else stopFor(activeUserId);
  });
  if (isVaultUnlocked()) scheduleFor(userId);
}

export function stopAutoBackup() {
  if (sessionUnsub) {
    sessionUnsub();
    sessionUnsub = null;
  }
  for (const uid of Array.from(timers.keys())) stopFor(uid);
  activeUserId = null;
}
