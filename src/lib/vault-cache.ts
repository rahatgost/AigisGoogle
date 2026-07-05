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

/** Remove a single row from the cache (used after delete). */
export async function removeFromVaultCache(id: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete(STORE, id);
  } catch {
    // Ignore — the next full sync will heal it.
  }
}

/** Patch a single row in the cache (used after add / update). */
export async function upsertVaultCache(row: VaultAccountRecord): Promise<void> {
  try {
    const db = await getDb();
    await db.put(STORE, row);
  } catch {
    // Ignore — the next full sync will heal it.
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
