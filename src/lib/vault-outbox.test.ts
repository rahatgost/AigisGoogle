// Phase 6.4 — offline outbox tests.
//
// The outbox stores delete + edit intents to localStorage when we can't
// reach the server, then replays them via flushOutbox() when we can.
// These tests exercise the queue in isolation from Supabase.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOutbox,
  dequeueOutbox,
  enqueueDelete,
  enqueueUpdateDetails,
  flushOutbox,
  listOutbox,
  outboxSize,
} from "./vault-outbox";

// Minimal localStorage shim — jsdom provides one, but this file also runs
// in the node vitest pool during CI.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
  clearOutbox();
});

afterEach(() => clearOutbox());

describe("vault-outbox", () => {
  it("enqueue → list → flush round-trip for a delete", async () => {
    enqueueDelete("acc-1");
    expect(outboxSize()).toBe(1);
    expect(listOutbox()[0]).toMatchObject({ kind: "delete", id: "acc-1" });

    const del = vi.fn().mockResolvedValue(undefined);
    const upd = vi.fn().mockResolvedValue(undefined);
    const flushed = await flushOutbox({ delete: del, updateDetails: upd });

    expect(del).toHaveBeenCalledWith("acc-1");
    expect(upd).not.toHaveBeenCalled();
    expect(flushed).toHaveLength(1);
    expect(outboxSize()).toBe(0);
  });

  it("enqueue → flush round-trip for an update-details", async () => {
    enqueueUpdateDetails("acc-2", "GitHub", "you@example.com");
    const del = vi.fn().mockResolvedValue(undefined);
    const upd = vi.fn().mockResolvedValue(undefined);
    await flushOutbox({ delete: del, updateDetails: upd });
    expect(upd).toHaveBeenCalledWith("acc-2", "GitHub", "you@example.com");
    expect(outboxSize()).toBe(0);
  });

  it("pending delete supersedes an earlier update-details on the same id", async () => {
    enqueueUpdateDetails("acc-3", "GitHub", "old");
    enqueueDelete("acc-3");
    expect(outboxSize()).toBe(1);
    const del = vi.fn().mockResolvedValue(undefined);
    const upd = vi.fn().mockResolvedValue(undefined);
    await flushOutbox({ delete: del, updateDetails: upd });
    expect(del).toHaveBeenCalled();
    expect(upd).not.toHaveBeenCalled();
  });

  it("update-details is dropped when a delete is already queued for that id", async () => {
    enqueueDelete("acc-4");
    enqueueUpdateDetails("acc-4", "X", "y"); // no-op
    const entries = listOutbox();
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("delete");
  });

  it("last-writer-wins for repeated update-details on same id", () => {
    enqueueUpdateDetails("acc-5", "First", "a@x");
    enqueueUpdateDetails("acc-5", "Second", "b@x");
    const entries = listOutbox();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "update-details", issuer: "Second", label: "b@x" });
  });

  it("keeps failed entries in the queue for the next flush", async () => {
    enqueueDelete("acc-6");
    enqueueUpdateDetails("acc-7", "GH", "l");
    const del = vi.fn().mockRejectedValue(new Error("network down"));
    const upd = vi.fn().mockResolvedValue(undefined);

    const first = await flushOutbox({ delete: del, updateDetails: upd });
    expect(first).toHaveLength(1); // only the update succeeded
    expect(outboxSize()).toBe(1);  // delete still queued

    // Recover on next flush.
    const del2 = vi.fn().mockResolvedValue(undefined);
    const second = await flushOutbox({ delete: del2, updateDetails: upd });
    expect(second).toHaveLength(1);
    expect(outboxSize()).toBe(0);
  });

  it("dequeues entries whose server row already vanished (PGRST116)", async () => {
    enqueueDelete("acc-8");
    const del = vi.fn().mockRejectedValue({ code: "PGRST116", message: "no rows" });
    const upd = vi.fn();
    const flushed = await flushOutbox({ delete: del, updateDetails: upd });
    expect(flushed).toHaveLength(1);
    expect(outboxSize()).toBe(0);
  });

  it("survives a page reload — persists to localStorage", () => {
    enqueueDelete("acc-9");
    enqueueUpdateDetails("acc-10", "Issuer", "Label");
    const raw = localStorage.getItem("aegis.outbox.v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(Object.keys(parsed)).toHaveLength(2);
    expect(parsed["acc-9"].kind).toBe("delete");
  });

  it("dequeueOutbox removes a single entry", () => {
    enqueueDelete("acc-11");
    enqueueDelete("acc-12");
    dequeueOutbox("acc-11");
    expect(outboxSize()).toBe(1);
    expect(listOutbox()[0].id).toBe("acc-12");
  });

  it("clearOutbox wipes everything", () => {
    enqueueDelete("acc-13");
    enqueueUpdateDetails("acc-14", "x", "y");
    clearOutbox();
    expect(outboxSize()).toBe(0);
    expect(localStorage.getItem("aegis.outbox.v1")).toBeNull();
  });
});
