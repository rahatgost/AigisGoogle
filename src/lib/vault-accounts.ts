// Vault accounts: TOTP parsing, encryption, and CRUD helpers layered over
// the client-side DEK. Nothing here talks to the server without going
// through Supabase RLS as the authenticated user.

import * as OTPAuth from "otpauth";
import { supabase } from "@/integrations/supabase/client";
import { decryptSecret, encryptSecret, toBytes, toByteaHex } from "@/lib/vault-crypto";
import {
  clearFavoriteToggle,
  isOffline,
  patchCacheSortOrders,
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
import {
  dequeueOutbox,
  enqueueCreate,
  enqueueDelete,
  enqueueFavorite,
  enqueueUpdateDetails,
  flushOutbox,
  outboxSize,
  type CreatePayload,
} from "@/lib/vault-outbox";

const ACCOUNT_SELECT =
  "id, issuer, label, icon_slug, algorithm, digits, period, sort_order, is_favorite, tags, secret_ciphertext, secret_iv, otp_type, counter_ciphertext, counter_iv, updated_at";

export type Algorithm = "SHA1" | "SHA256" | "SHA512";
export type OtpType = "totp" | "hotp" | "steam";

// Steam Guard uses a fixed 26-char alphabet, 5-char output, 30s period,
// SHA1 HMAC on the standard 8-byte counter block. Digits stored as 5 for
// display consistency; algorithm/period stay 'SHA1'/30.
const STEAM_ALPHABET = "23456789BCDFGHJKMNPQRTVWXY";
const STEAM_PERIOD = 30;

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
  // Phase 7.4: OTP variant discriminator (server sees the type but never
  // the HOTP counter — that lives in the encrypted counter_ciphertext).
  // Optional because rows cached before the 7.4 migration lack these; read
  // paths default to 'totp'.
  otp_type?: OtpType;
  counter_ciphertext?: unknown | null;
  counter_iv?: unknown | null;
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
  otp_type: OtpType;
  counter?: number; // HOTP only; TOTP/Steam ignore
}

export interface ParsedOtpauth {
  issuer: string;
  label: string;
  secret: string;
  algorithm: Algorithm;
  digits: number;
  period: number;
  otp_type?: OtpType;
  counter?: number;
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
  // Steam Guard is often published as `otpauth://steam/...` — otpauth's
  // parser rejects it, so detect it up-front and parse via the URL API.
  if (/^otpauth:\/\/steam\//i.test(uri)) {
    const u = new URL(uri);
    const secret = (u.searchParams.get("secret") || "").trim();
    if (!secret) throw new Error("Steam otpauth URI is missing 'secret'.");
    const rawLabel = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    const issuer = (u.searchParams.get("issuer") || "Steam").trim();
    let label = rawLabel;
    if (label.includes(":")) label = label.split(":").slice(1).join(":").trim();
    return {
      issuer,
      label,
      secret: normalizeBase32(secret),
      algorithm: "SHA1",
      digits: 5,
      period: STEAM_PERIOD,
      otp_type: "steam",
    };
  }

  const parsed = OTPAuth.URI.parse(uri);
  if (parsed instanceof OTPAuth.HOTP) {
    const algorithm = (parsed.algorithm.toUpperCase() as Algorithm) ?? "SHA1";
    return {
      issuer: (parsed.issuer || "").trim(),
      label: (parsed.label || "").trim(),
      secret: parsed.secret.base32,
      algorithm: (["SHA1", "SHA256", "SHA512"].includes(algorithm)
        ? algorithm
        : "SHA1") as Algorithm,
      digits: parsed.digits ?? 6,
      period: 30,
      otp_type: "hotp",
      counter: Number(parsed.counter ?? 0),
    };
  }
  if (!(parsed instanceof OTPAuth.TOTP)) {
    throw new Error("Only TOTP, HOTP, and Steam codes are supported.");
  }
  const algorithm = (parsed.algorithm.toUpperCase() as Algorithm) ?? "SHA1";
  return {
    issuer: (parsed.issuer || "").trim(),
    label: (parsed.label || "").trim(),
    secret: parsed.secret.base32,
    algorithm: (["SHA1", "SHA256", "SHA512"].includes(algorithm)
      ? algorithm
      : "SHA1") as Algorithm,
    digits: parsed.digits ?? 6,
    period: parsed.period ?? 30,
    otp_type: "totp",
  };
}

