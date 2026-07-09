// Phase 13.2 — Family plan client library.
//
// A user can either be the admin of one family, a member of one family,
// or in no family at all. Sharing an account "with the family" is a
// convenience wrapper around the existing 1:1 vault-sharing crypto:
// the admin encrypts the TOTP secret once per current member (same
// ephemeral-static X25519 → HKDF → AES-GCM path as `shareAccountByEmail`)
// and drops the resulting rows into `vault_shares`, plus a metadata
// row in `family_shared_accounts` so the group membership is visible
// even when a member joins later and needs a re-sync.

import { supabase } from "@/integrations/supabase/client";
import { getVaultKey } from "@/lib/vault-session";
import {
  buildAccountAad,
  decryptSecret,
  toBytes,
  toByteaHex,
} from "@/lib/vault-crypto";
import { sealForRecipient } from "@/lib/vault-sharing-crypto";

export interface Family {
  id: string;
  name: string;
  adminUserId: string;
  createdAt: string;
}

export interface FamilyMember {
  id: string;
  userId: string;
  role: "admin" | "member";
  joinedAt: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface FamilyInvite {
  id: string;
  familyId: string;
  email: string;
  status: "pending" | "accepted" | "declined" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
  invitedBy: string;
}

export interface FamilyMemberKey {
  userId: string;
  x25519PublicKey: Uint8Array;
  ed25519PublicKey: Uint8Array;
  email: string | null;
}

export interface FamilySharedAccount {
  id: string;
  familyId: string;
  accountId: string;
  sharedBy: string;
  createdAt: string;
  // Snapshot enrichment (from vault_accounts / vault_shares when visible):
  issuer: string;
  label: string;
  // Sync status vs current member roster (admin-only view):
  missingRecipients: string[];
}

/* -------------------------- lookups -------------------------- */

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export interface FamilyOverview {
  family: Family | null;
  role: "admin" | "member" | null;
  members: FamilyMember[];
  invites: FamilyInvite[]; // admin: all invites; member: []
  sharedAccounts: FamilySharedAccount[];
}

export async function loadFamilyOverview(): Promise<FamilyOverview> {
  const uid = await currentUserId();
  if (!uid) return { family: null, role: null, members: [], invites: [], sharedAccounts: [] };

  const { data: memberRow } = await supabase
    .from("family_members")
    .select("family_id, role")
    .eq("user_id", uid)
    .maybeSingle();

  if (!memberRow) {
    return { family: null, role: null, members: [], invites: [], sharedAccounts: [] };
  }

  const familyId = memberRow.family_id;
  const role = memberRow.role as "admin" | "member";

  const [{ data: famRow }, { data: memberRows }, { data: inviteRows }, { data: sharedRows }] =
    await Promise.all([
      supabase.from("families").select("id, name, admin_user_id, created_at").eq("id", familyId).maybeSingle(),
      supabase
        .from("family_members")
        .select("id, user_id, role, joined_at")
        .eq("family_id", familyId)
        .order("joined_at", { ascending: true }),
      role === "admin"
        ? supabase
            .from("family_invites")
            .select("id, family_id, email, status, expires_at, created_at, invited_by")
            .eq("family_id", familyId)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from("family_shared_accounts")
        .select("id, family_id, account_id, shared_by, created_at")
        .eq("family_id", familyId),
    ]);

  // Enrich member rows with display_name/avatar_url from profiles.
  const memberIds = (memberRows ?? []).map((r) => r.user_id);
  let profileMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();
  if (memberIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", memberIds);
    for (const p of profs ?? []) {
      profileMap.set(p.id, { display_name: p.display_name ?? null, avatar_url: p.avatar_url ?? null });
    }
  }

  const members: FamilyMember[] = (memberRows ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    role: r.role as "admin" | "member",
    joinedAt: r.joined_at,
    displayName: profileMap.get(r.user_id)?.display_name ?? null,
    avatarUrl: profileMap.get(r.user_id)?.avatar_url ?? null,
  }));

  // Enrich shared accounts and compute missing-recipient sets (admin only).
  const accountIds = (sharedRows ?? []).map((r) => r.account_id);
  let acctMap = new Map<string, { issuer: string; label: string }>();
  let shareMap = new Map<string, Set<string>>(); // accountId → set of recipient_user_id
  if (accountIds.length) {
    const [{ data: acctRows }, { data: existingShares }] = await Promise.all([
      supabase.from("vault_accounts").select("id, issuer, label").in("id", accountIds),
      supabase
        .from("vault_shares")
        .select("account_id, recipient_user_id")
        .in("account_id", accountIds)
        .is("revoked_at", null),
    ]);
    for (const a of acctRows ?? []) acctMap.set(a.id, { issuer: a.issuer, label: a.label });
    for (const s of existingShares ?? []) {
      if (!shareMap.has(s.account_id)) shareMap.set(s.account_id, new Set());
      shareMap.get(s.account_id)!.add(s.recipient_user_id);
    }
  }

  const family: Family | null = famRow
    ? {
        id: famRow.id,
        name: famRow.name,
        adminUserId: famRow.admin_user_id,
        createdAt: famRow.created_at,
      }
    : null;

  const adminId = family?.adminUserId;
  const nonAdminMemberIds = members.filter((m) => m.userId !== adminId).map((m) => m.userId);

  const sharedAccounts: FamilySharedAccount[] = (sharedRows ?? []).map((r) => {
    const meta = acctMap.get(r.account_id);
    const recipients = shareMap.get(r.account_id) ?? new Set<string>();
    const missing = nonAdminMemberIds.filter((mid) => !recipients.has(mid));
    return {
      id: r.id,
      familyId: r.family_id,
      accountId: r.account_id,
      sharedBy: r.shared_by,
      createdAt: r.created_at,
      issuer: meta?.issuer ?? "Shared account",
      label: meta?.label ?? "",
      missingRecipients: missing,
    };
  });

  const invites: FamilyInvite[] = (inviteRows ?? []).map((r) => ({
    id: r.id,
    familyId: r.family_id,
    email: r.email,
    status: r.status as FamilyInvite["status"],
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    invitedBy: r.invited_by,
  }));

  return { family, role, members, invites, sharedAccounts };
}

