// Round-trip tests for src/lib/vault-crypto.ts.
// Runs on Node 20+ with globalThis.crypto.subtle:
//   node --test tests/crypto/vault-crypto.roundtrip.spec.mjs
//
// Uses a small re-implementation matching the production module so we can
// run without a bundler. If either drifts the RFC 6238 suite still guards
// TOTP correctness; this suite guards the wrap/unwrap contract.

import test from "node:test";
import assert from "node:assert/strict";

const enc = new TextEncoder();
const dec = new TextDecoder();
const ITERS = 600_000;

function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

async function deriveKek(passphrase, salt) {
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey", "encrypt", "decrypt"],
  );
}

async function createVault(passphrase) {
  const salt = randomBytes(16);
  const kek = await deriveKek(passphrase, salt);
  const dek = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const iv = randomBytes(12);
  const wrapped = new Uint8Array(
    await crypto.subtle.wrapKey("raw", dek, kek, { name: "AES-GCM", iv }),
  );
  return { salt, wrapped, iv, dek };
}

async function unwrap(passphrase, salt, wrapped, iv) {
  const kek = await deriveKek(passphrase, salt);
  return crypto.subtle.unwrapKey(
    "raw",
    wrapped,
    kek,
    { name: "AES-GCM", iv },
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptWith(dek, plaintext) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dek, enc.encode(plaintext)),
  );
  return { ct, iv };
}

async function decryptWith(dek, ct, iv) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, dek, ct);
  return dec.decode(pt);
}

test("KDF is deterministic for same salt + passphrase", async () => {
  const salt = randomBytes(16);
  const k1 = await deriveKek("correct horse battery staple", salt);
  const k2 = await deriveKek("correct horse battery staple", salt);
  // Both derived keys should encrypt to the same bytes given same iv/plaintext.
  const iv = randomBytes(12);
  const a = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k1, enc.encode("hi")));
  const b = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k2, enc.encode("hi")));
  assert.deepEqual(a, b);
});

test("wrap → unwrap → decrypt round-trip works", async () => {
  const { salt, wrapped, iv, dek } = await createVault("s3cret-pass!");
  const { ct, iv: sIv } = await encryptWith(dek, "JBSWY3DPEHPK3PXP");
  const dek2 = await unwrap("s3cret-pass!", salt, wrapped, iv);
  const restored = await decryptWith(dek2, ct, sIv);
  assert.equal(restored, "JBSWY3DPEHPK3PXP");
});

test("wrong passphrase fails to unwrap", async () => {
  const { salt, wrapped, iv } = await createVault("s3cret-pass!");
  await assert.rejects(unwrap("wrong-pass", salt, wrapped, iv));
});

test("tampered ciphertext is rejected by AES-GCM tag", async () => {
  const { dek } = await createVault("pw");
  const { ct, iv } = await encryptWith(dek, "hello world");
  ct[0] ^= 0xff;
  await assert.rejects(decryptWith(dek, ct, iv));
});

test("tampered IV is rejected", async () => {
  const { dek } = await createVault("pw");
  const { ct, iv } = await encryptWith(dek, "hello world");
  iv[0] ^= 0xff;
  await assert.rejects(decryptWith(dek, ct, iv));
});
