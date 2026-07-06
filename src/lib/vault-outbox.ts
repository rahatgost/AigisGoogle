// Phase 6.4 — offline outbox for every vault mutation.
//
// Tag edits still use their own dedicated queue (`vault-tag-queue.ts`)
// because they predate this unified outbox and its lookup semantics are
// simpler. Everything else — create, delete, details edits, and favorite
// toggles — flows through here so the user can add, edit, star, and
// remove accounts while offline and have the intents replayed on
// reconnect.
//
// Storage model
// -------------
// A chronological array of intents in localStorage under `aegis.outbox.v1`.
// Flush walks it front-to-back so a `create` for a client-generated id
// always runs before any `favorite` / `update-details` / `delete` that
// targets the same id.
//
// Coalescing
// ----------
//   • repeat `favorite` on same id  → last-writer-wins (older dropped).
//   • repeat `update-details`       → last-writer-wins (older dropped).
//   • pending `create` + follow-up `update-details` / `favorite`
//                                    → merged into the create payload; no
//                                      trailing entry.
//   • pending `create` + `delete`   → both dropped (never happened
//                                      as far as the server is concerned).
//   • any pending entries for an id followed by a `delete`
//                                    → prior entries dropped, delete kept.
//
// Failures during flush leave the entry in the queue; the next flush
// retries. Missing-row errors are treated as success (the intent is
// satisfied — the row is gone).

const QUEUE_KEY = "aegis.outbox.v1";

export interface CreatePayload {
  userId: string;
  issuer: string;
  label: string;
  icon_slug: string | null;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  tags: string[];
  is_favorite: boolean;
  secret_ciphertext_hex: string;
  secret_iv_hex: string;
}

export type OutboxEntry =
  | { kind: "create"; id: string; payload: CreatePayload; queuedAt: number }
  | { kind: "delete"; id: string; queuedAt: number }
  | { kind: "update-details"; id: string; issuer: string; label: string; queuedAt: number }
  | { kind: "favorite"; id: string; isFavorite: boolean; queuedAt: number };

function safeGetStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readQueue(): OutboxEntry[] {
  const s = safeGetStorage();
  if (!s) return [];
  try {
    const raw = s.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Legacy map format from before create/favorite support — migrate.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.values(parsed) as OutboxEntry[];
    }
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(entries: OutboxEntry[]): void {
  const s = safeGetStorage();
  if (!s) return;
  try {
    if (entries.length === 0) s.removeItem(QUEUE_KEY);
    else s.setItem(QUEUE_KEY, JSON.stringify(entries));
  } catch {
    // best-effort
  }
}

function now(): number {
  return Date.now();
}

/** Enqueue a create. Never coalesced — each create is a distinct row. */
export function enqueueCreate(id: string, payload: CreatePayload): void {
  const q = readQueue();
  q.push({ kind: "create", id, payload, queuedAt: now() });
  writeQueue(q);
}

/**
 * Enqueue a delete. If a matching `create` for the same id is still
 * pending, both are dropped — the row never reached the server, so there
 * is nothing to delete. Otherwise every prior entry for the id is
 * superseded by the delete.
 */
export function enqueueDelete(id: string): void {
  const q = readQueue();
  const pendingCreate = q.some((e) => e.kind === "create" && e.id === id);
  const filtered = q.filter((e) => e.id !== id);
  if (pendingCreate) {
    writeQueue(filtered);
    return;
  }
  filtered.push({ kind: "delete", id, queuedAt: now() });
  writeQueue(filtered);
}

/**
 * Enqueue an issuer/label edit. Skipped when a delete is already queued.
 * When a pending create exists for the id, the edit is merged into it so
 * the first flushed INSERT already carries the new values.
 */
export function enqueueUpdateDetails(id: string, issuer: string, label: string): void {
  const q = readQueue();
  if (q.some((e) => e.kind === "delete" && e.id === id)) return;
  const createIdx = q.findIndex((e) => e.kind === "create" && e.id === id);
  if (createIdx >= 0) {
    const entry = q[createIdx] as Extract<OutboxEntry, { kind: "create" }>;
    entry.payload.issuer = issuer;
    entry.payload.label = label;
    q[createIdx] = entry;
    writeQueue(q);
    return;
  }
  // Drop any prior update-details for the same id — last writer wins.
  const filtered = q.filter((e) => !(e.kind === "update-details" && e.id === id));
  filtered.push({ kind: "update-details", id, issuer, label, queuedAt: now() });
  writeQueue(filtered);
}

/**
 * Enqueue a favorite toggle. Skipped when a delete is queued. When a
 * pending create exists for the id, the value is folded into the create
 * payload directly.
 */
export function enqueueFavorite(id: string, isFavorite: boolean): void {
  const q = readQueue();
  if (q.some((e) => e.kind === "delete" && e.id === id)) return;
  const createIdx = q.findIndex((e) => e.kind === "create" && e.id === id);
  if (createIdx >= 0) {
    const entry = q[createIdx] as Extract<OutboxEntry, { kind: "create" }>;
    entry.payload.is_favorite = isFavorite;
    q[createIdx] = entry;
    writeQueue(q);
    return;
  }
  const filtered = q.filter((e) => !(e.kind === "favorite" && e.id === id));
  filtered.push({ kind: "favorite", id, isFavorite, queuedAt: now() });
  writeQueue(filtered);
}

/** Remove every entry that targets the given id. */
export function dequeueOutbox(id: string): void {
  const q = readQueue();
  const next = q.filter((e) => e.id !== id);
  if (next.length !== q.length) writeQueue(next);
}

export function listOutbox(): OutboxEntry[] {
  return readQueue();
}

export function outboxSize(): number {
  return readQueue().length;
}

export function clearOutbox(): void {
  writeQueue([]);
}

export interface OutboxAppliers {
  create: (id: string, payload: CreatePayload) => Promise<void>;
  delete: (id: string) => Promise<void>;
  updateDetails: (id: string, issuer: string, label: string) => Promise<void>;
  favorite: (id: string, isFavorite: boolean) => Promise<void>;
}

/**
 * Try to flush every pending mutation in the order it was enqueued. On
 * failure a single entry is left in place and the flush continues with
 * the rest; the next reconnect will retry. Missing-row errors are
 * treated as success (the intent has already landed).
 */
export async function flushOutbox(appliers: OutboxAppliers): Promise<OutboxEntry[]> {
  const pending = readQueue();
  const remaining: OutboxEntry[] = [];
  const flushed: OutboxEntry[] = [];
  for (const entry of pending) {
    try {
      switch (entry.kind) {
        case "create":
          await appliers.create(entry.id, entry.payload);
          break;
        case "delete":
          await appliers.delete(entry.id);
          break;
        case "update-details":
          await appliers.updateDetails(entry.id, entry.issuer, entry.label);
          break;
        case "favorite":
          await appliers.favorite(entry.id, entry.isFavorite);
          break;
      }
      flushed.push(entry);
    } catch (err) {
      if (isMissingRowError(err)) {
        flushed.push(entry);
      } else {
        remaining.push(entry);
      }
    }
  }
  writeQueue(remaining);
  return flushed;
}

function isMissingRowError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { code?: string; status?: number; message?: string };
  if (anyErr.code === "PGRST116") return true;
  if (anyErr.status === 404) return true;
  const msg = anyErr.message ?? "";
  return /no rows|not found/i.test(msg);
}
