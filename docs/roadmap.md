# Aegis — Production Roadmap

Last updated: 2026-07-06 · Owner: Engineering + Product

This is the long-horizon roadmap from "hardened MVP" to "production-grade,
best-in-class TOTP authenticator". It is phase-ordered by dependency, not by
preference — Phase N assumes Phase N-1 has landed.

The short-horizon plan (what the next PR does) lives in
`.lovable/plan.md`. This document is the *why* and *when*. The
`docs/competitive-analysis.md` doc is the *what we're missing and why it
matters*.

**Legend:** `[P0]` blocker for GA · `[P1]` fast-follow · `[P2]` polish /
post-launch. Tick `- [x]` as each task lands.

**Progress:** Phase 0–5 complete. **Phase 6.1 + 6.2 shipped** (PWA
manifest, service worker, guarded registration, protocol handler, share
target, install prompt behind `feature_flags.pwa_install_prompt`,
encrypted IndexedDB vault mirror with cache-first paint, delta sync,
optimistic favorite window, focus/visibility invalidation). Currently
on **Phase 6.3 — route-level code splitting**.

---

## Phase 0 — Baseline audit `[done]`

- [x] `SECURITY.md` published
- [x] `docs/routing.md` published
- [x] `perf/baseline.json` captured
- [x] Clean typecheck + lint + build baseline

## Phase 1 — Backend hardening `[done]`

- [x] Roles table + `is_admin()` security-definer
- [x] `client_errors` table
- [x] `admin_audit` table
- [x] `feature_flags` table
- [x] `announcements` table
- [x] Vault size caps + per-user 500 cap + insert rate-limit
- [x] RLS on every user table
- [x] CSP + HSTS + Permissions-Policy middleware
- [x] RLS CI test
- [x] Disaster recovery doc

## Phase 2 — Crypto version lock `[done]`

- [x] `VAULT_CRYPTO_VERSION = 1` frozen
- [x] RFC 6238 golden vectors
- [x] Wrap / unwrap round-trip tests

## Phase 3 — Vault UX depth `[done]`

- [x] DB-synced favorites
- [x] Encrypted `.avf` export
- [x] Passphrase strength meter

## Phase 4 — Account lifecycle `[done]`

- [x] Change passphrase (rewrap KEK, DEK unchanged)
- [x] Auto-lock timer sync
- [x] Biometric enroll / disable
- [x] Avatar
- [x] Delete account

## Phase 5 — `.avf` restore in importer `[done]`

- [x] Full round-trip: export on device A → restore on device B with export passphrase only

Baseline for everything below: typecheck 0 errors, lint 0 errors (10 expected
shadcn warnings), build clean, RLS + crypto CI green.

---

## Phase 6 — Offline & installability (`[P0]`, 2 weeks)

**Problem** — competitive-analysis §"Where the gap is real" #1 and #2.
A web authenticator that dies when you're on the subway loses to a native
app every time.

### 6.1 Service worker + PWA manifest `[P0]` `[done]`
- [x] `vite-plugin-pwa` with `generateSW` (skill-mandated), `injectRegister: null`, `devOptions.enabled: false`, network-first navigations, SWR Google Fonts CSS, cache-first Google Fonts files
- [x] Web-app manifest: `display: standalone`, brand icons 192/256/512 + maskable, `theme_color` matching cream palette, `protocol_handlers` for `otpauth://`, `share_target` accepting `otpauth://` payloads
- [x] Guarded registration wrapper (`src/lib/pwa-register.ts`) refusing dev, iframe, Lovable preview hosts, and `?sw=off`; unregisters stale `/sw.js` in refused contexts
- [x] Install prompt on the vault screen after the third successful visit (behind `feature_flags.pwa_install_prompt`, disabled by default)

