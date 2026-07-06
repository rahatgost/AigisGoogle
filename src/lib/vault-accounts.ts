// Vault accounts: TOTP parsing, encryption, and CRUD helpers layered over
// the client-side DEK. Nothing here talks to the server without going
// through Supabase RLS as the authenticated user.

import * as OTPAuth from "otpauth";
import { supabase } from "@/integrations/supabase/client";
import { decryptSecret, encryptSecret, toBytes, toByteaHex } from "@/lib/vault-crypto";
import {
  clearFavoriteToggle,
  isOffline,
  readLastSync,
  readRecentFavoriteToggles,
  readVaultCache,
  recordFavoriteToggle,
  removeFromVaultCache,
  upsertVaultCache,
  writeLastSync,
  writeVaultCache,
} from "@/lib/vault-cache";
import { normalizeTagList } from "@/components/vault/tags";
import {
  dequeueTagUpdate,
  enqueueTagUpdate,
  flushQueuedTagUpdates,
} from "@/lib/vault-tag-queue";

const ACCOUNT_SELECT =
  "id, issuer, label, icon_slug, algorithm, digits, period, sort_order, is_favorite, tags, secret_ciphertext, secret_iv, updated_at";

export type Algorithm = "SHA1" | "SHA256" | "SHA512";

export interface VaultAccountRecord {
  id: string;
  issuer: string;
  label: string;
  icon_slug: string | null;
  algorithm: Algorithm;
  digits: number;
  period: number;
  sort_order: number;
  is_favorite: boolean;
  tags: string[];
  secret_ciphertext: unknown;
  secret_iv: unknown;
  // Phase 6.2: server-side row version. Drives diff sync (`updated_at >
  // last_sync`) and the server-wins-on-tie merge rule.
  updated_at: string;
}

export interface DecryptedAccount {
  id: string;
  issuer: string;
  label: string;
  algorithm: Algorithm;
  digits: number;
  period: number;
  sort_order: number;
  is_favorite: boolean;
  tags: string[];
  secret: string; // base32
}

export interface ParsedOtpauth {
  issuer: string;
  label: string;
  secret: string;
  algorithm: Algorithm;
  digits: number;
  period: number;
}

const BASE32_RE = /^[A-Z2-7]+=*$/i;

function normalizeBase32(s: string): string {
  return s.replace(/[\s-]/g, "").toUpperCase();
}

export function isValidBase32Secret(s: string): boolean {
  const clean = normalizeBase32(s);
  return clean.length >= 16 && BASE32_RE.test(clean);
}

export function parseOtpauthUri(uri: string): ParsedOtpauth {
  const totp = OTPAuth.URI.parse(uri);
  if (!(totp instanceof OTPAuth.TOTP)) {
    throw new Error("Only TOTP codes are supported.");
  }
  const algorithm = (totp.algorithm.toUpperCase() as Algorithm) ?? "SHA1";
  return {
    issuer: (totp.issuer || "").trim(),
    label: (totp.label || "").trim(),
    secret: totp.secret.base32,
    algorithm: (["SHA1", "SHA256", "SHA512"].includes(algorithm) ? algorithm : "SHA1") as Algorithm,
    digits: totp.digits ?? 6,
    period: totp.period ?? 30,
  };
}

export function generateCode(account: DecryptedAccount, at: number = Date.now()): string {
  const totp = new OTPAuth.TOTP({
    issuer: account.issuer,
    label: account.label,
    algorithm: account.algorithm,
    digits: account.digits,
    period: account.period,
    secret: OTPAuth.Secret.fromBase32(normalizeBase32(account.secret)),
  });
  return totp.generate({ timestamp: at });
}

