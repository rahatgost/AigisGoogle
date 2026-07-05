# Aegis

A zero-knowledge, end-to-end encrypted TOTP authenticator you can use in your
browser. Your master passphrase never leaves your device. The server stores
opaque ciphertext and nothing else — a full database dump leaks zero codes.

Built on TanStack Start (SSR React 19 + Vite 7 on Cloudflare Workers), backed
by Lovable Cloud (Supabase-flavoured Postgres with RLS), and paranoid about
crypto correctness — RFC 6238 golden vectors run on every commit.

## Highlights

- **Zero-knowledge crypto.** PBKDF2-HMAC-SHA256 · 600 000 iterations (OWASP
  2024 baseline) → AES-GCM 256 wrap of a per-user DEK. Every TOTP secret is
  encrypted on the client with the DEK before it hits the network. See
  [`SECURITY.md`](./SECURITY.md).
- **Cross-device sync without trust.** Vault syncs through Lovable Cloud, but
  the server sees ciphertext only. Change your passphrase in one place and
  every device stays online — we rewrap the KEK, the DEK never changes, and
  `vault_accounts` is never re-written.
- **Broad bulk import.** Google Authenticator `otpauth-migration://` (with
  QR-from-screenshot decode), Aegis JSON, 2FAS JSON, raw `otpauth://` lists,
  and our own encrypted `.avf` backup — all with a per-row preview and
  per-row checkbox stage.
- **Encrypted personal backups (`.avf`).** Passphrase-independent from your
  vault passphrase, same crypto envelope, restores on any device via the
  importer. Round-trip covered by tests.
- **Recovery kit + biometric unlock + auto-lock.** WebAuthn platform
  authenticator (Face ID / Touch ID / Windows Hello), auto-lock timer with
  1/5/15/30-minute or never options, and a printable recovery kit to get
  back in if you lose the passphrase.
- **Hardened backend.** Row-Level Security on every user table, admin-audit
  append-only log, per-user account cap (500), insert rate-limit (60 rows /
  minute), and a strict `Content-Security-Policy` + `Strict-Transport-Security`
  + `Permissions-Policy` middleware on every server response.

## What Aegis is not (yet)

We ship what's honest. See [`docs/competitive-analysis.md`](./docs/competitive-analysis.md)
for the full audit against Google Authenticator, Microsoft, Authy, 2FAS,
Aegis (Android), Ente, Raivo, Bitwarden, and 1Password. Today the real
gaps are: no offline mode, no native mobile app, no browser-extension
autofill, no dark mode, no localisation, no tags UI (schema is there),
no HOTP / Steam Guard. All of these are scoped phases in
[`docs/roadmap.md`](./docs/roadmap.md).

## Roadmap at a glance

| Phase | Status | What it ships |
| --- | --- | --- |
| 0 · Baseline audit | ✅ closed | Security policy, route map, perf baseline |
| 1 · Backend hardening | ✅ closed | RLS + admin roles + audit log + CSP + DR doc |
| 2 · Crypto version lock | ✅ closed | `VAULT_CRYPTO_VERSION = 1`, RFC 6238 tests |
| 3 · Vault UX depth | ✅ closed | Server-synced favorites, encrypted `.avf` export |
| 4 · Account lifecycle | ✅ closed | Change passphrase, auto-lock, biometric, avatar, delete |
| 5 · `.avf` restore | ✅ closed | End-to-end backup / restore across devices |
| 6 · Offline + PWA | 🚧 next | Service worker, IndexedDB cache, installable |
| 7 · Vault UX II | ⏳ | Tags UI, drag-and-drop, bulk edit, HOTP, Steam Guard |
| 8 · Design system, dark mode, i18n, a11y | ⏳ | WCAG 2.1 AA, 8 locales, semantic tokens |
| 9 · Security dashboard | ⏳ | Trusted devices, sign-in history, vault health |
| 10 · Browser extension | ⏳ | Manifest V3 autofill |
| 11 · Native (iOS + Android) | ⏳ | Capacitor wrap, widget, watch complication |
| 12 · Crypto v2 | ⏳ | Argon2id + AAD binding + background re-encrypt |
| 13 · Sharing, family, teams | ⏳ | 1:1 shared credentials, family plan, billing |
| 14 · Open source + self-host | ⏳ | Public client repo, Docker Compose stack |