### 6.2 Encrypted offline vault mirror `[P0]` `[done]`
- [x] IndexedDB `vault_cache` holds only ciphertext + IV — decryption is still in-memory after unlock (`src/lib/vault-cache.ts`)
- [x] Owner rotation clears prior user's ciphertext on write; per-user reads return `null` on mismatch (no cross-user leakage)
- [x] Cache-first loader in `_authenticated/_tabs/vault.tsx` — paints from IndexedDB immediately, then hydrates from server
- [x] `syncAccountsFromServer` diff sync: fetches full row set, writes `last_sync` per user, updates cache mirror
- [x] Merge rule: server-wins on ties, client-wins on `is_favorite` toggles from the last 60 s (`mergeAccountRows` + `recordFavoriteToggle`)
- [x] Focus + `visibilitychange` invalidate — returning to the tab kicks a fresh sync
- [x] Offline mutations mirror into cache (add/update/delete/favorite/tags); queued tag edits flush on reconnect

### 6.3 Route-level code splitting `[P1]`
Baseline biggest chunks (from `perf/baseline.json`):
`@zxing/browser` 1.07 MB · `@tanstack/react-router` 656 KB · `esm` 458 KB
· `index` 450 KB · `vault_.recovery` 419 KB · `jspdf` 477 KB.

- [ ] Dynamic-import `@zxing/browser` inside `ScanTab` only
- [ ] Dynamic-import `jspdf` inside the recovery route only
- [ ] Manual chunk-split for the router runtime
- [ ] **Exit target:** main entry ≤ 250 KB gzipped, first vault paint on 3G ≤ 2.5s, Lighthouse PWA 90+

### 6.4 Offline UX affordances `[P1]`
- [ ] Banner "You're offline — showing cached codes" with Retry pill
- [ ] Add / edit / delete queued in an outbox and replayed on reconnect
- [ ] QR scanning explicitly disabled offline

**Exit criteria for Phase 6:** Aegis is installable on iOS + Android
home screen, opens with no network, shows cached codes, replays writes
on reconnect. Lighthouse PWA ≥ 90, main bundle ≤ 250 KB gzipped.

---

## Phase 7 — Vault UX depth II (`[P1]`, 1.5 weeks)

**Problem** — competitive-analysis #6. The schema is there; the UI isn't.

### 7.1 Tags UI `[P1]`
- [ ] Tag chips on `AccountCard`
- [ ] Tag filter on the search bar
- [ ] Tag manager sheet (rename, merge, delete, colour)

### 7.2 Drag-and-drop reorder `[P1]`
- [ ] `@dnd-kit/core` on vault grid, writes existing `sort_order` column
- [ ] Optimistic reorder + debounced batch update

### 7.3 Bulk operations `[P1]`
- [ ] Long-press to enter selection mode
- [ ] Checkbox column
- [ ] Bulk delete + bulk tag + bulk export subset to `.avf`

### 7.4 HOTP + Steam Guard support `[P1]`
- [ ] Discriminated `type: 'totp' | 'hotp' | 'steam'` in `vault-crypto` + `vault-accounts`
- [ ] HOTP counter in an encrypted field (server never sees it)
- [ ] Steam Guard alphabet + 5-char format
- [ ] Importer parsers accept HOTP + Steam Guard

**Exit criteria:** Tags, folders-via-tags, DnD reorder, bulk edit/delete,
HOTP + Steam Guard all in the vault screen without a new route.

---

## Phase 8 — Design system, theming, i18n, a11y (`[P0]` for GA, 2 weeks)

### 8.1 Semantic-token pass `[P0]`
- [ ] Move every hard-coded hex in `chrome.tsx`, `settings.tsx`, and route files onto `src/styles.css` `@theme` tokens
- [ ] Every component reads via `bg-surface`, `text-ink`, etc.
- [ ] Storybook (or `/dev/tokens` internal route) rendering every token

### 8.2 Dark mode `[P0]`
- [ ] Second theme block toggled by `prefers-color-scheme` + manual override in Profile syncing to `profiles.theme_pref`
- [ ] Screenshot regression: Playwright every route in `docs/routing.md`, snap light + dark, diff via `pixelmatch` in CI

### 8.3 Localization `[P1]`
- [ ] `@lingui/core` with message extraction from JSX
- [ ] First eight locales: en, es, pt-BR, fr, de, ja, hi, bn
- [ ] String freeze policy: every PR touching user-facing copy runs the extractor
- [ ] Locale picker in Profile → mirrored to `profiles.locale`

