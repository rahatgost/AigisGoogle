// Phase 6.2: cache-first + delta-sync merge rules.
//
// Two invariants matter when the vault loader hydrates from the server
// after painting from cache:
//   1. Server-wins on `updated_at` ties — the server is the source of
//      truth for every field EXCEPT recent optimistic favorite toggles.
//   2. Client-wins on `is_favorite` when the user tapped the star within
//      the last 60s and that toggle hasn't been round-tripped yet.
//      Without this rule, an in-flight sync that races the tap flickers
//      the star back to its pre-tap state.
//
// Deletions are handled implicitly: `mergeAccountRows` starts from the
// server list, so any cached row absent from the server drops out.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearVaultCache,
  FAV_TOGGLE_WINDOW_MS,
  readLastSync,
  readRecentFavoriteToggles,
  recordFavoriteToggle,
  writeLastSync,
} from "@/lib/vault-cache";
import { mergeAccountRows } from "@/lib/vault-accounts";
import type { VaultAccountRecord } from "@/lib/vault-accounts";

const USER = "user-delta";

function row(overrides: Partial<VaultAccountRecord> = {}): VaultAccountRecord {
  return {
    id: overrides.id ?? "r-1",
    issuer: "GitHub",
    label: "me@example.com",
    icon_slug: null,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    sort_order: 0,
    is_favorite: false,
    tags: [],
    secret_ciphertext: "\\x00",
    secret_iv: "\\x00",
    updated_at: "2026-07-06T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(async () => {
  await clearVaultCache();
  if (typeof localStorage !== "undefined") localStorage.clear();
});
afterEach(async () => {
  await clearVaultCache();
});

describe("last-sync marker", () => {
  it("round-trips per-user", async () => {
    expect(await readLastSync(USER)).toBeNull();
    await writeLastSync(USER, "2026-07-06T12:34:56.000Z");
    expect(await readLastSync(USER)).toBe("2026-07-06T12:34:56.000Z");
    expect(await readLastSync("other-user")).toBeNull();
  });

  it("overwrites on repeat writes", async () => {
    await writeLastSync(USER, "2026-07-06T00:00:00.000Z");
    await writeLastSync(USER, "2026-07-06T01:00:00.000Z");
    expect(await readLastSync(USER)).toBe("2026-07-06T01:00:00.000Z");
  });
});

describe("recent favorite toggle window", () => {
  it("records and reads back a fresh toggle", () => {
    recordFavoriteToggle(USER, "acc-1", true);
    expect(readRecentFavoriteToggles(USER)).toEqual({ "acc-1": true });
  });

  it("returns an empty map after the TTL window elapses", () => {
    recordFavoriteToggle(USER, "acc-1", true);
    // Simulate the toggle being > 60s old by rewriting the localStorage
    // blob with a stale `at` timestamp.
    const raw = localStorage.getItem("aegis:fav_recent:" + USER)!;
    const parsed = JSON.parse(raw) as Record<string, { value: boolean; at: number }>;
    parsed["acc-1"].at = Date.now() - FAV_TOGGLE_WINDOW_MS - 1000;
    localStorage.setItem("aegis:fav_recent:" + USER, JSON.stringify(parsed));
    expect(readRecentFavoriteToggles(USER)).toEqual({});
  });

  it("scopes toggles per user — no cross-user leakage", () => {
    recordFavoriteToggle(USER, "acc-1", true);
    recordFavoriteToggle("other-user", "acc-1", false);
    expect(readRecentFavoriteToggles(USER)).toEqual({ "acc-1": true });
    expect(readRecentFavoriteToggles("other-user")).toEqual({ "acc-1": false });
  });
});

describe("mergeAccountRows — server-wins with client-wins-on-recent-favorite override", () => {
  it("returns the server list untouched when there are no recent toggles", () => {
    const server = [row({ id: "a", is_favorite: true }), row({ id: "b", is_favorite: false })];
    const merged = mergeAccountRows(server, {});
    expect(merged).toEqual(server);
  });

  it("keeps the server value when the server already matches the recent toggle", () => {
    const server = [row({ id: "a", is_favorite: true })];
    const merged = mergeAccountRows(server, { a: true });
    expect(merged[0]).toBe(server[0]); // reference-equal — no needless clone
  });

  it("overrides is_favorite when a recent tap doesn't match the server row (client-wins)", () => {
    // User tapped the star to `true` a moment ago; the server still
    // reflects the pre-tap value because the PATCH hasn't landed yet.
    const server = [row({ id: "a", is_favorite: false, updated_at: "2026-07-06T00:00:00.000Z" })];
    const merged = mergeAccountRows(server, { a: true });
    expect(merged[0].is_favorite).toBe(true);
    // Only is_favorite is overridden — every other field still comes
    // from the server row (server-wins on everything else).
    expect(merged[0].updated_at).toBe("2026-07-06T00:00:00.000Z");
    expect(merged[0].issuer).toBe("GitHub");
  });

  it("does not resurrect a cached row that's been deleted server-side", () => {
    // The server list is authoritative for row existence — a stale
    // toggle for a deleted row is ignored (id not in server output).
    const server = [row({ id: "still-here" })];
    const merged = mergeAccountRows(server, { "deleted-elsewhere": true });
    expect(merged.map((r) => r.id)).toEqual(["still-here"]);
  });

  it("handles multiple concurrent toggles across different rows", () => {
    const server = [
      row({ id: "a", is_favorite: false }),
      row({ id: "b", is_favorite: true }),
      row({ id: "c", is_favorite: false }),
    ];
    const merged = mergeAccountRows(server, { a: true, c: true }); // b unaffected
    expect(merged.map((r) => ({ id: r.id, fav: r.is_favorite }))).toEqual([
      { id: "a", fav: true },
      { id: "b", fav: true },
      { id: "c", fav: true },
    ]);
  });

  it("returns an empty list when the server has nothing (empty vault after full delete)", () => {
    expect(mergeAccountRows([], { "some-stale-toggle": true })).toEqual([]);
  });
});
