// Smoke test: extension Steam Guard code must match the web app's, byte-for-byte.
//
// Regression guard for the bug where the extension treated `otp_type: "steam"`
// as a plain 6-digit TOTP and thus filled the wrong code into the page.
//
// The extension bundle can't be imported from Node directly (it's a Vite
// artifact targeting a browser worker), so we mirror the exact routine from
// extension/src/background.ts::generateSteamCode here and compare against
// the web-app generator from src/lib/vault-accounts.ts. If they diverge for
// any T-slot, this test fails loudly and the extension zips are unsafe to ship.

import test from "node:test";
import assert from "node:assert/strict";
import * as OTPAuth from "otpauth";

const { generateCode: webGenerate } = await import("../../src/lib/vault-accounts.ts");

const STEAM_ALPHABET = "23456789BCDFGHJKMNPQRTVWXY";
const STEAM_PERIOD = 30;

// Mirror of extension/src/background.ts::generateSteamCode
function extGenerateSteam(secretBase32, at) {
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

const SECRETS = [
  "JBSWY3DPEHPK3PXP",
  "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  "KRSXG5CTMVRXEZLU",
];

test("Steam OTP parity — extension mirrors web across time slots", () => {
  const now = Date.now();
  for (const secret of SECRETS) {
    for (const offset of [-90_000, -30_000, 0, 30_000, 90_000, 3_600_000]) {
      const at = now + offset;
      const web = webGenerate(
        {
          id: "x",
          issuer: "Steam",
          label: "test",
          secret,
          algorithm: "SHA1",
          digits: 5,
          period: STEAM_PERIOD,
          otp_type: "steam",
        },
        at,
      );
      const ext = extGenerateSteam(secret, at);
      assert.equal(ext, web, `mismatch @ ${new Date(at).toISOString()} for ${secret}`);
      assert.match(ext, /^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
    }
  }
});

test("Steam OTP is stable inside a single 30s window", () => {
  const t = 1_800_000_000_000;
  assert.equal(extGenerateSteam(SECRETS[0], t), extGenerateSteam(SECRETS[0], t + 5_000));
});
