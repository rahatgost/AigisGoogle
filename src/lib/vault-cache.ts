// Encrypted offline vault mirror.
//
// This is Phase 6.2 of the roadmap: an IndexedDB store that holds a copy
// of the vault_accounts rows we already fetch from the server. It never
// sees plaintext — only the same ciphertext + IV that Supabase stores.
// Decryption still happens in memory after the user unlocks, exactly as
// on the online path.
//
// The zero-knowledge invariant in SECURITY.md is preserved: a full
// device-level compromise reveals opaque ciphertext, no more than a
// server-side database dump would.

import { openDB, type IDBPDatabase } from "idb";
import type { VaultAccountRecord } from "@/lib/vault-accounts";

const DB_NAME = "aegis-vault";
const DB_VERSION = 1;
const STORE = "accounts";
const META_STORE = "meta";
const OWNER_KEY = "owner_user_id";
const LAST_SYNC_KEY_PREFIX = "last_sync:";

// Phase 6.2: local optimistic favorite toggles are honoured over the
// server's `is_favorite` value for a short window so a tap right before a
// diff-sync doesn't "flicker back" to the pre-toggle state. Kept in
// localStorage (not IndexedDB) because the merge path is synchronous.
const FAV_TOGGLE_LS_PREFIX = "aegis:fav_recent:";
const FAV_TOGGLE_TTL_MS = 60_000;

interface AegisSchema {
  [STORE]: { key: string; value: VaultAccountRecord };
  [META_STORE]: { key: string; value: string };
}

let dbPromise: Promise<IDBPDatabase<AegisSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<AegisSchema>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }
  if (!dbPromise) {
    dbPromise = openDB<AegisSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      },
    });
  }
  return dbPromise;
}

/**
 * Store the full vault snapshot for the given user. Rotating the owner
 * (sign-out + sign-in as a different user) invalidates the cache — we
 * never leak one user's ciphertext into another user's IndexedDB
 * origin partition.
 */
export async function writeVaultCache(
  userId: string,
  rows: VaultAccountRecord[],
): Promise<void> {
  try {
    const db = await getDb();
    const owner = await db.get(META_STORE, OWNER_KEY);
    const tx = db.transaction([STORE, META_STORE], "readwrite");
    if (owner && owner !== userId) {
      await tx.objectStore(STORE).clear();
    }
    const store = tx.objectStore(STORE);
    await store.clear();
    for (const row of rows) await store.put(row);
    await tx.objectStore(META_STORE).put(userId, OWNER_KEY);
    await tx.done;
  } catch {
    // Cache is best-effort — a quota error must never take down the vault.
  }
}

export async function readVaultCache(userId: string): Promise<VaultAccountRecord[] | null> {
  try {
    const db = await getDb();
    const owner = await db.get(META_STORE, OWNER_KEY);
    if (owner !== userId) return null;
    const rows = await db.getAll(STORE);
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

// Fire-and-forget cross-tab broadcast so a sibling tab's Vault view
// re-renders when this tab writes to the offline mirror. The dynamic
// import keeps sync-coordinator out of the vault-cache dependency
// graph for unit tests that don't need it.
function notifyVaultMutation(): void {
  if (typeof window === "undefined") return;
  void import("./sync-coordinator")
    .then((m) => m.broadcastCacheMutation("vault"))
    .catch(() => {
      // best-effort
    });
}

/** Remove a single row from the cache (used after delete). */
export async function removeFromVaultCache(id: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete(STORE, id);
    notifyVaultMutation();
  } catch {
    // Ignore — the next full sync will heal it.
  }
}

/** Patch a single row in the cache (used after add / update). */
export async function upsertVaultCache(row: VaultAccountRecord): Promise<void> {
  try {
    const db = await getDb();
    await db.put(STORE, row);
    notifyVaultMutation();
  } catch {
    // Ignore — the next full sync will heal it.
  }
}

/**
 * Patch `sort_order` for a batch of rows in-place. Used by the DnD reorder
 * flow so the offline mirror survives across reloads without waiting for
 * the next server sync. Rows that don't exist in the cache are skipped —
 * the next full sync will heal them.
 */
export async function patchCacheSortOrders(
  updates: Array<{ id: string; sort_order: number }>,
): Promise<void> {
  if (updates.length === 0) return;
  try {
    const db = await getDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const u of updates) {
      const existing = await store.get(u.id);
      if (existing) await store.put({ ...existing, sort_order: u.sort_order });
    }
    await tx.done;
  } catch {
    // best-effort
  }
}


