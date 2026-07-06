// Phase 6.4 — offline outbox for delete + details-edit mutations.
//
// Tag edits already have their own dedicated queue (`vault-tag-queue.ts`)
// because they're the highest-frequency offline mutation and predate this
// unified outbox. This module handles the two remaining mutations that
// can safely run without a server round-trip when they eventually flush:
//
//   • `delete`         — remove the row on the server on reconnect.
//   • `update-details` — patch issuer/label on reconnect.
//
// Adds and secret rotations still require online because they generate or
// modify encrypted material the server must accept before we surface the
// row locally. The scan/paste UI is disabled offline, so users never hit
// that path unintentionally.
//
// Semantics:
//   • Last-writer-wins per (id, kind). A pending delete supersedes an
//     earlier update-details on the same id.
//   • Optimistic cache patch is the caller's job (mirrors the tag-queue
//     pattern so UI updates atomically with the enqueue).
//   • Failures during flush leave the entry in the queue; next flush
//     retries. A row that has been deleted server-side (404-style error)
//     is silently dropped.

const QUEUE_KEY = "aegis.outbox.v1";

export type OutboxEntry =
  | { kind: "delete"; id: string; queuedAt: number }
  | { kind: "update-details"; id: string; issuer: string; label: string; queuedAt: number };

type QueueMap = Record<string, OutboxEntry>;

function safeGetStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readQueue(): QueueMap {
  const s = safeGetStorage();
  if (!s) return {};
  try {
    const raw = s.getItem(QUEUE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as QueueMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeQueue(map: QueueMap): void {
  const s = safeGetStorage();
  if (!s) return;
  try {
    if (Object.keys(map).length === 0) s.removeItem(QUEUE_KEY);
    else s.setItem(QUEUE_KEY, JSON.stringify(map));
  } catch {
    // best-effort
  }
}

/** Enqueue a delete. Supersedes any pending update-details for that id. */
export function enqueueDelete(id: string): void {
  const map = readQueue();
  map[id] = { kind: "delete", id, queuedAt: Date.now() };
  writeQueue(map);
}

/**
 * Enqueue an issuer/label edit. Skipped if a delete is already pending —
 * editing a row we're about to remove is a no-op.
 */
export function enqueueUpdateDetails(id: string, issuer: string, label: string): void {
  const map = readQueue();
  const existing = map[id];
  if (existing?.kind === "delete") return;
  map[id] = { kind: "update-details", id, issuer, label, queuedAt: Date.now() };
  writeQueue(map);
}

export function dequeueOutbox(id: string): void {
  const map = readQueue();
  if (!(id in map)) return;
  delete map[id];
  writeQueue(map);
}

export function listOutbox(): OutboxEntry[] {
  return Object.values(readQueue());
}

export function outboxSize(): number {
  return Object.keys(readQueue()).length;
}

export function clearOutbox(): void {
  writeQueue({});
}

/**
 * Try to flush every pending mutation. `appliers` receives the entry and
 * either resolves (dequeue) or throws. Returns the entries that were
 * successfully flushed. Entries whose row no longer exists on the server
 * are also dequeued — the intent is satisfied.
 */
export async function flushOutbox(appliers: {
  delete: (id: string) => Promise<void>;
  updateDetails: (id: string, issuer: string, label: string) => Promise<void>;
}): Promise<OutboxEntry[]> {
  const pending = listOutbox();
  const flushed: OutboxEntry[] = [];
  for (const entry of pending) {
    try {
      if (entry.kind === "delete") await appliers.delete(entry.id);
      else await appliers.updateDetails(entry.id, entry.issuer, entry.label);
      dequeueOutbox(entry.id);
      flushed.push(entry);
    } catch (err) {
      if (isMissingRowError(err)) {
        dequeueOutbox(entry.id);
        flushed.push(entry);
      }
      // Otherwise leave in queue for the next flush.
    }
  }
  return flushed;
}

function isMissingRowError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { code?: string; status?: number; message?: string };
  if (anyErr.code === "PGRST116") return true; // no rows
  if (anyErr.status === 404) return true;
  const msg = anyErr.message ?? "";
  return /no rows|not found/i.test(msg);
}
