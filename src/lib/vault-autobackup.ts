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
  isVaultReadOnly,
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
const LOG_MAX = 25;

export type AutoBackupLogKind = "change" | "start" | "success" | "error" | "skipped";
export interface AutoBackupLogEntry {
  at: string; // ISO
  kind: AutoBackupLogKind;
  message?: string;
}

function key(userId: string, k: string) {
  return `${PREFIX}${userId}.${k}`;
}

export function getAutoBackupLog(userId: string): AutoBackupLogEntry[] {
  const raw = safeGet(key(userId, "log"));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AutoBackupLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function clearAutoBackupLog(userId: string) {
  safeSet(key(userId, "log"), null);
  emit(userId);
}

function appendLog(userId: string, kind: AutoBackupLogKind, message?: string) {
  const entry: AutoBackupLogEntry = { at: new Date().toISOString(), kind, message };
  const next = [entry, ...getAutoBackupLog(userId)].slice(0, LOG_MAX);
  safeSet(key(userId, "log"), JSON.stringify(next));
  emit(userId);
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
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      dek,
      enc.encode(passphrase) as unknown as BufferSource,
    ),
  );
  return JSON.stringify({ iv: toB64(iv), ct: toB64(ct) });
}

async function unwrapPassphrase(dek: CryptoKey, blob: string): Promise<string> {
  const { iv, ct } = JSON.parse(blob) as { iv: string; ct: string };
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(iv) as unknown as BufferSource },
    dek,
    fromB64(ct) as unknown as BufferSource,
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

// Plan gate — set by the client (Security tab) from `usePlan().hasFeature(...)`.
// Fails closed: if never set, we assume Free and skip backups. This makes sure
// a Pro user who downgrades stops auto-backing-up even if their local settings
// still say `enabled: true`.
let planAllowsAutoBackup = false;
export function setAutoBackupPlanGate(allowed: boolean) {
  planAllowsAutoBackup = allowed;
}

export async function runAutoBackupNow(userId: string): Promise<void> {
  if (running.has(userId)) return;
  const settings = getAutoBackupSettings(userId);
  if (!settings.enabled) return;
  if (isVaultReadOnly()) {
    appendLog(userId, "skipped", "Read-only recovery session");
    return;
  }
  if (!planAllowsAutoBackup) {
    appendLog(userId, "skipped", "Auto-backup requires Pro");
    return;
  }
  const dek = getVaultKey();
  if (!dek) {
    appendLog(userId, "skipped", "Vault locked");
    return;
  }
  const wrapped = safeGet(key(userId, "pass"));
  if (!wrapped) {
    writeSettings(userId, {
      enabled: false,
      lastError: "Saved passphrase missing — re-enable auto-backup.",
    });
    appendLog(userId, "error", "Saved passphrase missing");
    return;
  }
  running.add(userId);
  appendLog(userId, "start", "Upload started");
  try {
    const passphrase = await unwrapPassphrase(dek, wrapped);
    const accounts = await listAccounts(dek);
    if (accounts.length === 0) {
      writeSettings(userId, { lastError: "Vault is empty — nothing to back up." });
      appendLog(userId, "skipped", "Vault is empty");
      return;
    }
    await uploadCloudBackup(userId, accounts, passphrase, { label: AUTO_LABEL });
    writeSettings(userId, { lastAt: new Date().toISOString(), lastError: null });
    appendLog(userId, "success", `${accounts.length} account${accounts.length === 1 ? "" : "s"} backed up`);
    void pruneOldAutoBackups(userId, settings.keep);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err ?? "");
    const msg = friendlyBackupError(raw);
    writeSettings(userId, { lastError: msg });
    appendLog(userId, "error", msg);
  } finally {
    running.delete(userId);
  }
}

/**
 * Translate raw backend/storage errors into short, human-readable strings.
 * Covers DB quota triggers (vault account cap, per-minute rate limit,
 * family cap), storage RLS/quota denials, oversized payloads, and offline.
 */