### 8.4 Accessibility `[P0]`
- [ ] Axe-core in CI walking the same route list — zero critical or serious violations
- [ ] Keyboard-only run of every flow (onboarding, unlock, add, import, export, change passphrase, delete)
- [ ] Reduced-motion honoured for scanner sweep + all Framer Motion transitions

**Exit criteria:** WCAG 2.1 AA clean, dark mode ships, en + 5 locales
in production, no hard-coded colours in `src/components/aegis/*`.

---

## Phase 9 — Security dashboard for the user (`[P1]`, 2 weeks)

### 9.1 Trusted devices `[P1]`
- [ ] Table `user_sessions_meta` (server-writable only, admin-audit logged) tracking UA, coarse geo, first-seen, last-seen, current-session flag
- [ ] Profile → Security → Devices list with "Sign out this device" revoking Supabase refresh token

### 9.2 Sign-in history `[P1]`
- [ ] `user_login_events` row per successful sign-in, 90-day rolling window, admin-audit logged
- [ ] Show last 20 to the user

### 9.3 Vault health `[P1]`
- [ ] Client-side pass: duplicate secrets (hash decrypted secret in memory), issuers with no icon, favourites with weak issuers
- [ ] Optional HIBP lookup for issuer domains (k-anonymity endpoint)

### 9.4 Passphrase strength on change `[P1]`
- [ ] Port export passphrase meter to change-passphrase, refuse `zxcvbn score < 3`

**Exit criteria:** A user can see every device signed into their vault,
revoke any of them, see their sign-in history, and get a one-glance
"vault health" score.

---

## Phase 10 — Browser extension (`[P1]`, 2 weeks)

### 10.1 Manifest V3 shell `[P1]`
- [ ] Second Vite entry point reusing `vault-crypto`, `vault-accounts`, `biometric` verbatim
- [ ] Origin allow-list, minimal host permissions, CSP forbidding remote code

### 10.2 Autofill flow `[P1]`
- [ ] Content script detects `<input autocomplete="one-time-code">` + `name~=otp` heuristics
- [ ] Offer current code from vault matched by issuer (fuzzy match on domain)
- [ ] Copy-to-clipboard fallback with 30s auto-clear

### 10.3 Cross-device push `[P2]`
- [ ] WebPush from extension to web app for "approve on this device" flows
- [ ] Signed payload + short-lived nonce table

**Exit criteria:** Chrome + Firefox extensions in their stores, autofill
works on the top 20 sites we test against.

---

## Phase 11 — Native shell (`[P0]` for parity, 3 weeks)

### 11.1 Capacitor wrapper `[P0]`
- [ ] Wrap Vite build with Capacitor
- [ ] Native plugin `SecureStore` (Keychain/Keystore) for DEK cache
- [ ] Native plugin `LocalAuth` (Face ID / fingerprint) replacing WebAuthn on device
- [ ] Native plugin `CameraQR` faster than `@zxing/browser`
- [ ] App Store + Play Store presence, TestFlight beta gated by `feature_flags.native_beta`

### 11.2 Widget + watch complications `[P1]`
- [ ] iOS Home-screen widget + Apple Watch complication for pinned issuer (Live Activity for 30s countdown)
- [ ] Wear OS tile equivalent

### 11.3 Push authentication `[P2]`
- [ ] APNs / FCM channel + signed challenge from web app
- [ ] Bind to trusted-device list from Phase 9

**Exit criteria:** iOS + Android apps in the stores using the same
zero-knowledge crypto path, TestFlight + Play internal-track
distribution live, widget + complication for the pinned issuer.

---

## Phase 12 — Crypto v2 (`[P1]`, 1 week)

### 12.1 `VAULT_CRYPTO_VERSION = 2` `[P1]`
- [ ] Argon2id (memory 64 MiB, iterations 3, parallelism 1) via `@noble/hashes` for the KDF; salt stays 16 bytes
- [ ] AES-GCM `additionalData` = `utf8(user_id + '|' + account_id)`

### 12.2 Background re-encrypt migrator `[P1]`
- [ ] On first unlock post-upgrade, for every row where `crypto_version < 2`: decrypt v1 → re-encrypt v2 → write back
- [ ] Batched, idempotent, resumable