function generateSteamCode(secretBase32: string, at: number): string {
  // Steam Guard = HOTP over T=floor(now/30) with a 26-char alphabet mapping.
  // We reuse OTPAuth's HOTP with digits=10 (holds the full 31-bit truncated
  // value) then convert to the Steam alphabet via divmod. Sync + deterministic.
  const hotp = new OTPAuth.HOTP({
    algorithm: "SHA1",
    digits: 10,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  const T = Math.floor(at / 1000 / STEAM_PERIOD);
  let value = Number.parseInt(hotp.generate({ counter: T }), 10);
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += STEAM_ALPHABET[value % STEAM_ALPHABET.length];
    value = Math.floor(value / STEAM_ALPHABET.length);
  }
  return out;
}

export function generateCode(account: DecryptedAccount, at: number = Date.now()): string {
  const clean = normalizeBase32(account.secret);
  if (account.otp_type === "steam") {
    return generateSteamCode(clean, at);
  }
  if (account.otp_type === "hotp") {
    const hotp = new OTPAuth.HOTP({
      issuer: account.issuer,
      label: account.label,
      algorithm: account.algorithm,
      digits: account.digits,
      secret: OTPAuth.Secret.fromBase32(clean),
    });
    return hotp.generate({ counter: account.counter ?? 0 });
  }
  const totp = new OTPAuth.TOTP({
    issuer: account.issuer,
    label: account.label,
    algorithm: account.algorithm,
    digits: account.digits,
    period: account.period,
    secret: OTPAuth.Secret.fromBase32(clean),
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
): Promise<{ queued: boolean }> {
  const clean = normalizeBase32(input.secret);
  if (!isValidBase32Secret(clean)) throw new Error("Invalid secret. Must be base32.");

  const { ciphertext, iv } = await encryptSecret(dek, clean);
  const tags = normalizeTagList(input.tags ?? []);
  const issuer = input.issuer.trim();
  const label = input.label.trim();
  const algorithm = input.algorithm ?? "SHA1";
  const digits = input.digits ?? 6;
  const period = input.period ?? 30;
  const icon_slug = input.icon_slug ?? null;

  const insertRow = {
    user_id: userId,
    issuer,
    label,
    icon_slug,
    algorithm,
    digits,
    period,
    tags,
    secret_ciphertext: toByteaHex(ciphertext),
    secret_iv: toByteaHex(iv),
  };

  const enqueueOfflineCreate = async () => {
    // A client-generated UUID becomes the row's server id on flush. The
    // cached row uses the same id, so any follow-up delete / edit made
    // while still offline can target it directly.
    const clientId = generateClientId();
    const payload: CreatePayload = {
      userId,
      issuer,
      label,
      icon_slug,
      algorithm,
      digits,
      period,
      tags,
      is_favorite: false,
      secret_ciphertext_hex: toByteaHex(ciphertext),
      secret_iv_hex: toByteaHex(iv),
    };
    enqueueCreate(clientId, payload);
    const cachedRow: VaultAccountRecord = {
      id: clientId,
      issuer,
      label,
      icon_slug,
      algorithm,
      digits,
      period,
      sort_order: 0,
      is_favorite: false,
      tags,
      secret_ciphertext: toByteaHex(ciphertext),
      secret_iv: toByteaHex(iv),
      updated_at: new Date().toISOString(),
    };
    await upsertVaultCache(cachedRow);
  };

  if (isOffline()) {
    await enqueueOfflineCreate();
    return { queued: true };
  }

  try {
    const { data, error } = await supabase
      .from("vault_accounts")
      .insert(insertRow)
      .select(ACCOUNT_SELECT)
      .single();
    if (error) throw error;
    if (data) void upsertVaultCache(data as VaultAccountRecord);
    return { queued: false };
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      await enqueueOfflineCreate();
      return { queued: true };
    }
    throw err;
  }
}

function generateClientId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback: RFC4122-ish v4 shape sufficient for a Postgres uuid column.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

/**
 * Delete an account row. Queued to the offline outbox when offline (or when
 * a network write fails) — the local cache row is removed immediately so
 * the UI reflects the intent, and the server DELETE runs on reconnect.
 */
export async function deleteAccount(id: string): Promise<{ queued: boolean }> {
  const attempt = async () => {
    const { error } = await supabase.from("vault_accounts").delete().eq("id", id);
    if (error) throw error;
  };

  if (isOffline()) {
    enqueueDelete(id);
    void removeFromVaultCache(id);
    return { queued: true };
  }

  try {
    await attempt();
    dequeueOutbox(id);
    void removeFromVaultCache(id);
    return { queued: false };
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      enqueueDelete(id);
      void removeFromVaultCache(id);
      return { queued: true };
    }
    throw err;
  }
}

export async function setAccountFavorite(
  id: string,
  isFavorite: boolean,
): Promise<{ queued: boolean }> {
  const attempt = async () => {
    const { data, error } = await supabase
      .from("vault_accounts")
      .update({ is_favorite: isFavorite })
      .eq("id", id)
      .select(ACCOUNT_SELECT + ", user_id")
      .single();
    if (error) throw error;
    if (data) {
      const row = data as unknown as VaultAccountRecord & { user_id: string };
      void upsertVaultCache(row);
      recordFavoriteToggle(row.user_id, id, isFavorite);
      clearFavoriteToggle(row.user_id, id);
    }
  };

  const patchCacheFavorite = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const rows = await readVaultCache(user.id);
      const row = rows?.find((r) => r.id === id);
      if (row) await upsertVaultCache({ ...row, is_favorite: isFavorite });
      recordFavoriteToggle(user.id, id, isFavorite);
    } catch {
      // best-effort
    }
  };

  if (isOffline()) {
    enqueueFavorite(id, isFavorite);
    await patchCacheFavorite();
    return { queued: true };
  }

  try {
    await attempt();
    return { queued: false };
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      enqueueFavorite(id, isFavorite);
      await patchCacheFavorite();
      return { queued: true };
    }
    throw err;
  }
}