/* -------------------------- invites for me -------------------------- */

export async function listInvitesForMe(): Promise<
  Array<FamilyInvite & { familyName: string }>
> {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data: userRes } = await supabase.auth.getUser();
  const email = userRes.user?.email?.toLowerCase();
  if (!email) return [];

  const { data, error } = await supabase
    .from("family_invites")
    .select("id, family_id, email, status, expires_at, created_at, invited_by, families(name)")
    .eq("status", "pending")
    .ilike("email", email);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    familyId: r.family_id,
    email: r.email,
    status: r.status,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    invitedBy: r.invited_by,
    familyName: r.families?.name ?? "a family",
  }));
}

/* -------------------------- family lifecycle -------------------------- */

export async function createFamily(name: string): Promise<Family> {
  const uid = await currentUserId();
  if (!uid) throw new Error("Not signed in.");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give your family a name.");
  if (trimmed.length > 80) throw new Error("Name is too long (max 80 chars).");

  // Refuse if already in a family.
  const { data: existing } = await supabase
    .from("family_members")
    .select("family_id")
    .eq("user_id", uid)
    .maybeSingle();
  if (existing) throw new Error("You're already in a family.");

  const { data: fam, error: famErr } = await supabase
    .from("families")
    .insert({ name: trimmed, admin_user_id: uid })
    .select("id, name, admin_user_id, created_at")
    .single();
  if (famErr) throw famErr;

  const { error: memErr } = await supabase
    .from("family_members")
    .insert({ family_id: fam.id, user_id: uid, role: "admin" });
  if (memErr) {
    // Best-effort roll-back: delete the family we just created.
    await supabase.from("families").delete().eq("id", fam.id);
    throw memErr;
  }

  return {
    id: fam.id,
    name: fam.name,
    adminUserId: fam.admin_user_id,
    createdAt: fam.created_at,
  };
}