export async function addAccount(
  dek: CryptoKey,
  userId: string,
  input: {
    issuer: string;
    label: string;
    secret: string;
    algorithm?: Algorithm;
    digits?: number;
    period?: number;
    icon_slug?: string | null;
    tags?: string[];
  },
): Promise<void> {
  const clean = normalizeBase32(input.secret);
  if (!isValidBase32Secret(clean)) throw new Error("Invalid secret. Must be base32.");

  const { ciphertext, iv } = await encryptSecret(dek, clean);
  const tags = normalizeTagList(input.tags ?? []);

  const { data, error } = await supabase
    .from("vault_accounts")
    .insert({
      user_id: userId,
      issuer: input.issuer.trim(),
      label: input.label.trim(),
      icon_slug: input.icon_slug ?? null,
      algorithm: input.algorithm ?? "SHA1",
      digits: input.digits ?? 6,
      period: input.period ?? 30,
      tags,
      secret_ciphertext: toByteaHex(ciphertext),
      secret_iv: toByteaHex(iv),
    })
    .select(ACCOUNT_SELECT)
    .single();
  if (error) throw error;
  if (data) void upsertVaultCache(data as VaultAccountRecord);
}

export async function deleteAccount(id: string): Promise<void> {
  const { error } = await supabase.from("vault_accounts").delete().eq("id", id);
  if (error) throw error;
  void removeFromVaultCache(id);
}

export async function setAccountFavorite(id: string, isFavorite: boolean): Promise<void> {
  // Phase 6.2: record the toggle so an in-flight diff-sync doesn't
  // clobber it with the pre-toggle server value. Best-effort — resolves
  // the user_id from the account row we're about to write.
  const { data, error } = await supabase
    .from("vault_accounts")
    .update({ is_favorite: isFavorite })
    .eq("id", id)
    .select(ACCOUNT_SELECT + ", user_id")
    .single();
  if (error) throw error;
  if (data) {
    const row = data as VaultAccountRecord & { user_id: string };
    void upsertVaultCache(row);
    recordFavoriteToggle(row.user_id, id, isFavorite);
    // The server has confirmed our value — the optimistic-window entry
    // has done its job for future syncs but we can drop it now that
    // the cached row already carries the confirmed value.
    clearFavoriteToggle(row.user_id, id);
  }
}

/** Update the editable account metadata (issuer + label). */
export async function updateAccountDetails(
  id: string,
  input: { issuer: string; label: string },
): Promise<{ issuer: string; label: string }> {
  const issuer = input.issuer.trim();
  const label = input.label.trim();
  if (!issuer) throw new Error("Service name can't be empty.");
  const { data, error } = await supabase
    .from("vault_accounts")
    .update({ issuer, label })
    .eq("id", id)
    .select(ACCOUNT_SELECT)
    .single();
  if (error) throw error;
  if (data) void upsertVaultCache(data as VaultAccountRecord);
  return { issuer, label };
}

/**
 * Overwrite an account's tag list. Client normalises + caps at 20.
 *
 * When we're offline (or the network write fails), the change is queued
 * to localStorage and the vault cache is patched optimistically so the
 * UI stays in sync. The caller receives `{ tags, queued: true }` and can
 * surface a "will sync when online" hint instead of a hard error.
 */
export async function setAccountTags(
  id: string,
  tags: string[],
): Promise<{ tags: string[]; queued: boolean }> {
  const normalized = normalizeTagList(tags);
  const attempt = async () => {
    const { data, error } = await supabase
      .from("vault_accounts")
      .update({ tags: normalized })
      .eq("id", id)
      .select(ACCOUNT_SELECT)
      .single();
    if (error) throw error;
    if (data) void upsertVaultCache(data as VaultAccountRecord);
  };

  if (isOffline()) {
    enqueueTagUpdate(id, normalized);
    await patchCachedTags(id, normalized);
    return { tags: normalized, queued: true };
  }

  try {
    await attempt();
    dequeueTagUpdate(id);
    return { tags: normalized, queued: false };
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      enqueueTagUpdate(id, normalized);
      await patchCachedTags(id, normalized);
      return { tags: normalized, queued: true };
    }
    throw err;
  }
}

