# Aegis — Production Roadmap

Last updated: 2026-07-05 · Owner: Engineering + Product

This is the long-horizon roadmap from "hardened MVP" to "production-grade,
best-in-class TOTP authenticator". It is phase-ordered by dependency, not by
preference — Phase N assumes Phase N-1 has landed.

The short-horizon plan (what the next PR does) lives in
`.lovable/plan.md`. This document is the *why* and *when*. The
`docs/competitive-analysis.md` doc is the *what we're missing and why it
matters*.

**Legend:** `[P0]` blocker for GA · `[P1]` fast-follow · `[P2]` polish /
post-launch · `[✔]` already landed.

---

## What's already landed (Phases 0–5, closed)

| Phase | Status | Highlights |
| --- | --- | --- |
| 0 · Baseline audit | ✅ | `SECURITY.md`, `docs/routing.md`, `perf/baseline.json`, clean typecheck + lint + build |
| 1 · Backend hardening | ✅ | Roles + `is_admin()`, `client_errors`, `admin_audit`, `feature_flags`, `announcements`, vault size caps + per-user 500 cap + insert rate-limit, RLS on every user table, CSP + HSTS + Permissions-Policy middleware, RLS CI test, DR doc |
| 2 · Crypto version lock | ✅ | `VAULT_CRYPTO_VERSION = 1` frozen, RFC 6238 golden vectors, wrap/unwrap round-trip tests |
| 3 · Vault UX depth | ✅ | DB-synced favorites, encrypted `.avf` export with passphrase strength meter |
| 4 · Account lifecycle | ✅ | Change passphrase (rewrap KEK, DEK unchanged), auto-lock timer sync, biometric enroll/disable, avatar, delete account |
| 5 · `.avf` restore in importer | ✅ | Full round-trip: export on device A → restore on device B with export passphrase only |

Baseline for everything below: typecheck 0 errors, lint 0 errors (10 expected
shadcn warnings), build clean, RLS + crypto CI green.

---

## Phase 6 — Offline & installability (`[P0]`, 2 weeks)

**Problem** — see competitive-analysis §"Where the gap is real" #1 and #2.
A web authenticator that dies when you're on the subway loses to a native
app every time.

### 6.1 Service worker + PWA manifest `[P0]`
- `vite-plugin-pwa` with `workbox` in `injectManifest` mode so we can hand-write
  the fetch strategy: network-first for the API, stale-while-revalidate for
  static assets, cache-first for fonts + icons.
- Web-app manifest with `display: standalone`, brand icons at
  192/256/384/512 + maskable + monochrome, `theme_color` matching our
  cream palette, share-target intent for `otpauth://` URIs.
- Install prompt on the vault screen after the third successful visit
  (behind `feature_flags.pwa_install_prompt`).

### 6.2 Encrypted offline vault mirror `[P0]`
- IndexedDB store `vault_cache` holding the same ciphertext rows we
  already fetch. It never sees plaintext — decrypt happens in memory
  after unlock, same as the online path.
- On the next successful auth, run a diff sync (`updated_at > last_sync`)
  and reconcile deletions. Conflict rule: server wins on `updated_at`
  ties, client wins on optimistic favorite toggles from the last 60 s.
- Loader in `_authenticated/_tabs/vault.tsx` reads cache first, hydrates
  from the server in the background, invalidates on `focus`.

### 6.3 Route-level code splitting `[P1]`
Baseline biggest chunks (from `perf/baseline.json`):
`@zxing/browser` 1.07 MB · `@tanstack/react-router` 656 KB · `esm` 458 KB
· `index` 450 KB · `vault_.recovery` 419 KB · `jspdf` 477 KB.

- Dynamic-import `@zxing/browser` inside `ScanTab` only.
- Dynamic-import `jspdf` inside the recovery route only.
- Manual chunk-split for the router runtime so route code isn't
  duplicated across chunks.
- **Exit target:** main entry ≤ 250 KB gzipped, first vault paint on 3G
  ≤ 2.5 s, Lighthouse PWA score 90+.