### 12.3 Migration telemetry `[P1]`
- [ ] Client posts `{ from, to, rows_migrated, elapsed_ms }` to `client_errors` (kind = `info`)

**Exit criteria:** All new vaults are v2. 95% of active vaults migrated
within 30 days. Old v1 code kept in-tree for six months, then removed.

---

## Phase 13 — Sharing, family, teams (`[P2]`, 4 weeks)

### 13.1 Vault sharing (1:1) `[P2]`
- [ ] Recipient's public key (Ed25519 wrapping key) added on account creation
- [ ] Sender rewraps DEK-for-that-account with recipient's public key
- [ ] Revocation deletes wrap row; shared account rotates secret next time owner touches it

### 13.2 Family plan `[P2]`
- [ ] Family group with admin, up to 6 members
- [ ] Family-scoped vault alongside per-user vaults, same crypto path

### 13.3 Billing `[P2]`
- [ ] Stripe subscriptions via payments connector, `family` and `pro` tiers
- [ ] Free tier permanent for single-user vault up to 25 accounts

**Exit criteria:** Two humans can share one credential end-to-end
encrypted, without the server ever seeing plaintext.

---

## Phase 14 — Openness & self-hosting (`[P2]`, 2 weeks)

### 14.1 Open-source client `[P2]`
- [ ] Publish client + shared crypto under Apache 2.0 or MPL 2.0
- [ ] Reproducible build recipe in `docs/reproducible-build.md`

### 14.2 Public API + docs `[P2]`
- [ ] Publish OpenAPI schema for read-only vault ops (personal API token required)
- [ ] Ship `docs/api.md` and a Postman collection

### 14.3 Self-hosted server recipe `[P2]`
- [ ] Docker Compose stack: Postgres + migrations + lightweight edge runtime
- [ ] `docs/self-host.md` walks four env vars, first-boot admin user, RLS CI test

**Exit criteria:** A privacy-forum reader can install a self-hosted
Aegis in under 15 minutes and pass the same RLS test we ship.

---

## Cross-cutting tracks (always on)

### Observability
- [ ] In-app "Report a problem" capturing redacted state → `client_errors`
- [ ] Server-side edge logs shipped to log sink; retention 30 days
- [ ] Real-User Monitoring for LCP, INP, CLS on vault screen

### Performance budget
- [ ] Main JS ≤ 250 KB gzipped, initial CSS ≤ 30 KB, LCP ≤ 2.5s on 3G, INP ≤ 200ms — enforced by `bundlesize` in CI after Phase 6

### Security review cadence
- [ ] Quarterly external pentest, results merged into `SECURITY.md` under Findings
- [ ] `SECURITY.md` coordinated-disclosure inbox opens at GA

### Testing pyramid
- [x] Unit tests for crypto + import parsers
- [x] Component tests for `ScanTab` (Vitest + Testing Library)
- [ ] Component tests for `AccountCard`, `PasteTab`, `AvfPassStage`
- [ ] Playwright end-to-end for onboarding → add → export → restore on second device, in CI on every PR touching `src/routes/**`

### Documentation
- [ ] Every phase ships an update to `docs/architecture.md` (created in Phase 6)
- [ ] Public changelog entry per phase once marketing site exists

---

## Milestones (calendar view)

| Milestone | Phases | Ships | Status |
| --- | --- | --- | --- |
| **GA candidate** | 6, 7, 8 | Installable PWA, dark mode, i18n, WCAG AA, tags + DnD + HOTP | ☐ |
| **GA** | 9, 12 | Security dashboard, crypto v2 migrated | ☐ |
| **Best-in-class web** | 10 | Browser extension autofill | ☐ |
| **Cross-platform parity** | 11 | Native iOS + Android with widget + watch | ☐ |
| **Growth / revenue** | 13 | Sharing, family plan, billing | ☐ |
| **Ecosystem** | 14 | Open source client, self-hosted recipe | ☐ |

At today's velocity (one closed phase per turn) GA lands within one
sprint after Phase 8. Native and sharing are the two multi-week phases;
everything else is sub-two-weeks of engineering.