/**
 * Update the editable account metadata (issuer + label). Queued to the
 * offline outbox when offline; the cached row is patched immediately.
 */
export async function updateAccountDetails(
  id: string,
  input: { issuer: string; label: string },
): Promise<{ issuer: string; label: string; queued: boolean }> {
  const issuer = input.issuer.trim();
  const label = input.label.trim();
  if (!issuer) throw new Error("Service name can't be empty.");

  const attempt = async () => {
    const { data, error } = await supabase
      .from("vault_accounts")
      .update({ issuer, label })
      .eq("id", id)
      .select(ACCOUNT_SELECT)
      .single();
    if (error) throw error;
    if (data) void upsertVaultCache(data as VaultAccountRecord);
  };

  if (isOffline()) {
    enqueueUpdateDetails(id, issuer, label);
    await patchCachedDetails(id, issuer, label);
    return { issuer, label, queued: true };
  }

  try {
    await attempt();
    dequeueOutbox(id);
    return { issuer, label, queued: false };
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      enqueueUpdateDetails(id, issuer, label);
      await patchCachedDetails(id, issuer, label);
      return { issuer, label, queued: true };
    }
    throw err;
  }
}

async function patchCachedDetails(id: string, issuer: string, label: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const rows = await readVaultCache(user.id);
    const row = rows?.find((r) => r.id === id);
    if (!row) return;
    await upsertVaultCache({ ...row, issuer, label });
  } catch {
    // best-effort
  }
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

/**
 * Flush every queued mutation (create / delete / update / favorite)
 * against the server in enqueue order. Returns the count that reached
 * the server. Safe to call repeatedly; missing-row errors are treated
 * as success (intent satisfied). Failed entries stay queued.
 */
export async function flushPendingOutbox(): Promise<number> {
  if (isOffline()) return 0;
  const flushed = await flushOutbox({
    create: async (clientId, payload) => {
      const { data, error } = await supabase
        .from("vault_accounts")
        .insert({
          id: clientId,
          user_id: payload.userId,
          issuer: payload.issuer,
          label: payload.label,
          icon_slug: payload.icon_slug,
          algorithm: payload.algorithm,
          digits: payload.digits,
          period: payload.period,
          tags: payload.tags,
          is_favorite: payload.is_favorite,
          secret_ciphertext: payload.secret_ciphertext_hex,
          secret_iv: payload.secret_iv_hex,
        })
        .select(ACCOUNT_SELECT)
        .single();
      if (error) throw error;
      if (data) void upsertVaultCache(data as VaultAccountRecord);
    },
    delete: async (id) => {
      const { error } = await supabase.from("vault_accounts").delete().eq("id", id);
      if (error) throw error;
      void removeFromVaultCache(id);
    },
    updateDetails: async (id, issuer, label) => {
      const { data, error } = await supabase
        .from("vault_accounts")
        .update({ issuer, label })
        .eq("id", id)
        .select(ACCOUNT_SELECT)
        .single();
      if (error) throw error;
      if (data) void upsertVaultCache(data as VaultAccountRecord);
    },
    favorite: async (id, isFavorite) => {
      const { data, error } = await supabase
        .from("vault_accounts")
        .update({ is_favorite: isFavorite })
        .eq("id", id)
        .select(ACCOUNT_SELECT + ", user_id")
        .single();
      if (error) throw error;
      if (data) {
        const row = data as unknown as VaultAccountRecord & { user_id: string };
        void upsertVaultCache(row);
        clearFavoriteToggle(row.user_id, id);
      }
    },
  });
  return flushed.length;
}