Full detail — including exit criteria and rationale — in
[`docs/roadmap.md`](./docs/roadmap.md).

## Getting started

```bash
bun install          # or npm / pnpm
bun run dev          # http://localhost:8080
bun run build        # production bundle
bunx tsgo --noEmit   # type-check
node --import tsx --test tests/crypto/*.spec.mjs   # crypto suite
node --test tests/rls/*.spec.mjs                    # RLS regression
```

The dev server auto-runs; edits hot-reload. See
[`.lovable/plan.md`](./.lovable/plan.md) for the current short-horizon
plan (what the next PR does).

## Architecture

- **Runtime.** TanStack Start v1 on Vite 7, targeting Cloudflare Workers via
  `nodejs_compat`. SSR by default; server functions live in `*.functions.ts`
  files next to the route that consumes them.
- **Data.** Lovable Cloud (Supabase) with Postgres + RLS. Every public
  table has explicit `GRANT` statements and RLS policies — no schema is
  reachable without a policy match. Migrations live in `supabase/migrations/`.
- **Auth.** Supabase Auth (email + Google OAuth), with a `_authenticated`
  layout route gating the vault. The vault itself is gated a second time
  by `_authenticated/_locked/` for passphrase unlock.
- **Crypto.** `src/lib/vault-crypto.ts` is the single source of truth. It
  exports `VAULT_CRYPTO_VERSION`, the KDF, the wrap/unwrap primitives, and
  the AES-GCM encrypt/decrypt for account secrets. Anything crypto-adjacent
  imports from here, never re-implements.
- **Import / export.** `src/lib/vault-import.ts` (parsers, no I/O) and
  `src/lib/vault-export.ts` (encrypted backup envelope). All parsers are
  pure functions and unit-testable without a bundler.

Route inventory, guard stack, and per-route data reads: see
[`docs/routing.md`](./docs/routing.md). Disaster recovery posture:
[`docs/dr.md`](./docs/dr.md).

## Security

- Threat model, invariants, and pinned crypto parameters are in
  [`SECURITY.md`](./SECURITY.md).
- Coordinated-disclosure stub is in the same file. A production security
  contact is landed at GA.
- No secret material — TOTP secrets, passphrases, DEKs, KEKs — is ever
  logged, transmitted, or written to disk outside of the encrypted vault
  path. This is enforced by review, not decoration.

## Tests

- `tests/crypto/rfc6238.spec.mjs` — 18 RFC 6238 golden vectors across
  SHA-1 / SHA-256 / SHA-512.
- `tests/crypto/vault-crypto.roundtrip.spec.mjs` — KDF determinism,
  wrap/unwrap round-trip, wrong-passphrase rejection, tampered
  ciphertext / IV rejection.
- `tests/crypto/vault-export.roundtrip.spec.mjs` — `.avf` build →
  decrypt → serialise round-trip, wrong-passphrase and weak-passphrase
  rejection.
- `tests/rls/anonymous-cannot-read.spec.mjs` — 9 assertions confirming
  anonymous SELECT returns no rows on any user or admin table, and
  anonymous INSERT is rejected on `vault_accounts` + `profiles`.

## Contributing

The repository is currently developed inside the Lovable workspace.
Every change goes through:

1. Typecheck: `bunx tsgo --noEmit` — must be **0 errors**.
2. Lint: `bunx eslint .` — must be **0 errors** (10 shadcn refresh
   warnings are expected).
3. Build: `bun run build` — must be clean.
4. Tests: all of the above suites must be green.

Every migration that creates a table in the `public` schema must also
`GRANT` privileges and enable RLS in the same file — the template
enforces this and CI will reject a table without a matching grant.

## License

TBD — publishing under Apache 2.0 or MPL 2.0 is Phase 14 in the roadmap.

---

Built with paranoid crypto and no dark patterns. If a change would let
an operator, a Supabase admin, or an edge-side attacker decrypt vault
contents, it does not merge. That is the whole product.