export async function deleteFamily(familyId: string): Promise<void> {
  const { error } = await supabase.from("families").delete().eq("id", familyId);
  if (error) throw error;
}

export async function leaveFamily(): Promise<void> {
  const uid = await currentUserId();
  if (!uid) throw new Error("Not signed in.");
  const { error } = await supabase.from("family_members").delete().eq("user_id", uid);
  if (error) throw error;
}

/* -------------------------- invites -------------------------- */

export async function inviteMember(familyId: string, email: string): Promise<FamilyInvite> {
  const uid = await currentUserId();
  if (!uid) throw new Error("Not signed in.");
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error("Enter a valid email address.");
  }

  // Refuse if the email already belongs to a current member of this family.
  const { data: existingMembers } = await supabase
    .from("family_members")
    .select("user_id")
    .eq("family_id", familyId);
  const existingIds = new Set((existingMembers ?? []).map((m) => m.user_id));

  // If invitee is already signed up, check via find_user_by_email (best effort).
  try {
    const { data: found } = await supabase.rpc("find_user_by_email", { _email: trimmed });
    const row = Array.isArray(found) ? found[0] : null;
    if (row && existingIds.has(row.user_id)) {
      throw new Error("That person is already in your family.");
    }
  } catch (err) {
    // Non-fatal — the unique index below will still prevent duplicates.
    if (err instanceof Error && err.message.includes("already in your family")) throw err;
  }

  const { data, error } = await supabase
    .from("family_invites")
    .insert({ family_id: familyId, invited_by: uid, email: trimmed })
    .select("id, family_id, email, status, expires_at, created_at, invited_by")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new Error("You've already invited that email.");
    }
    throw error;
  }
  return {
    id: data.id,
    familyId: data.family_id,
    email: data.email,
    status: data.status as FamilyInvite["status"],
    expiresAt: data.expires_at,
    createdAt: data.created_at,
    invitedBy: data.invited_by,
  };
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await supabase
    .from("family_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId);
  if (error) throw error;
}

export async function acceptInvite(inviteId: string): Promise<void> {
  const uid = await currentUserId();
  if (!uid) throw new Error("Not signed in.");

  // Refuse if already in a family.
  const { data: existing } = await supabase
    .from("family_members")
    .select("family_id")
    .eq("user_id", uid)
    .maybeSingle();
  if (existing) throw new Error("Leave your current family before accepting a new invite.");

  const { data: invite, error: readErr } = await supabase
    .from("family_invites")
    .select("id, family_id, status, expires_at")
    .eq("id", inviteId)
    .single();
  if (readErr) throw readErr;
  if (invite.status !== "pending") throw new Error("This invite is no longer active.");
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    await supabase.from("family_invites").update({ status: "expired" }).eq("id", inviteId);
    throw new Error("This invite has expired.");
  }

  const { error: joinErr } = await supabase
    .from("family_members")
    .insert({ family_id: invite.family_id, user_id: uid, role: "member" });
  if (joinErr) throw joinErr;

  const { error: updErr } = await supabase
    .from("family_invites")
    .update({ status: "accepted" })
    .eq("id", inviteId);
  if (updErr) console.warn("[family] failed to mark invite accepted", updErr);
}

export async function declineInvite(inviteId: string): Promise<void> {
  const { error } = await supabase
    .from("family_invites")
    .update({ status: "declined" })
    .eq("id", inviteId);
  if (error) throw error;
}

/* -------------------------- membership admin -------------------------- */