export function pendingOutboxCount(): number {
  return outboxSize();
}

async function decryptRows(
  dek: CryptoKey,
  rows: VaultAccountRecord[],
): Promise<DecryptedAccount[]> {
  return Promise.all(
    rows.map(async (r) => {
      const secret = await decryptSecret(dek, toBytes(r.secret_ciphertext), toBytes(r.secret_iv));
      const otp_type: OtpType = (r.otp_type ?? "totp") as OtpType;
      let counter: number | undefined;
      if (otp_type === "hotp" && r.counter_ciphertext && r.counter_iv) {
        try {
          const raw = await decryptSecret(
            dek,
            toBytes(r.counter_ciphertext),
            toBytes(r.counter_iv),
          );
          const n = Number.parseInt(raw, 10);
          if (Number.isFinite(n) && n >= 0) counter = n;
        } catch {
          // Corrupt counter — leave undefined so generateCode falls back to 0.
        }
      } else if (otp_type === "hotp") {
        counter = 0;
      }
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
        otp_type,
        counter,
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

// ---------------------------------------------------------------------------
// Phase 6.2: cache-first read + delta sync
// ---------------------------------------------------------------------------

/**
 * Read the offline mirror only — no network hit. Returns `null` when the
 * cache is empty. Used by the vault loader to paint immediately, before
 * kicking off a background sync.
 */
export async function readCachedAccountsOnly(
  dek: CryptoKey,
  userId: string,
): Promise<DecryptedAccount[] | null> {
  const cached = await readVaultCache(userId);
  if (!cached) return null;
  return decryptRows(dek, cached);
}

/**
 * Merge freshly-fetched server rows with the local cache.
 *
 * Rules:
 *   • Server-wins on `updated_at` ties for every field (safe default).
 *   • Client-wins on `is_favorite` when the user toggled it within the
 *     last 60s and that toggle hasn't been round-tripped yet — otherwise
 *     a stale in-flight sync would flicker the star back to the
 *     pre-toggle state.
 *   • Deletions: any cached row absent from the server list is dropped
 *     (server is the source of truth for row existence).
 */
export function mergeAccountRows(
  serverRows: VaultAccountRecord[],
  recentFavToggles: Record<string, boolean>,
): VaultAccountRecord[] {
  return serverRows.map((row) => {
    const override = recentFavToggles[row.id];
    if (override === undefined) return row;
    if (row.is_favorite === override) return row;
    return { ...row, is_favorite: override };
  });
}

/**
 * Fetch every row from the server, merge with any recent optimistic
 * favorite toggles, then rewrite the cache and last-sync marker. Returns
 * the freshly-decrypted account list.
 *
 * Throws on network/RLS error — caller keeps the previous cache-first
 * paint and shows the offline banner.
 */
export async function syncAccountsFromServer(
  dek: CryptoKey,
  userId: string,
): Promise<DecryptedAccount[]> {
  await flushPendingTagUpdates().catch(() => 0);
  const { data, error } = await supabase
    .from("vault_accounts")
    .select(ACCOUNT_SELECT)
    .order("is_favorite", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;

  const serverRows = (data ?? []) as VaultAccountRecord[];
  const recentToggles = readRecentFavoriteToggles(userId);
  const merged = mergeAccountRows(serverRows, recentToggles);

  await writeVaultCache(userId, merged);
  await writeLastSync(userId, new Date().toISOString());
  return decryptRows(dek, merged);
}

/**
 * Timestamp of the last successful server sync, or `null` if this device
 * has never synced. Exposed so the UI can render an "as of 5 mins ago"
 * hint under the offline banner.
 */
export async function getLastSyncedAt(userId: string): Promise<string | null> {
  return readLastSync(userId);
}

/**
 * Phase 7.2 — persist a drag-and-drop reorder.
 *
 * Callers pass the full ordered id list for one visual group (favorites
 * OR everything-else). We reassign `sort_order` densely from 0 and push
 * each row in parallel via targeted UPDATEs — RLS ensures the caller can
 * only touch their own rows. The IndexedDB mirror is patched in the same
 * batch so the new order survives a reload before the next sync.
 *
 * Skips the server hop when offline: local state stays intact for the
 * session and the next server sync will overwrite `sort_order`. The
 * caller (VaultPage) gates DnD activation on `online`, so this is a
 * belt-and-braces guard.
 */
export async function reorderAccounts(orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  const updates = orderedIds.map((id, index) => ({ id, sort_order: index }));
  await patchCacheSortOrders(updates);
  if (isOffline()) return;
  await Promise.all(
    updates.map(({ id, sort_order }) =>
      supabase.from("vault_accounts").update({ sort_order }).eq("id", id),
    ),
  );
}

