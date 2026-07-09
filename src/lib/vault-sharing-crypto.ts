// Phase 13.1 — vault sharing crypto.
//
// Two dimensions of asymmetric keys per user:
//   • X25519 (wrap): ephemeral-static ECDH → HKDF-SHA256 → AES-GCM(secret)
//     Used to seal a per-account TOTP secret so only the recipient can open it.
//   • Ed25519 (sign): reserved for future audit-log signing, shared album
//     integrity, etc. Generated now so we don't need a second migration to
//     backfill signing keys later.
//
// Private keys are AES-GCM'd with the user's vault DEK before storage —
// server never sees plaintext private material. On unlock the client calls
// `ensureUserKeys(dek, userId)` which either loads and unwraps the existing
// row or mints a fresh keypair and persists it.
//
// Seal format on the wire (per `vault_shares` row):
//   ephemeral_public_key : 32 bytes    (sender's freshly-generated X25519 pub)
//   sealed_iv            : 12 bytes    (AES-GCM nonce)
//   sealed_ciphertext    : plaintext + 16-byte tag
//   AAD                  : utf8("share|{owner_user_id}|{recipient_user_id}|{account_id}")
//
// Recipient does the same ECDH → HKDF derivation with their private key and
// the ephemeral pub from the row, verifies AAD, and recovers the TOTP secret.