export async function removeMember(memberRowId: string): Promise<void> {
  // Also revoke any vault_shares from admin to that member for family-shared accounts.
  const { data: row, error: readErr } = await supabase
    .from("family_members")
    .select("family_id, user_id")
    .eq("id", memberRowId)
    .single();
  if (readErr) throw readErr;

  const { data: shared } = await supabase
    .from("family_shared_accounts")
    .select("account_id")
    .eq("family_id", row.family_id);
  const accountIds = (shared ?? []).map((s) => s.account_id);
  if (accountIds.length) {
    await supabase
      .from("vault_shares")
      .update({ revoked_at: new Date().toISOString() })
      .in("account_id", accountIds)
      .eq("recipient_user_id", row.user_id)
      .is("revoked_at", null);
  }

  const { error } = await supabase.from("family_members").delete().eq("id", memberRowId);
  if (error) throw error;
}

/* -------------------------- shared accounts -------------------------- */

interface AccountRow {
  id: string;
  user_id: string;
  issuer: string;
  label: string;
  algorithm: string;
  digits: number;
  period: number;
  otp_type: string;
  secret_ciphertext: unknown;
  secret_iv: unknown;
  crypto_version: number | null;
}

async function getMemberKeys(): Promise<FamilyMemberKey[]> {
  const { data, error } = await supabase.rpc("get_family_member_public_keys");
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    userId: r.user_id,
    x25519PublicKey: toBytes(r.x25519_public_key),
    ed25519PublicKey: toBytes(r.ed25519_public_key),
    email: r.email ?? null,
  }));
}

async function sealAndInsertShare(
  acct: AccountRow,
  ownerId: string,
  recipient: FamilyMemberKey,
  plaintextSecret: string,
): Promise<void> {
  const sealed = await sealForRecipient(
    plaintextSecret,
    recipient.x25519PublicKey,
    ownerId,
    recipient.userId,
    acct.id,
  );
  const { error } = await supabase.from("vault_shares").insert({
    account_id: acct.id,
    owner_user_id: ownerId,
    recipient_user_id: recipient.userId,
    ephemeral_public_key: toByteaHex(sealed.ephemeralPublicKey),
    sealed_ciphertext: toByteaHex(sealed.ciphertext),
    sealed_iv: toByteaHex(sealed.iv),
    issuer_snapshot: acct.issuer,
    label_snapshot: acct.label,
    algorithm_snapshot: acct.algorithm,
    digits_snapshot: acct.digits,
    period_snapshot: acct.period,
    otp_type_snapshot: acct.otp_type,
  });
  if (error && error.code !== "23505") throw error;
}

async function loadAccount(accountId: string, ownerId: string): Promise<{ acct: AccountRow; secret: string }> {
  const dek = getVaultKey();
  if (!dek) throw new Error("Unlock your vault first.");
  const { data, error } = await supabase
    .from("vault_accounts")
    .select(
      "id, user_id, issuer, label, algorithm, digits, period, otp_type, secret_ciphertext, secret_iv, crypto_version",
    )
    .eq("id", accountId)
    .single();
  if (error) throw error;
  const acct = data as AccountRow;
  if (acct.user_id !== ownerId) throw new Error("You don't own this account.");
  const aad =
    (acct.crypto_version ?? 2) >= 3 ? buildAccountAad(ownerId, acct.id) : undefined;
  const secret = await decryptSecret(dek, toBytes(acct.secret_ciphertext), toBytes(acct.secret_iv), aad);
  return { acct, secret };
}

/**
 * Admin action: share one of my accounts with every current family member.
 * Creates a `family_shared_accounts` metadata row plus a `vault_shares` row
 * per non-admin member (skips members who already have an active share).
 */