/** Nuke everything. Called on sign-out and delete-account. */
export async function clearVaultCache(): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction([STORE, META_STORE], "readwrite");
    await tx.objectStore(STORE).clear();
    await tx.objectStore(META_STORE).clear();
    await tx.done;
  } catch {
    // Ignore.
  }
}

/**
 * True when the current network path can't reach the server. Used by the
 * offline banner and by the vault loader to decide whether to fall back
 * to the cache instead of surfacing an error.
 */
export function isOffline(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.onLine === false;
}

// ---------------------------------------------------------------------------
// Phase 6.2: sync metadata + optimistic favorite window
// ---------------------------------------------------------------------------

/** Read the ISO timestamp of the last successful server sync for this user. */
export async function readLastSync(userId: string): Promise<string | null> {
  try {
    const db = await getDb();
    const v = await db.get(META_STORE, LAST_SYNC_KEY_PREFIX + userId);
    return v ?? null;
  } catch {
    return null;
  }
}

/** Persist the ISO timestamp of a successful server sync. */
export async function writeLastSync(userId: string, iso: string): Promise<void> {
  try {
    const db = await getDb();
    await db.put(META_STORE, iso, LAST_SYNC_KEY_PREFIX + userId);
  } catch {
    // Best-effort — a missing timestamp just means next sync re-fetches everything.
  }
}

interface FavToggleEntry {
  value: boolean;
  at: number;
}
type FavToggleMap = Record<string, FavToggleEntry>;

function favToggleKey(userId: string): string {
  return FAV_TOGGLE_LS_PREFIX + userId;
}

function readFavToggleMap(userId: string): FavToggleMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(favToggleKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as FavToggleMap;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeFavToggleMap(userId: string, map: FavToggleMap): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (Object.keys(map).length === 0) {
      localStorage.removeItem(favToggleKey(userId));
    } else {
      localStorage.setItem(favToggleKey(userId), JSON.stringify(map));
    }
  } catch {
    // Storage disabled — degrade to server-wins (existing behaviour).
  }
}

function prune(map: FavToggleMap, now: number = Date.now()): FavToggleMap {
  const out: FavToggleMap = {};
  for (const [id, e] of Object.entries(map)) {
    if (now - e.at < FAV_TOGGLE_TTL_MS) out[id] = e;
  }
  return out;
}

/** Record an optimistic favorite toggle so an in-flight sync doesn't clobber it. */
export function recordFavoriteToggle(userId: string, id: string, value: boolean): void {
  const now = Date.now();
  const next = prune(readFavToggleMap(userId), now);
  next[id] = { value, at: now };
  writeFavToggleMap(userId, next);
}

/** Return the still-fresh optimistic toggles for merge-time lookup. */
export function readRecentFavoriteToggles(
  userId: string,
): Record<string, boolean> {
  const map = prune(readFavToggleMap(userId));
  writeFavToggleMap(userId, map); // opportunistic prune-on-read
  const out: Record<string, boolean> = {};
  for (const [id, e] of Object.entries(map)) out[id] = e.value;
  return out;
}

/** Clear a specific toggle once it has round-tripped (or on sign-out). */
export function clearFavoriteToggle(userId: string, id: string): void {
  const map = readFavToggleMap(userId);
  if (!(id in map)) return;
  delete map[id];
  writeFavToggleMap(userId, map);
}

/** Ceiling on the optimistic-toggle window — exported for tests / telemetry. */
export const FAV_TOGGLE_WINDOW_MS = FAV_TOGGLE_TTL_MS;

