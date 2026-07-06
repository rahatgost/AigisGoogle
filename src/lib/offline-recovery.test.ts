// Phase 6 offline-mode integration tests.
//
// Two invariants matter when the user is offline:
//   1. An encrypted `.avf` export they hold themselves is the only durable
//      escape hatch when the server is unreachable. Round-trip must be
//      lossless AND resistant to the usual tampering: wrong passphrase,
//      corrupted ciphertext, mislabelled format, future version.
//   2. The IndexedDB vault cache is the *only* thing between the user and
//      a blank screen when the browser can't reach Supabase. It must:
//        - return the last-known ciphertext even with `navigator.onLine`
//          false and the network stubbed to reject,
//        - never leak one user's rows into another user's session,
//        - reflect offline mutations (delete / upsert) on the next read,
//        - fail closed (return null, not throw) on any storage hiccup.
//
// The tests exercise both modules end-to-end against fake-indexeddb +
// Node's WebCrypto — the same primitives that ship in the browser.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AVF_FORMAT,
  buildEncryptedExport,
  decryptExportedFile,
  serializeExport,
  type EncryptedExportFile,
} from "@/lib/vault-export";
import {
  clearVaultCache,
  isOffline,
  readVaultCache,
  removeFromVaultCache,
  upsertVaultCache,
  writeVaultCache,
} from "@/lib/vault-cache";
import type { DecryptedAccount, VaultAccountRecord } from "@/lib/vault-accounts";

const USER_A = "user-alpha";
const USER_B = "user-beta";
const PASS = "correct horse battery staple";

function acc(overrides: Partial<DecryptedAccount> = {}): DecryptedAccount {
  return {
    id: overrides.id ?? "acc-1",
    issuer: "GitHub",
    label: "me@example.com",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    sort_order: 0,
    is_favorite: false,
    tags: [],
    secret: "JBSWY3DPEHPK3PXP",
    otp_type: "totp",
    ...overrides,
  };
}

