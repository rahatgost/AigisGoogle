#!/usr/bin/env node
// Mint ANON_KEY and SERVICE_ROLE_KEY signed with your JWT_SECRET.
//
//   JWT_SECRET=$(openssl rand -base64 48) node self-host/scripts/mint-keys.mjs
//
// Prints two lines ready to paste into `self-host/.env`.

import { createHmac } from "node:crypto";

const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error("JWT_SECRET env var is required");
  process.exit(1);
}

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

function sign(role) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    role,
    iss: "aegis-self-hosted",
    iat: now,
    exp: now + 60 * 60 * 24 * 365 * 10, // 10 years
  };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

console.log(`ANON_KEY=${sign("anon")}`);
console.log(`SERVICE_ROLE_KEY=${sign("service_role")}`);
