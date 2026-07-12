// Emergency access — Family plan.
//
// Grantor (Family plan) invites a trusted contact by email. If the contact
// has published sharing pubkeys via `user_public_keys`, we seal the grantor's
// current DEK for the contact's X25519 pubkey and store the sealed payload.
//
// Later, the grantee can request emergency access. Once the grantor approves
// OR the configured waiting period elapses, the grantee calls
// `fetch_emergency_dek` (SECURITY DEFINER) which returns the sealed DEK.
// The grantee unwraps it locally and gets a READ-ONLY vault session.
//
// The server never sees the plaintext DEK.

import { supabase } from "@/integrations/supabase/client";
import { getVaultKey } from "@/lib/vault-session";
import { toBytes, toByteaHex } from "@/lib/vault-crypto";
import {
  ensureUserKeys,
  sealForRecipient,
  openSharedSecret,
} from "@/lib/vault-sharing-crypto";

export type EmergencyStatus = "active" | "requested" | "approved" | "revoked";

export interface EmergencyContactRow {
  id: string;
  grantorId: string;
  granteeId: string;
  granteeEmail: string;
  status: EmergencyStatus;
  waitDays: number;
  requestedAt: string | null;
  approvedAt: string | null;
  needsReseal: boolean;
  createdAt: string;
}

interface RawRow {
  id: string;
  grantor_id: string;
  grantee_id: string;
  grantee_email: string;
  status: EmergencyStatus;
  wait_days: number;
  requested_at: string | null;
  approved_at: string | null;
  needs_reseal: boolean;
  created_at: string;
}

function mapRow(r: RawRow): EmergencyContactRow {
  return {
    id: r.id,
    grantorId: r.grantor_id,
    granteeId: r.grantee_id,
    granteeEmail: r.grantee_email,
    status: r.status,
    waitDays: r.wait_days,
    requestedAt: r.requested_at,
    approvedAt: r.approved_at,
    needsReseal: r.needs_reseal,
    createdAt: r.created_at,
  };
}

const COLS =
  "id, grantor_id, grantee_id, grantee_email, status, wait_days, requested_at, approved_at, needs_reseal, created_at";

/** Rows where the current user is the grantor (they granted access to others). */
export async function listMyContacts(): Promise<EmergencyContactRow[]> {
  const { data: sess } = await supabase.auth.getUser();
  const uid = sess.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("emergency_contacts")
    .select(COLS)
    .eq("grantor_id", uid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as RawRow[]).map(mapRow);
}

/** Rows where the current user is the grantee (they can recover someone else's vault). */
export async function listMyGrantors(): Promise<EmergencyContactRow[]> {
  const { data: sess } = await supabase.auth.getUser();
  const uid = sess.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("emergency_contacts")
    .select(COLS)
    .eq("grantee_id", uid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as RawRow[]).map(mapRow);
}

/**
 * Invite a trusted contact by email. Requires vault to be unlocked (we need
 * the DEK to seal). The recipient must already have signed up and unlocked
 * at least once (so they have published sharing pubkeys via user_public_keys).
 */
