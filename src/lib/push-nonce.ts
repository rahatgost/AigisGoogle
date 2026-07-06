// Signed, short-lived push nonces (Phase 10.3).
//
// A "nonce" is a one-shot approval token: it identifies a pending
// sensitive action ("approve login from Chrome on macOS", "authorise
// export"), pins it to a user, and expires in minutes. We store the
// nonce row in `public.push_nonces` (see migration 20260706214152)
// with an HMAC-SHA256 signature covering every immutable field, so a
// service-role compromise that mints raw INSERTs still can't create a
// nonce that verifies without the secret.
//
// The signature covers a canonical, order-stable string. Never sign a
// JSON.stringify of the whole row: JSON key ordering isn't guaranteed
// across drivers and even a whitespace change would flip the hash.

/** Canonical, order-stable material fed into the HMAC. Adding a field
 *  here is a schema change — signatures minted before will stop
 *  verifying, which is the correct behaviour. */
export interface NonceMaterial {
  id: string;
  userId: string;
  action: string;
  /** Milliseconds since epoch (rounded to integer). */
  expiresAt: number;
  /** Arbitrary opaque payload; canonicalised via `canonicalJson`. */
  payload: unknown;
}

/** JSON with deterministic key ordering — sorts object keys everywhere. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return (
    "{" +
    entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") +
    "}"
  );
}

/** Serialise a nonce for signing. Version prefix lets us swap the
 *  scheme in future without a table migration. */
export function serializeForSign(m: NonceMaterial): string {
  return [
    "v1",
    m.id,
    m.userId,
    m.action,
    String(Math.floor(m.expiresAt)),
    canonicalJson(m.payload ?? {}),
  ].join("\n");
}

function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Produce the HMAC-SHA256 signature (base64url, unpadded) over the
 *  canonical serialisation of `material`. */
export async function signNonce(
  material: NonceMaterial,
  secret: string,
): Promise<string> {
  if (!secret) throw new Error("push nonce secret missing");
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(serializeForSign(material)),
  );
  return b64urlEncode(sig);
}

/** Constant-time compare over base64url strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface VerifyOptions {
  /** Override the clock for tests. Defaults to `Date.now()`. */
  now?: number;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "bad_signature" | "expired" | "missing_secret" };

/** Verify a signature against nonce material. Returns a structured
 *  reason so callers can distinguish "attacker tampered" from
 *  "user was slow to approve". */
export async function verifyNonce(
  material: NonceMaterial,
  signature: string,
  secret: string,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  if (!secret) return { ok: false, reason: "missing_secret" };
  const expected = await signNonce(material, secret);
  if (!safeEqual(expected, signature)) return { ok: false, reason: "bad_signature" };
  const now = opts.now ?? Date.now();
  if (material.expiresAt <= now) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** Default nonce lifetime for approval flows. Keep this short — the
 *  user has to click "approve" almost immediately anyway, and a longer
 *  window enlarges the tampering opportunity. */
export const DEFAULT_NONCE_TTL_MS = 2 * 60 * 1000;