### 6.4 Offline UX affordances `[P1]`
- Banner "You're offline — showing cached codes" with a Retry pill.
- Add / edit / delete queued in an outbox and replayed on reconnect.
- QR scanning explicitly disabled offline (camera stream is fine, but
  we can't validate against the account).

**Exit criteria for Phase 6:** Aegis is installable on iOS + Android
home screen, opens with no network, shows cached codes, replays writes
on reconnect. Lighthouse PWA ≥ 90, main bundle ≤ 250 KB gzipped.

---

## Phase 7 — Vault UX depth II (`[P1]`, 1.5 weeks)

**Problem** — competitive-analysis #6. The schema is there; the UI isn't.

### 7.1 Tags UI `[P1]`
- Tag chips on `AccountCard`, tag filter on the search bar, tag manager
  sheet (rename, merge, delete, colour). Tags already exist in
  `vault_accounts.tags text[]` with a GIN index from Phase 1.1.

### 7.2 Drag-and-drop reorder `[P1]`
- `@dnd-kit/core` on the vault grid, writing to the existing
  `sort_order` column. Optimistic reorder + debounced batch update.

### 7.3 Bulk operations `[P1]`
- Long-press to enter selection mode, checkbox column, bulk delete +
  bulk tag + bulk export subset to `.avf`.

### 7.4 HOTP + Steam Guard support `[P1]`
- Extend `vault-crypto` + `vault-accounts` with a discriminated
  `type: 'totp' | 'hotp' | 'steam'`. HOTP counter lives in an encrypted
  field so the server never sees it. Steam Guard uses the known
  alphabet + 5-char format.
- Update importer parsers (they already skip HOTP today) to accept
  them.

**Exit criteria:** Tags, folders-via-tags, DnD reorder, bulk edit/delete,
HOTP + Steam Guard all in the vault screen without a new route.

---

## Phase 8 — Design system, theming, i18n, a11y (`[P0]` for GA, 2 weeks)

### 8.1 Semantic-token pass `[P0]`
- Move every hard-coded hex in `chrome.tsx`, `settings.tsx`, and the
  route files onto `src/styles.css` `@theme` tokens: `--color-surface`,
  `--color-surface-raised`, `--color-ink`, `--color-ink-muted`,
  `--color-accent`, `--color-danger`, `--color-success`,
  `--radius-*`, `--shadow-*`. Every component reads via `bg-surface`,
  `text-ink`, etc.
- Storybook (or a `/dev/tokens` internal route) that renders every
  token so drift is visible.

### 8.2 Dark mode `[P0]`
- Second theme block toggled by `prefers-color-scheme` + a manual
  override in Profile that syncs to `profiles.theme_pref`.
- Cover screenshot regression: run Playwright against every route in
  `docs/routing.md`, snap light + dark, diff via `pixelmatch` in CI.

### 8.3 Localization `[P1]`
- `@lingui/core` with message extraction from JSX. First eight locales:
  en, es, pt-BR, fr, de, ja, hi, bn. String freeze policy: every PR
  that touches user-facing copy runs the extractor.
- Locale picker in Profile → mirrored to `profiles.locale`.

### 8.4 Accessibility `[P0]`
- Axe-core in CI walking the same route list as the screenshot test —
  zero critical or serious violations to merge.
- Keyboard-only run of every flow: onboarding, unlock, add account,
  import, export, change passphrase, delete account.
- Reduced-motion honoured for the scanner sweep and all Framer Motion
  transitions.

**Exit criteria:** WCAG 2.1 AA clean, dark mode ships, en + 5 locales
in production, no hard-coded colours in `src/components/aegis/*`.

---

## Phase 9 — Security dashboard for the user (`[P1]`, 2 weeks)

**Problem** — competitive-analysis #8. Users who care about 2FA also care
about *where their sessions live*.

### 9.1 Trusted devices `[P1]`
- New table `user_sessions_meta` (server-writable only, admin-audit
  logged) tracking session UA, coarse geo (from Cloudflare
  `cf-ipcountry`), first-seen, last-seen, current-session flag.
- Profile → Security → Devices list with a "Sign out this device"
  action that revokes the Supabase refresh token.

### 9.2 Sign-in history `[P1]`
- Row-per-successful-sign-in in `user_login_events`, 90-day rolling
  window, admin-audit logged. Show the last 20 to the user.

### 9.3 Vault health `[P1]`
- Client-side pass: count duplicate secrets (hash of ciphertext + IV
  won't work — hash the *decrypted* secret in memory only), issuers
  with no icon, favourites with weak issuers. Everything computed
  locally after unlock; nothing leaves the device.
- Optional HIBP lookup for issuer domains (k-anonymity endpoint, no
  secret leaves the device).

### 9.4 Passphrase strength check on change `[P1]`
- We already show a meter on export passphrase; port the same meter to
  change-passphrase and refuse anything with `zxcvbn score < 3`.

**Exit criteria:** A user can see every device signed into their vault,
revoke any of them, see their sign-in history, and get a one-glance
"vault health" score.

---

## Phase 10 — Browser extension (`[P1]`, 2 weeks)

**Problem** — competitive-analysis #5. Autofill is the single-biggest
retention lever for authenticator apps.

### 10.1 Manifest V3 shell `[P1]`
- Shared codebase: extension is a second Vite entry point that reuses
  `vault-crypto`, `vault-accounts`, `biometric` verbatim.
- Origin allow-list, no host permissions we don't need, CSP that
  forbids remote code.

### 10.2 Autofill flow `[P1]`
- Content script detects `<input autocomplete="one-time-code">` and
  `name~=otp` heuristics, offers the current code from the vault
  matched by issuer (fuzzy match on domain).
- Copy-to-clipboard fallback with the same 30 s auto-clear.

### 10.3 Cross-device push `[P2]`
- WebPush from the extension to the web app for "approve on this
  device" flows. Requires a signed payload + short-lived nonce table.

**Exit criteria:** Chrome + Firefox extensions in their stores, autofill
works on the top 20 sites we test against.

---

## Phase 11 — Native shell (`[P0]` for parity, 3 weeks)

**Problem** — competitive-analysis #1, #4. iOS PWA has real limits
(background timers, share targets, widgets, watch).

### 11.1 Capacitor wrapper `[P0]`
- Wrap the existing Vite build with Capacitor. Reuse 100 % of the web
  code; native code only in three plugins: `SecureStore`
  (Keychain/Keystore) for the DEK cache, `LocalAuth` (Face ID /
  fingerprint) replacing WebAuthn on device, `CameraQR` for a native
  scanner faster than `@zxing/browser`.
- App Store + Play Store presence, TestFlight beta channel gated by
  `feature_flags.native_beta`.

### 11.2 Widget + watch complications `[P1]`
- iOS Home-screen widget + Apple Watch complication showing the
  current code for the pinned issuer (Live Activity for the 30 s
  countdown).
- Wear OS tile equivalent.

### 11.3 Push authentication `[P2]`
- APNs / FCM channel + a signed challenge from the web app that the
  native app approves. Bind to trusted-device list from Phase 9.

**Exit criteria:** iOS + Android apps in the stores using the same
zero-knowledge crypto path, TestFlight + Play internal-track
distribution live, widget + complication for the pinned issuer.

---

## Phase 12 — Crypto v2 (`[P1]`, 1 week)

**Problem** — PBKDF2 is old. AAD binding is missing. Bump the version.

### 12.1 `VAULT_CRYPTO_VERSION = 2` `[P1]`
- Argon2id (memory 64 MiB, iterations 3, parallelism 1) via
  `@noble/hashes` for the KDF. Salt stays 16 bytes.
- AES-GCM `additionalData` = `utf8(user_id + '|' + account_id)` so a
  row stolen and re-inserted under another user won't decrypt.

### 12.2 Background re-encrypt migrator `[P1]`
- On first unlock post-upgrade, for every row where
  `crypto_version < 2`, decrypt with v1 → re-encrypt with v2 → write
  back with `crypto_version = 2`. Batched, idempotent, resumable.

### 12.3 Migration telemetry `[P1]`
- Client posts `{ from, to, rows_migrated, elapsed_ms }` to
  `client_errors` (kind = `info`) so we can see the roll-forward
  progress across the fleet without seeing any secret material.

**Exit criteria:** All new vaults are v2. 95 % of active vaults migrated
within 30 days. Old v1 code kept in-tree for six months, then removed.

---

## Phase 13 — Sharing, family, teams (`[P2]`, 4 weeks)

**Problem** — competitive-analysis #9. This is the revenue phase.

### 13.1 Vault sharing (1:1) `[P2]`
- Recipient's public key added on account creation (Ed25519 wrapping
  key). Sender rewraps the DEK-for-that-account with the recipient's
  public key. Server sees the wrapped blob only.
- Revocation = delete the wrap row; the shared account rotates its
  secret next time the owner touches it.

### 13.2 Family plan `[P2]`
- Family group with an admin, up to 6 members. Family-scoped vault
  in addition to per-user vaults. Same crypto path.

### 13.3 Billing `[P2]`
- Stripe subscriptions via the payments connector, `family` and
  `pro` tiers. Free tier stays permanent for a single-user vault up
  to 25 accounts.

**Exit criteria:** Two humans can share one credential end-to-end
encrypted, without the server ever seeing plaintext.

---

## Phase 14 — Openness & self-hosting (`[P2]`, 2 weeks)

**Problem** — competitive-analysis #10.

### 14.1 Open-source client `[P2]`
- Publish the client + shared crypto under Apache 2.0 or MPL 2.0.
- Reproducible build recipe in `docs/reproducible-build.md`.

### 14.2 Public API + docs `[P2]`
- Publish the OpenAPI schema for read-only vault ops (with a required
  personal API token). Ship `docs/api.md` and a Postman collection.

### 14.3 Self-hosted server recipe `[P2]`
- Docker Compose stack: Postgres + our migrations + a lightweight edge
  runtime. `docs/self-host.md` walks through the four env vars, the
  first-boot admin user, and how to run the RLS CI test against your
  own instance.

**Exit criteria:** A privacy-forum reader can install a self-hosted
Aegis in under 15 minutes and pass the same RLS test we ship.

---

## Cross-cutting tracks (always on)

### Observability
- `client_errors` already exists. Add a lightweight in-app "Report a
  problem" that captures redacted state (never secrets) and posts to
  the same table.
- Server-side edge logs shipped to a log sink; retention 30 days.
- Real-User Monitoring for LCP, INP, CLS on the vault screen.

### Performance budget
- Main JS ≤ 250 KB gzipped, initial CSS ≤ 30 KB, LCP ≤ 2.5 s on 3G,
  INP ≤ 200 ms. Enforced by `bundlesize` in CI after Phase 6.

### Security review cadence
- Quarterly external pentest, results merged into `SECURITY.md` under
  Findings.
- `SECURITY.md` coordinated-disclosure inbox opens at GA.

### Testing pyramid
- Unit tests already exist for crypto + import parsers. Add:
  - Component tests for `AccountCard`, `PasteTab`, `AvfPassStage` via
    Vitest + Testing Library.
  - Playwright end-to-end for onboarding → add → export → restore on a
    second device, run in CI on every PR that touches `src/routes/**`.

### Documentation
- Every phase ships an update to `docs/architecture.md` (to be created
  in Phase 6) and a public changelog entry once the marketing site
  exists.

---

## Milestones (calendar view)

| Milestone | Phases | Ships |
| --- | --- | --- |
| **GA candidate** | 6, 7, 8 | Installable PWA, dark mode, i18n, WCAG AA, tags + DnD + HOTP |
| **GA** | 9, 12 | Security dashboard, crypto v2 migrated |
| **Best-in-class web** | 10 | Browser extension autofill |
| **Cross-platform parity** | 11 | Native iOS + Android with widget + watch |
| **Growth / revenue** | 13 | Sharing, family plan, billing |
| **Ecosystem** | 14 | Open source client, self-hosted recipe |

At today's velocity (one closed phase per turn) GA lands within one
sprint after Phase 8. Native and sharing are the two multi-week phases;
everything else is sub-two-weeks of engineering.