function row(overrides: Partial<VaultAccountRecord> = {}): VaultAccountRecord {
  return {
    id: overrides.id ?? "row-1",
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

function setOnline(online: boolean): void {
  Object.defineProperty(globalThis.navigator, "onLine", {
    value: online,
    configurable: true,
  });
}

beforeEach(async () => {
  await clearVaultCache();
  setOnline(true);
});
afterEach(async () => {
  await clearVaultCache();
  setOnline(true);
  vi.restoreAllMocks();
});

describe("offline: encrypted export → restore round-trip", () => {
  it("survives the export → restore cycle losslessly (multi-account)", async () => {
    const original = [
      acc({ id: "1", issuer: "GitHub", label: "me", secret: "JBSWY3DPEHPK3PXP" }),
      acc({
        id: "2",
        issuer: "AWS",
        label: "prod-root",
        secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        algorithm: "SHA256",
        digits: 8,
        period: 60,
      }),
    ];

    const file = await buildEncryptedExport(original, PASS);
    expect(file.format).toBe(AVF_FORMAT);
    expect(file.cipher.algo).toBe("AES-GCM");
    // Sanity — nothing in the envelope should contain a raw secret.
    const wireBytes = serializeExport(file);
    for (const a of original) expect(wireBytes).not.toContain(a.secret);

    const restored = await decryptExportedFile(file, PASS);
    expect(restored).toHaveLength(2);
    expect(restored[0]).toMatchObject({
      issuer: "GitHub",
      label: "me",
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
    expect(restored[1]).toMatchObject({
      issuer: "AWS",
      label: "prod-root",
      secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      algorithm: "SHA256",
      digits: 8,
      period: 60,
    });
  });

  it("survives the round-trip while completely offline", async () => {
    // Simulate a device with no network — export + restore should not
    // touch the server at all.
    setOnline(false);
    expect(isOffline()).toBe(true);

    const file = await buildEncryptedExport([acc()], PASS);
    const restored = await decryptExportedFile(file, PASS);
    expect(restored[0].secret).toBe("JBSWY3DPEHPK3PXP");
  });

  it("rejects the wrong export passphrase with a user-safe error", async () => {
    const file = await buildEncryptedExport([acc()], PASS);
    await expect(decryptExportedFile(file, "totally-wrong-pass")).rejects.toThrow(
      /wrong export passphrase|corrupted/i,
    );
  });

  it("rejects a mislabelled envelope (format field tampered)", async () => {
    const file = await buildEncryptedExport([acc()], PASS);
    const bad: EncryptedExportFile = { ...file, format: "not-aegis" as typeof AVF_FORMAT };
    await expect(decryptExportedFile(bad, PASS)).rejects.toThrow(/not an aegis vault file/i);
  });

  it("rejects an envelope from a newer crypto version", async () => {
    const file = await buildEncryptedExport([acc()], PASS);
    const future: EncryptedExportFile = { ...file, version: file.version + 5 };
    await expect(decryptExportedFile(future, PASS)).rejects.toThrow(/newer version/i);
  });

  it("rejects flipped ciphertext bytes (integrity check via AES-GCM tag)", async () => {
    const file = await buildEncryptedExport([acc()], PASS);
    // Flip the first nibble of the ciphertext — AES-GCM's auth tag must catch it.
    const flipped = (file.cipher.ciphertext[0] === "0" ? "f" : "0") + file.cipher.ciphertext.slice(1);
    const tampered: EncryptedExportFile = {
      ...file,
      cipher: { ...file.cipher, ciphertext: flipped },
    };
    await expect(decryptExportedFile(tampered, PASS)).rejects.toThrow(
      /wrong export passphrase|corrupted/i,
    );
  });

  it("refuses to build an export with a too-short passphrase", async () => {
    await expect(buildEncryptedExport([acc()], "short")).rejects.toThrow(/at least 10/i);
  });

  it("two exports of the same accounts produce different ciphertext (fresh IV + salt)", async () => {
    const a = await buildEncryptedExport([acc()], PASS);
    const b = await buildEncryptedExport([acc()], PASS);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.ciphertext).not.toBe(b.cipher.ciphertext);
  });
});

describe("offline: cache recovery when the server is unreachable", () => {
  it("reads the last-known rows from cache when the network is down and the server rejects", async () => {
    // Online: populate the cache.
    await writeVaultCache(USER_A, [
      row({ id: "a", tags: ["work"], is_favorite: true }),
      row({ id: "b", tags: [] }),
    ]);

    // Go offline. Any "server call" should fail — but the vault must
    // still resolve from the cache without throwing.
    setOnline(false);
    expect(isOffline()).toBe(true);
    const serverFetch = vi.fn().mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED"));

    async function loadVault(userId: string): Promise<VaultAccountRecord[]> {
      // Mirror the real loader shape: try the server, fall back to cache.
      try {
        return await serverFetch();
      } catch {
        const cached = await readVaultCache(userId);
        if (cached) return cached;
        throw new Error("offline and no cache");
      }
    }

    const rows = await loadVault(USER_A);
    expect(serverFetch).toHaveBeenCalledTimes(1);
    expect(rows.map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect(rows.find((r) => r.id === "a")?.is_favorite).toBe(true);
  });

  it("returns null after a user switch — no ciphertext leaks across accounts", async () => {
    await writeVaultCache(USER_A, [row({ id: "private-to-a", tags: ["secret"] })]);
    // Different signed-in user hits the same origin's IndexedDB.
    expect(await readVaultCache(USER_B)).toBeNull();
    // Re-reading as USER_A still works.
    const back = await readVaultCache(USER_A);
    expect(back?.[0].id).toBe("private-to-a");
  });

  it("a new user's write evicts the previous user's ciphertext (owner rotation)", async () => {
    await writeVaultCache(USER_A, [row({ id: "a-only" })]);
    await writeVaultCache(USER_B, [row({ id: "b-only" })]);
    // USER_A can no longer see their old rows — they were cleared by the
    // owner rotation inside writeVaultCache.
    expect(await readVaultCache(USER_A)).toBeNull();
    const bRows = await readVaultCache(USER_B);
    expect(bRows?.map((r) => r.id)).toEqual(["b-only"]);
  });

  it("reflects an offline delete on the next cache read", async () => {
    await writeVaultCache(USER_A, [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })]);
    setOnline(false);
    // Offline delete — the outbox will replay to the server on reconnect,
    // but the local cache must already show the row gone.
    await removeFromVaultCache("b");
    const rows = await readVaultCache(USER_A);
    expect(rows?.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("reflects an offline upsert (favorite toggle) on the next cache read", async () => {
    await writeVaultCache(USER_A, [row({ id: "a", is_favorite: false, tags: ["work"] })]);
    setOnline(false);
    const before = (await readVaultCache(USER_A))?.[0];
    await upsertVaultCache({ ...before!, is_favorite: true });
    const after = (await readVaultCache(USER_A))?.[0];
    expect(after?.is_favorite).toBe(true);
    expect(after?.tags).toEqual(["work"]); // untouched field preserved
  });

  it("returns null when the cache is empty (not [] — loader distinguishes 'no cache' from 'empty vault')", async () => {
    await clearVaultCache();
    expect(await readVaultCache(USER_A)).toBeNull();
  });

  it("clearVaultCache wipes rows and owner — a subsequent read for the old user is null", async () => {
    await writeVaultCache(USER_A, [row({ id: "a" })]);
    await clearVaultCache();
    expect(await readVaultCache(USER_A)).toBeNull();
  });

  it("recovery flow: online write → offline reload → online refresh reconciles new rows", async () => {
    // 1. Online populate.
    await writeVaultCache(USER_A, [row({ id: "a", tags: ["work"] })]);

    // 2. Simulate a page reload while offline. Cache hydrates the UI.
    setOnline(false);
    const offlineSnapshot = await readVaultCache(USER_A);
    expect(offlineSnapshot?.map((r) => r.id)).toEqual(["a"]);

    // 3. Network comes back and the server returns a superset (a new
    //    account was added on another device). Loader mirrors the fresh
    //    snapshot into cache — old rows evicted, new rows visible.
    setOnline(true);
    await writeVaultCache(USER_A, [
      row({ id: "a", tags: ["work", "personal"] }), // tags updated server-side
      row({ id: "z", tags: ["new-device"] }), // brand new row from another device
    ]);
    const merged = await readVaultCache(USER_A);
    expect(merged?.map((r) => r.id).sort()).toEqual(["a", "z"]);
    expect(merged?.find((r) => r.id === "a")?.tags).toEqual(["work", "personal"]);
    expect(merged?.find((r) => r.id === "z")?.tags).toEqual(["new-device"]);
  });
});