export async function inviteContact(
  granteeEmail: string,
  waitDays: number,
): Promise<EmergencyContactRow> {
  const dek = getVaultKey();
  if (!dek) throw new Error("Vault must be unlocked to invite an emergency contact.");
  const { data: sess } = await supabase.auth.getUser();
  const grantorId = sess.user?.id;
  if (!grantorId) throw new Error("Not signed in.");

  const email = granteeEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Enter a valid email address.");

  // Look up recipient's pubkeys via existing RPC (rate-limited server-side).
  const { data: lookup, error: lookupErr } = await supabase.rpc("find_user_by_email", {
    _email: email,
  });
  if (lookupErr) throw lookupErr;
  const found = (lookup as Array<{
    user_id: string;
    x25519_public_key: string;
    ed25519_public_key: string;
  }> | null) ?? [];
  if (found.length === 0) {
    throw new Error(
      "No Aegis user found for that email. Ask them to sign up and unlock the app once first.",
    );
  }
  const target = found[0];
  const granteeId = target.user_id;
  if (granteeId === grantorId) throw new Error("You can't add yourself.");

  // Export the DEK as raw bytes → base64, then seal for grantee.
  const rawDek = new Uint8Array(await crypto.subtle.exportKey("raw", dek));
  const dekB64 = bytesToBase64(rawDek);
  const sealed = await sealForRecipient(
    dekB64,
    toBytes(target.x25519_public_key),
    grantorId,
    granteeId,
    /* accountId — reused as domain-separator; use a fixed emergency tag */
    emergencyDomainTag(grantorId, granteeId),
  );

  const { data, error } = await supabase
    .from("emergency_contacts")
    .insert({
      grantor_id: grantorId,
      grantee_id: granteeId,
      grantee_email: email,
      status: "active",
      wait_days: waitDays,
      sealed_dek: toByteaHex(sealed.ciphertext),
      sealed_dek_iv: toByteaHex(sealed.iv),
      sealed_dek_ephemeral_pub: toByteaHex(sealed.ephemeralPublicKey),
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return mapRow(data as RawRow);
}

/** Update the waiting period. Grantor only. */
export async function updateWaitDays(id: string, waitDays: number): Promise<void> {
  const { error } = await supabase
    .from("emergency_contacts")
    .update({ wait_days: waitDays })
    .eq("id", id);
  if (error) throw error;
}

/** Revoke by deleting the row. Grantor only. */
export async function revokeContact(id: string): Promise<void> {
  const { error } = await supabase.from("emergency_contacts").delete().eq("id", id);
  if (error) throw error;
}

/** Grantee: request emergency access. Starts the waiting timer. */
export async function requestAccess(id: string): Promise<void> {
  const { error } = await supabase.rpc("request_emergency_access", { _contact_id: id });
  if (error) throw error;
}

/** Grantor approves an outstanding request early. */
export async function approveRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc("approve_emergency_request", { _contact_id: id });
  if (error) throw error;
}

/** Grantor rejects a request (reverts to active). */
export async function rejectRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc("reject_emergency_request", { _contact_id: id });
  if (error) throw error;
}

/**
 * Grantee: attempt to unlock the grantor's vault. Returns the decrypted DEK
 * as a CryptoKey suitable for READ-ONLY vault use. Throws if not yet allowed
 * (e.g. wait period hasn't elapsed).
 */
export async function unlockGrantorVault(id: string): Promise<CryptoKey> {
  const myDek = getVaultKey();
  if (!myDek) throw new Error("Unlock your own vault first so we can access your recovery keys.");
  const { data: sess } = await supabase.auth.getUser();
  const myId = sess.user?.id;
  if (!myId) throw new Error("Not signed in.");

  const { data, error } = await supabase.rpc("fetch_emergency_dek", { _contact_id: id });
  if (error) throw error;
  const rows = data as Array<{
    sealed_dek: string;
    sealed_dek_iv: string;
    sealed_dek_ephemeral_pub: string;
    grantor_id: string;
  }> | null;
  if (!rows || rows.length === 0) throw new Error("Sealed key not available yet.");
  const payload = rows[0];

  const myKeys = await ensureUserKeys(myId, myDek);
  const dekB64 = await openSharedSecret(
    {
      ephemeralPublicKey: toBytes(payload.sealed_dek_ephemeral_pub),
      ciphertext: toBytes(payload.sealed_dek),
      iv: toBytes(payload.sealed_dek_iv),
    },
    myKeys.x25519Private,
    myKeys.x25519Public,
    payload.grantor_id,
    myId,
    emergencyDomainTag(payload.grantor_id, myId),
  );

  const rawDek = base64ToBytes(dekB64);
  return crypto.subtle.importKey(
    "raw",
    rawDek as unknown as BufferSource,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Determine grantee-side unlock availability at time `now`. */
export function unlockAvailable(row: EmergencyContactRow, now = Date.now()): boolean {
  if (row.status === "approved") return true;
  if (row.status === "requested" && row.requestedAt) {
    const readyAt = new Date(row.requestedAt).getTime() + row.waitDays * 86_400_000;
    return now >= readyAt;
  }
  return false;
}

/** Milliseconds remaining until the grantee can unlock, or 0 if ready/N/A. */
export function msUntilUnlock(row: EmergencyContactRow, now = Date.now()): number {
  if (row.status !== "requested" || !row.requestedAt) return 0;
  const readyAt = new Date(row.requestedAt).getTime() + row.waitDays * 86_400_000;
  return Math.max(0, readyAt - now);
}

// -------- helpers --------

function emergencyDomainTag(grantorId: string, granteeId: string): string {
  // Domain-separate emergency seals from ordinary vault-share seals. The
  // "accountId" slot in sealForRecipient's AAD is repurposed here.
  return `emergency:${grantorId}:${granteeId}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
