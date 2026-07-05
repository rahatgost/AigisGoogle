// Vault accounts: TOTP parsing, encryption, and CRUD helpers layered over
// the client-side DEK. Nothing here talks to the server without going
// through Supabase RLS as the authenticated user.

import * as OTPAuth from "otpauth";
import { supabase } from "@/integrations/supabase/client";
import { decryptSecret, encryptSecret, toBytes, toByteaHex } from "@/lib/vault-crypto";
import {
  isOffline,
  readVaultCache,
  removeFromVaultCache,
  upsertVaultCache,
  writeVaultCache,
} from "@/lib/vault-cache";

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
  secret_ciphertext: unknown;
  secret_iv: unknown;
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
  },
): Promise<void> {
  const clean = normalizeBase32(input.secret);
  if (!isValidBase32Secret(clean)) throw new Error("Invalid secret. Must be base32.");

  const { ciphertext, iv } = await encryptSecret(dek, clean);

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
      secret_ciphertext: toByteaHex(ciphertext),
      secret_iv: toByteaHex(iv),
    })
    .select(
      "id, issuer, label, icon_slug, algorithm, digits, period, sort_order, is_favorite, secret_ciphertext, secret_iv",
    )
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
  const { data, error } = await supabase
    .from("vault_accounts")
    .update({ is_favorite: isFavorite })
    .eq("id", id)
    .select(
      "id, issuer, label, icon_slug, algorithm, digits, period, sort_order, is_favorite, secret_ciphertext, secret_iv",
    )
    .single();
  if (error) throw error;
  if (data) void upsertVaultCache(data as VaultAccountRecord);
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
        secret,
      } satisfies DecryptedAccount;
    }),
  );
}

export async function listAccounts(dek: CryptoKey): Promise<DecryptedAccount[]> {
  const { data, error } = await supabase
    .from("vault_accounts")
    .select(
      "id, issuer, label, icon_slug, algorithm, digits, period, sort_order, is_favorite, secret_ciphertext, secret_iv",
    )
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
      const { data, error } = await supabase
        .from("vault_accounts")
        .select(
          "id, issuer, label, icon_slug, algorithm, digits, period, sort_order, is_favorite, secret_ciphertext, secret_iv",
        )
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