import { x25519, ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { supabase } from "@/integrations/supabase/client";
import {
  decryptSecret,
  encryptSecret,
  randomBytes,
  toBytes,
  toByteaHex,
} from "@/lib/vault-crypto";

const enc = new TextEncoder();
const dec = new TextDecoder();

const HKDF_INFO = enc.encode("aegis-vault-share-v1");

// AAD used both for wrapping the private keys and for sealed shares. Bound
// to the user id so a private-key blob or share row copied into a different
// user's records fails to decrypt.
function privateKeyAad(userId: string, kind: "x25519" | "ed25519"): Uint8Array {
  return enc.encode(`user-key|${kind}|${userId}`);
}

function shareAad(
  ownerId: string,
  recipientId: string,
  accountId: string,
): Uint8Array {
  return enc.encode(`share|${ownerId}|${recipientId}|${accountId}`);
}

/* ---------------- keypair generation + on-disk wrap ---------------- */

export interface UserKeyMaterial {
  x25519Public: Uint8Array;
  x25519Private: Uint8Array;
  ed25519Public: Uint8Array;
  ed25519Private: Uint8Array;
}

function generateUserKeys(): UserKeyMaterial {
  const xPriv = x25519.utils.randomSecretKey();
  const xPub = x25519.getPublicKey(xPriv);
  const edPriv = ed25519.utils.randomSecretKey();
  const edPub = ed25519.getPublicKey(edPriv);
  return {
    x25519Public: xPub,
    x25519Private: xPriv,
    ed25519Public: edPub,
    ed25519Private: edPriv,
  };
}

/**
 * Insert/refresh the current user's public+wrapped-private key row. Called
 * from `ensureUserKeys` when none exists.
 */
async function persistNewUserKeys(
  userId: string,
  dek: CryptoKey,
  keys: UserKeyMaterial,
): Promise<void> {
  const wrappedX = await encryptSecret(
    dek,
    bytesToBase64(keys.x25519Private),
    privateKeyAad(userId, "x25519"),
  );
  const wrappedE = await encryptSecret(
    dek,
    bytesToBase64(keys.ed25519Private),
    privateKeyAad(userId, "ed25519"),
  );
  const { error } = await supabase.from("user_public_keys").insert({
    user_id: userId,
    x25519_public_key: toByteaHex(keys.x25519Public),
    ed25519_public_key: toByteaHex(keys.ed25519Public),
    x25519_private_wrapped: toByteaHex(wrappedX.ciphertext),
    x25519_private_wrapped_iv: toByteaHex(wrappedX.iv),
    ed25519_private_wrapped: toByteaHex(wrappedE.ciphertext),
    ed25519_private_wrapped_iv: toByteaHex(wrappedE.iv),
  });
  if (error) throw error;
}

/**
 * Load-or-create the user's sharing keys. On first call after this feature
 * ships, mints a fresh pair and stores it wrapped under the DEK. Safe to
 * call every unlock — cached row is unwrapped locally.
 *
 * Returns the full material (private halves) so the caller can immediately
 * open incoming shares in the same session.
 */
export async function ensureUserKeys(
  userId: string,
  dek: CryptoKey,
): Promise<UserKeyMaterial> {
  const { data, error } = await supabase
    .from("user_public_keys")
    .select(
      "x25519_public_key, ed25519_public_key, x25519_private_wrapped, x25519_private_wrapped_iv, ed25519_private_wrapped, ed25519_private_wrapped_iv",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const keys = generateUserKeys();
    await persistNewUserKeys(userId, dek, keys);
    return keys;
  }
  const xPrivB64 = await decryptSecret(
    dek,
    toBytes(data.x25519_private_wrapped),
    toBytes(data.x25519_private_wrapped_iv),
    privateKeyAad(userId, "x25519"),
  );
  const edPrivB64 = await decryptSecret(
    dek,
    toBytes(data.ed25519_private_wrapped),
    toBytes(data.ed25519_private_wrapped_iv),
    privateKeyAad(userId, "ed25519"),
  );
  return {
    x25519Public: toBytes(data.x25519_public_key),
    x25519Private: base64ToBytes(xPrivB64),
    ed25519Public: toBytes(data.ed25519_public_key),
    ed25519Private: base64ToBytes(edPrivB64),
  };
}

/* ---------------- sealed-box style seal / open ---------------- */

async function deriveShareKey(
  sharedSecret: Uint8Array,
  ephemeralPub: Uint8Array,
  recipientPub: Uint8Array,
): Promise<CryptoKey> {
  // Salt binds the derived key to both parties' pubs — even if two shares
  // happen to reuse the same ephemeral (they won't, but defense in depth),
  // recipient substitution changes the salt.
  const salt = new Uint8Array(ephemeralPub.length + recipientPub.length);
  salt.set(ephemeralPub, 0);
  salt.set(recipientPub, ephemeralPub.length);
  const raw = hkdf(sha256, sharedSecret, salt, HKDF_INFO, 32);
  return crypto.subtle.importKey(
    "raw",
    raw as unknown as BufferSource,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface SealedShare {
  ephemeralPublicKey: Uint8Array;
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

export async function sealForRecipient(
  plaintext: string,
  recipientX25519Pub: Uint8Array,
  ownerId: string,
  recipientId: string,
  accountId: string,
): Promise<SealedShare> {
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephPriv);
  const shared = x25519.getSharedSecret(ephPriv, recipientX25519Pub);
  const key = await deriveShareKey(shared, ephPub, recipientX25519Pub);
  const iv = randomBytes(12);
  const aad = shareAad(ownerId, recipientId, accountId);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource, additionalData: aad as unknown as BufferSource },
    key,
    enc.encode(plaintext),
  );
  return { ephemeralPublicKey: ephPub, iv, ciphertext: new Uint8Array(ct) };
}

export async function openSharedSecret(
  sealed: SealedShare,
  recipientX25519Priv: Uint8Array,
  recipientX25519Pub: Uint8Array,
  ownerId: string,
  recipientId: string,
  accountId: string,
): Promise<string> {
  const shared = x25519.getSharedSecret(
    recipientX25519Priv,
    sealed.ephemeralPublicKey,
  );
  const key = await deriveShareKey(
    shared,
    sealed.ephemeralPublicKey,
    recipientX25519Pub,
  );
  const aad = shareAad(ownerId, recipientId, accountId);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.iv as unknown as BufferSource, additionalData: aad as unknown as BufferSource },
    key,
    sealed.ciphertext as unknown as BufferSource,
  );
  return dec.decode(pt);
}

/* ---------------- helpers: bytes ⇄ base64 ---------------- */

// We stuff raw key bytes through `encryptSecret` (which takes a string), so
// convert with base64. Not a security boundary — the ciphertext itself is
// the primary secret.

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
