// Phase 12.2 — background v2 → v3 row re-encrypt migrator.
//
// On first unlock after upgrading to a crypto-v3-aware client, we walk
// every `vault_accounts` row whose `crypto_version < 3`, decrypt its
// secret (and HOTP counter, if any) under the current DEK with NO
// additional-data, re-encrypt with AAD bound to `utf8(user_id|account_id)`,
// then UPDATE the row and bump `crypto_version` to 3. The DEK itself
// never changes — only the per-row ciphertext envelope.
//
// Design constraints
// ------------------
//   • Non-blocking: runs in background after `setVaultKey`, never blocks
//     the router transition into `/vault`.
//   • Batched + resumable: 10 rows per round-trip; if the tab closes
//     mid-migration the next unlock resumes from wherever the previous
//     one left off (we always query `crypto_version < 3` fresh).
//   • Idempotent: skipping rows that are already v3 costs one COUNT-style
//     query; safe to invoke on every unlock.
//   • Serialized per user: a module-level `Set` guards against two
//     concurrent runs (unlock → re-focus → unlock again).
//   • Telemetry: on completion, one `client_errors` row with kind=`info`
//     summarizing `{ from, to, rows_migrated, elapsed_ms }`.

import { supabase } from "@/integrations/supabase/client";
import {
  buildAccountAad,
  decryptSecret,
  encryptSecret,
  toBytes,
  toByteaHex,
  VAULT_ROW_CRYPTO_VERSION,
} from "@/lib/vault-crypto";

const BATCH_SIZE = 10;
const inFlight = new Set<string>();

interface MigratableRow {
  id: string;
  secret_ciphertext: unknown;
  secret_iv: unknown;
  counter_ciphertext: unknown | null;
  counter_iv: unknown | null;
  crypto_version: number | null;
}

export interface MigrationResult {
  migrated: number;
  elapsedMs: number;
  skipped: boolean;
  error?: string;
}

/**
 * Kick off the v2 → v3 row upgrade in the background. Safe to fire-and-forget
 * from the unlock handler — errors surface only via `client_errors` telemetry.
 */
export async function runV3Migration(
  userId: string,
  dek: CryptoKey,
): Promise<MigrationResult> {
  if (inFlight.has(userId)) return { migrated: 0, elapsedMs: 0, skipped: true };
  inFlight.add(userId);
  const startedAt = Date.now();
  let migrated = 0;
  try {
    // Loop batches until the query returns fewer than BATCH_SIZE rows.
    for (;;) {
      const { data, error } = await supabase
        .from("vault_accounts")
        .select("id, secret_ciphertext, secret_iv, counter_ciphertext, counter_iv, crypto_version")
        .lt("crypto_version", VAULT_ROW_CRYPTO_VERSION)
        .order("id", { ascending: true })
        .limit(BATCH_SIZE);
      if (error) throw error;
      const rows = (data ?? []) as MigratableRow[];
      if (rows.length === 0) break;

      for (const row of rows) {
        const aad = buildAccountAad(userId, row.id);
        // Legacy v2 rows: decrypt WITHOUT AAD, re-encrypt WITH AAD.
        const plaintext = await decryptSecret(
          dek,
          toBytes(row.secret_ciphertext),
          toBytes(row.secret_iv),
        );
        const rewrapped = await encryptSecret(dek, plaintext, aad);
        const update: Record<string, string | number> = {
          secret_ciphertext: toByteaHex(rewrapped.ciphertext),
          secret_iv: toByteaHex(rewrapped.iv),
          crypto_version: VAULT_ROW_CRYPTO_VERSION,
        };
        if (row.counter_ciphertext && row.counter_iv) {
          try {
            const counterPlain = await decryptSecret(
              dek,
              toBytes(row.counter_ciphertext),
              toBytes(row.counter_iv),
            );
            const counterRewrapped = await encryptSecret(dek, counterPlain, aad);
            update.counter_ciphertext = toByteaHex(counterRewrapped.ciphertext);
            update.counter_iv = toByteaHex(counterRewrapped.iv);
          } catch {
            // Corrupt counter — leave the row's counter fields untouched;
            // the secret still upgrades so future advances start clean.
          }
        }
        const { error: updErr } = await supabase
          .from("vault_accounts")
          .update(update)
          .eq("id", row.id);
        if (updErr) throw updErr;
        migrated += 1;
      }
      if (rows.length < BATCH_SIZE) break;
    }

    const elapsedMs = Date.now() - startedAt;
    if (migrated > 0) {
      void reportTelemetry({ from: 2, to: VAULT_ROW_CRYPTO_VERSION, rowsMigrated: migrated, elapsedMs });
    }
    return { migrated, elapsedMs, skipped: false };
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : "Unknown error";
    void reportTelemetry({
      from: 2,
      to: VAULT_ROW_CRYPTO_VERSION,
      rowsMigrated: migrated,
      elapsedMs,
      error: message,
    });
    return { migrated, elapsedMs, skipped: false, error: message };
  } finally {
    inFlight.delete(userId);
  }
}

async function reportTelemetry(payload: {
  from: number;
  to: number;
  rowsMigrated: number;
  elapsedMs: number;
  error?: string;
}): Promise<void> {
  try {
    await supabase.from("client_errors").insert({
      kind: payload.error ? "error" : "info",
      message: payload.error
        ? `vault-migrator v${payload.from}->v${payload.to} failed after ${payload.rowsMigrated} row(s): ${payload.error}`
        : `vault-migrator v${payload.from}->v${payload.to} completed`,
      metadata: {
        component: "vault-migrator",
        from: payload.from,
        to: payload.to,
        rows_migrated: payload.rowsMigrated,
        elapsed_ms: payload.elapsedMs,
      },
    });
  } catch {
    // Telemetry is best-effort; never surface to user.
  }
}
