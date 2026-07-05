// RFC 6238 golden vectors for TOTP.
// Reference: https://datatracker.ietf.org/doc/html/rfc6238#appendix-B
//
// Runs standalone with Node's built-in test runner:
//   node --test tests/crypto/rfc6238.spec.mjs

import test from "node:test";
import assert from "node:assert/strict";
import * as OTPAuth from "otpauth";

// The RFC's shared secret is the ASCII "12345678901234567890" (20 bytes).
// For SHA-256 the RFC extends the seed to 32 bytes, for SHA-512 to 64 bytes.
const SECRET_SHA1 = "12345678901234567890";
const SECRET_SHA256 = "12345678901234567890123456789012";
const SECRET_SHA512 =
  "1234567890123456789012345678901234567890123456789012345678901234";

const toB32 = (ascii) => {
  // otpauth expects base32; convert the ASCII secret first.
  const bytes = new TextEncoder().encode(ascii);
  return new OTPAuth.Secret({ buffer: bytes.buffer }).base32;
};

const VECTORS = [
  { time: 59, sha1: "94287082", sha256: "46119246", sha512: "90693936" },
  { time: 1111111109, sha1: "07081804", sha256: "68084774", sha512: "25091201" },
  { time: 1111111111, sha1: "14050471", sha256: "67062674", sha512: "99943326" },
  { time: 1234567890, sha1: "89005924", sha256: "91819424", sha512: "93441116" },
  { time: 2000000000, sha1: "69279037", sha256: "90698825", sha512: "38618901" },
  { time: 20000000000, sha1: "65353130", sha256: "77737706", sha512: "47863826" },
];

function code(algo, secret, timeSeconds) {
  const totp = new OTPAuth.TOTP({
    algorithm: algo,
    digits: 8,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(toB32(secret)),
  });
  return totp.generate({ timestamp: timeSeconds * 1000 });
}

for (const v of VECTORS) {
  test(`RFC6238 SHA1 t=${v.time}`, () => {
    assert.equal(code("SHA1", SECRET_SHA1, v.time), v.sha1);
  });
  test(`RFC6238 SHA256 t=${v.time}`, () => {
    assert.equal(code("SHA256", SECRET_SHA256, v.time), v.sha256);
  });
  test(`RFC6238 SHA512 t=${v.time}`, () => {
    assert.equal(code("SHA512", SECRET_SHA512, v.time), v.sha512);
  });
}