export async function shareAccountWithFamily(
  familyId: string,
  accountId: string,
): Promise<{ createdShareCount: number }> {
  const ownerId = await currentUserId();
  if (!ownerId) throw new Error("Not signed in.");

  const { acct, secret } = await loadAccount(accountId, ownerId);

  const memberKeys = await getMemberKeys();
  const recipients = memberKeys.filter((k) => k.userId !== ownerId);

  // Existing shares for this account.
  const { data: existing } = await supabase
    .from("vault_shares")
    .select("recipient_user_id")
    .eq("account_id", accountId)
    .eq("owner_user_id", ownerId)
    .is("revoked_at", null);
  const already = new Set((existing ?? []).map((s) => s.recipient_user_id));

  let created = 0;
  for (const r of recipients) {
    if (already.has(r.userId)) continue;
    await sealAndInsertShare(acct, ownerId, r, secret);
    created++;
  }

  // Insert (or ignore) the family_shared_accounts marker.
  const { error: metaErr } = await supabase
    .from("family_shared_accounts")
    .insert({ family_id: familyId, account_id: accountId, shared_by: ownerId });
  if (metaErr && metaErr.code !== "23505") throw metaErr;

  return { createdShareCount: created };
}

/** Sync missing shares: for every family-shared account, seal it to any
 *  member who is currently missing an active share. */
export async function syncFamilyShares(familyId: string): Promise<{ created: number }> {
  const ownerId = await currentUserId();
  if (!ownerId) throw new Error("Not signed in.");

  const overview = await loadFamilyOverview();
  const missingByAccount = overview.sharedAccounts.filter(
    (a) => a.sharedBy === ownerId && a.missingRecipients.length > 0,
  );
  if (missingByAccount.length === 0) return { created: 0 };

  const memberKeys = await getMemberKeys();
  const keyByUser = new Map(memberKeys.map((k) => [k.userId, k]));

  let created = 0;
  for (const shared of missingByAccount) {
    let acctBundle: { acct: AccountRow; secret: string } | null = null;
    for (const missingUid of shared.missingRecipients) {
      const key = keyByUser.get(missingUid);
      if (!key) continue; // member hasn't published sharing keys yet
      if (!acctBundle) acctBundle = await loadAccount(shared.accountId, ownerId).catch(() => null as any);
      if (!acctBundle) break;
      await sealAndInsertShare(acctBundle.acct, ownerId, key, acctBundle.secret);
      created++;
    }
  }
  // Silence-void — familyId retained for signature parity / future scoping.
  void familyId;
  return { created };
}

export async function unshareAccountFromFamily(sharedRowId: string): Promise<void> {
  const ownerId = await currentUserId();
  if (!ownerId) throw new Error("Not signed in.");

  const { data: row, error: readErr } = await supabase
    .from("family_shared_accounts")
    .select("id, account_id, shared_by")
    .eq("id", sharedRowId)
    .single();
  if (readErr) throw readErr;
  if (row.shared_by !== ownerId) throw new Error("Only the sharer can unshare.");

  // Revoke every active vault_share for this account owned by the caller.
  await supabase
    .from("vault_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("account_id", row.account_id)
    .eq("owner_user_id", ownerId)
    .is("revoked_at", null);

  // Mark the underlying account for rotation (secret is now considered leaked
  // to former family members).
  await supabase
    .from("vault_accounts")
    .update({ needs_rotation: true })
    .eq("id", row.account_id);

  const { error } = await supabase.from("family_shared_accounts").delete().eq("id", sharedRowId);
  if (error) throw error;
}

/* -------------------------- helpers for pickers -------------------------- */

export interface OwnedAccountSummary {
  id: string;
  issuer: string;
  label: string;
  alreadyShared: boolean;
}

export async function listOwnedAccountsForFamily(familyId: string): Promise<OwnedAccountSummary[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  const [{ data: accts }, { data: shared }] = await Promise.all([
    supabase
      .from("vault_accounts")
      .select("id, issuer, label")
      .eq("user_id", uid)
      .order("issuer", { ascending: true }),
    supabase.from("family_shared_accounts").select("account_id").eq("family_id", familyId),
  ]);
  const sharedSet = new Set((shared ?? []).map((s) => s.account_id));
  return (accts ?? []).map((a) => ({
    id: a.id,
    issuer: a.issuer,
    label: a.label,
    alreadyShared: sharedSet.has(a.id),
  }));
}