/** Best-effort patch of the offline cache without a fresh server row. */
async function patchCachedTags(id: string, tags: string[]): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const rows = await readVaultCache(user.id);
    const row = rows?.find((r) => r.id === id);
    if (!row) return;
    await upsertVaultCache({ ...row, tags });
  } catch {
    // Cache is best-effort.
  }
}

function isLikelyNetworkError(err: unknown): boolean {
  if (!err) return false;
  let msg = "";
  if (err instanceof Error) msg = err.message;
  else if (typeof err === "object" && err !== null && "message" in err) {
    msg = String((err as { message: unknown }).message ?? "");
  } else {
    msg = String(err);
  }
  return /network|fetch|failed to fetch|offline|timeout|load failed|networkerror/i.test(msg);
}

/**
 * Flush any tag updates queued while offline. Returns the count of rows
 * that reached the server. Safe to call repeatedly.
 */
export async function flushPendingTagUpdates(): Promise<number> {
  if (isOffline()) return 0;
  const synced = await flushQueuedTagUpdates(async (id, tags) => {
    const { data, error } = await supabase
      .from("vault_accounts")
      .update({ tags: normalizeTagList(tags) })
      .eq("id", id)
      .select(ACCOUNT_SELECT)
      .single();
    if (error) throw error;
    if (data) void upsertVaultCache(data as VaultAccountRecord);
  });
  return synced.length;
}

async function decryptRows(
  dek: CryptoKey,
  rows: VaultAccountRecord[],
): Promise<DecryptedAccount[]> {
  return Promise.all(
    rows.map(async (r) => {
      const secret = await decryptSecret(dek, toBytes(r.secret_ciphertext), toBytes(r.secret_iv));
      return {
        id: r.id,
        issuer: r.issuer,
        label: r.label,
        algorithm: r.algorithm,
        digits: r.digits,
        period: r.period,
        sort_order: r.sort_order,
        is_favorite: r.is_favorite,
        tags: Array.isArray(r.tags) ? r.tags : [],
        secret,
      } satisfies DecryptedAccount;
    }),
  );
}

export async function listAccounts(dek: CryptoKey): Promise<DecryptedAccount[]> {
  const { data, error } = await supabase
    .from("vault_accounts")
    .select(ACCOUNT_SELECT)
    .order("is_favorite", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return decryptRows(dek, (data ?? []) as VaultAccountRecord[]);
}

/**
 * Vault load with an offline fallback. When we're online we fetch from the
 * server and refresh the IndexedDB mirror in the background. When offline
 * (or when the network fetch fails), we decrypt the cached ciphertext so
 * the user can still see codes on the subway. The cache never holds
 * plaintext — decryption still requires the DEK in memory.
 *
 * Returns `{ source: 'network' | 'cache' | 'empty' }` so the UI can show an
 * "offline — showing cached codes" banner when appropriate.
 */
export async function listAccountsWithCache(
  dek: CryptoKey,
  userId: string,
): Promise<{ accounts: DecryptedAccount[]; source: "network" | "cache" | "empty" }> {
  const online = !isOffline();
  if (online) {
    try {
      // Flush any tag edits queued while offline BEFORE reading, so the
      // fetched rows already reflect them.
      await flushPendingTagUpdates().catch(() => 0);
      const { data, error } = await supabase
        .from("vault_accounts")
        .select(ACCOUNT_SELECT)
        .order("is_favorite", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as VaultAccountRecord[];
      void writeVaultCache(userId, rows);
      const accounts = await decryptRows(dek, rows);
      return { accounts, source: "network" };
    } catch {
      // Network error mid-flight — fall through to cache below.
    }
  }

  const cached = await readVaultCache(userId);
  if (!cached) return { accounts: [], source: "empty" };
  const accounts = await decryptRows(dek, cached);
  return { accounts, source: "cache" };
}


