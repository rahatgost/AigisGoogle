// E2E test for Phase 12 crypto migrator.
//
// Simulates the unlock → runV3Migration → v3 AAD flow against an in-memory
// mock of the supabase client. Verifies:
//   1. Seeded v2 rows (encrypted without AAD) upgrade to v3 (AAD-bound).
//   2. After migration, decrypting with the correct AAD succeeds and the
//      plaintext round-trips.
//   3. Row-swap tampering (using row A's ciphertext under row B's AAD) is
//      rejected by the AES-GCM tag.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  user_id: string;
  secret_ciphertext: Uint8Array;
  secret_iv: Uint8Array;
  counter_ciphertext: Uint8Array | null;
  counter_iv: Uint8Array | null;
  crypto_version: number;
}

const state: { rows: Row[]; errors: unknown[] } = { rows: [], errors: [] };

// ---- supabase mock ----------------------------------------------------------
vi.mock("@/integrations/supabase/client", () => {
  function vaultAccountsQuery() {
    const filters: Array<(r: Row) => boolean> = [];
    let limit = Infinity;
    const chain = {
      select() {
        return chain;
      },
      lt(col: keyof Row, val: number) {
        filters.push((r) => (r[col] as number) < val);
        return chain;
      },
      order() {
        return chain;
      },
      limit(n: number) {
        limit = n;
        return chain;
      },
      eq(col: keyof Row, val: string) {
        filters.push((r) => r[col] === val);
        return chain;
      },
      then(resolve: (v: { data: Row[]; error: null }) => void) {
        const data = state.rows.filter((r) => filters.every((f) => f(r))).slice(0, limit);
        resolve({ data, error: null });
      },
      update(patch: Partial<Row> & { secret_ciphertext?: string; secret_iv?: string }) {
        const upd = {
          eq(col: keyof Row, val: string) {
            for (const row of state.rows) {
              if (row[col] === val && filters.every((f) => f(row))) {
                if (typeof patch.secret_ciphertext === "string")
                  row.secret_ciphertext = hexToBytes(patch.secret_ciphertext);
                if (typeof patch.secret_iv === "string")
                  row.secret_iv = hexToBytes(patch.secret_iv);
                if (typeof patch.counter_ciphertext === "string")
                  row.counter_ciphertext = hexToBytes(patch.counter_ciphertext);
                if (typeof patch.counter_iv === "string")
                  row.counter_iv = hexToBytes(patch.counter_iv);
                if (typeof patch.crypto_version === "number")
                  row.crypto_version = patch.crypto_version;
              }
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
        return upd;
      },
    };
    return chain;
  }

  function clientErrorsQuery() {
    return {
      insert(payload: unknown) {
        state.errors.push(payload);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  return {
    supabase: {
      from(table: string) {
        if (table === "vault_accounts") return vaultAccountsQuery();
        if (table === "client_errors") return clientErrorsQuery();
        throw new Error(`unmocked table: ${table}`);
      },
    },
  };
});

function hexToBytes(input: string): Uint8Array {
  const hex = input.startsWith("\\x") ? input.slice(2) : input;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ---- test ------------------------------------------------------------------
import { runV3Migration } from "@/lib/vault-migrator";
import {
  buildAccountAad,
  decryptSecret,
  encryptSecret,
  VAULT_ROW_CRYPTO_VERSION,
} from "@/lib/vault-crypto";

async function newDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

describe("vault-migrator E2E (v2 unlock → v3 upgrade → AAD tamper rejected)", () => {
  beforeEach(() => {
    state.rows = [];
    state.errors = [];
  });

  it("upgrades v2 rows to v3 with AAD and rejects row-swap tampering", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    const dek = await newDek();

    // Seed 3 legacy v2 rows: encrypted with NO AAD, crypto_version = 2.
    const seeds = [
      { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", secret: "JBSWY3DPEHPK3PXP" },
      { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", secret: "KRSXG5A=" },
      { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", secret: "GEZDGNBVGY3TQOJQ" },
    ];
    for (const s of seeds) {
      const wrapped = await encryptSecret(dek, s.secret); // no AAD → legacy
      state.rows.push({
        id: s.id,
        user_id: userId,
        secret_ciphertext: wrapped.ciphertext,
        secret_iv: wrapped.iv,
        counter_ciphertext: null,
        counter_iv: null,
        crypto_version: 2,
      });
    }

    // Simulate the unlock handler kicking off the background migrator.
    const result = await runV3Migration(userId, dek);
    expect(result.error).toBeUndefined();
    expect(result.migrated).toBe(3);
    expect(result.skipped).toBe(false);

    // Every row is now v3 and readable with the correct AAD.
    for (const s of seeds) {
      const row = state.rows.find((r) => r.id === s.id)!;
      expect(row.crypto_version).toBe(VAULT_ROW_CRYPTO_VERSION);
      const aad = buildAccountAad(userId, row.id);
      const plaintext = await decryptSecret(dek, row.secret_ciphertext, row.secret_iv, aad);
      expect(plaintext).toBe(s.secret);
    }

    // Row-swap attack: try to decrypt row A's ciphertext under row B's AAD.
    const [rowA, rowB] = state.rows;
    const wrongAad = buildAccountAad(userId, rowB.id);
    await expect(
      decryptSecret(dek, rowA.secret_ciphertext, rowA.secret_iv, wrongAad),
    ).rejects.toBeDefined();

    // Cross-user tampering also rejected.
    const otherUserAad = buildAccountAad(
      "22222222-2222-2222-2222-222222222222",
      rowA.id,
    );
    await expect(
      decryptSecret(dek, rowA.secret_ciphertext, rowA.secret_iv, otherUserAad),
    ).rejects.toBeDefined();

    // Re-running the migrator is a no-op (idempotent).
    const second = await runV3Migration(userId, dek);
    expect(second.migrated).toBe(0);

    // Exactly one telemetry event was posted (the successful first run).
    expect(state.errors.length).toBe(1);
  });
});