export function friendlyBackupError(raw: string): string {
  const m = (raw || "").toLowerCase();
  // DB triggers (Postgres RAISE EXCEPTION surfaces the message verbatim)
  if (m.includes("vault account limit reached")) {
    return "You've hit your plan's account limit. Upgrade to Pro to back up more accounts.";
  }
  if (m.includes("rate limit") && m.includes("vault accounts")) {
    return "Too many vault changes in a short window — auto-backup will retry shortly.";
  }
  if (m.includes("family is full")) {
    return "Family is full (6 members max).";
  }
  // Storage / auth
  if (m.includes("row-level security") || m.includes("row level security") || m.includes("not authorized")) {
    return "Backend rejected the backup (permission denied). Try signing out and back in.";
  }
  if (m.includes("payload too large") || m.includes("413")) {
    return "Backup is too large for your plan's storage limit.";
  }
  if (m.includes("quota") || m.includes("storage limit") || m.includes("exceeded")) {
    return "Cloud backup storage quota reached. Delete older backups or upgrade your plan.";
  }
  if (m.includes("already exists") || m.includes("duplicate")) {
    return "A backup with this name already exists — will retry on the next cycle.";
  }
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network error")) {
    return "Network unavailable — auto-backup will retry when you're back online.";
  }
  if (m.includes("jwt") || m.includes("unauthorized") || m.includes("401")) {
    return "Session expired — sign in again to resume auto-backup.";
  }
  return raw || "Auto-backup failed.";
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

// Wire into vault session so we (re)start on unlock, stop on lock. Also
// listen for vault-changed events (any add/edit/delete/reorder/HOTP) and
// `online` events so a change made offline auto-backs-up the moment the
// device reconnects.
let sessionUnsub: (() => void) | null = null;
let activeUserId: string | null = null;
let dirty = false;
let debounceTimer: number | null = null;
const DIRTY_DEBOUNCE_MS = 15 * 1000; // batch rapid changes

const VAULT_CHANGED_EVENT = "aegis:vault-changed";

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

function tryFlushDirty() {
  if (!dirty) return;
  if (!activeUserId) return;
  if (!isVaultUnlocked()) return;
  if (!isOnline()) return;
  const settings = getAutoBackupSettings(activeUserId);
  if (!settings.enabled) return;
  dirty = false;
  void runAutoBackupNow(activeUserId);
}

function markDirty() {
  dirty = true;
  if (activeUserId) {
    const settings = getAutoBackupSettings(activeUserId);
    if (settings.enabled) {
      const suffix = isOnline() ? "" : " (offline — queued)";
      appendLog(activeUserId, "change", `Vault changed${suffix}`);
    }
  }
  if (typeof window === "undefined") return;
  if (debounceTimer !== null) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    tryFlushDirty();
  }, DIRTY_DEBOUNCE_MS);
}

function onOnline() {
  // Coming back online: if a change happened while offline, flush right away.
  if (dirty) tryFlushDirty();
}

function attachWindowListeners() {
  if (typeof window === "undefined") return;
  window.addEventListener(VAULT_CHANGED_EVENT, markDirty);
  window.addEventListener("online", onOnline);
}

function detachWindowListeners() {
  if (typeof window === "undefined") return;
  window.removeEventListener(VAULT_CHANGED_EVENT, markDirty);
  window.removeEventListener("online", onOnline);
}

let windowListenersAttached = false;

export function initAutoBackup(userId: string) {
  activeUserId = userId;
  if (sessionUnsub) sessionUnsub();
  sessionUnsub = subscribeVaultSession(() => {
    if (!activeUserId) return;
    if (isVaultUnlocked()) {
      scheduleFor(activeUserId);
      // Unlock might follow an offline change — flush anything pending.
      if (dirty) tryFlushDirty();
    } else {
      stopFor(activeUserId);
    }
  });
  if (!windowListenersAttached) {
    attachWindowListeners();
    windowListenersAttached = true;
  }
  if (isVaultUnlocked()) scheduleFor(userId);
}

export function stopAutoBackup() {
  if (sessionUnsub) {
    sessionUnsub();
    sessionUnsub = null;
  }
  for (const uid of Array.from(timers.keys())) stopFor(uid);
  if (windowListenersAttached) {
    detachWindowListeners();
    windowListenersAttached = false;
  }
  if (debounceTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  dirty = false;
  activeUserId = null;
}
