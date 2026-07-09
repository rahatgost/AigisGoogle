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

**Progress:** Phase 0–5 complete. **Phase 6 fully shipped** — PWA
manifest, guarded service worker, protocol handler, share target,
install prompt behind `feature_flags.pwa_install_prompt`, encrypted
IndexedDB vault mirror with cache-first paint, delta sync, optimistic
favorite window, focus/visibility invalidation, route-level code
splitting (main entry **60 KB gz**), offline banner + Retry pill,
persistent delete+edit outbox that auto-replays on reconnect, and
scanner UI disabled offline. 67/67 tests green. Next: **Phase 7 —
Vault UX depth II (tags UI, DnD, bulk ops, HOTP/Steam).**

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

### 6.3 Route-level code splitting `[P1]` `[done]`
Baseline biggest chunks (from `perf/baseline.json`):
`@zxing/browser` 1.07 MB · `@tanstack/react-router` 656 KB · `esm` 458 KB
· `index` 450 KB · `vault_.recovery` 419 KB · `jspdf` 477 KB.

- [x] Dynamic-import `@zxing/browser` inside `ScanTab` + importer routes only
- [x] Dynamic-import `jspdf` inside the recovery route only
- [x] Manual chunk-split for the router runtime (also React, Supabase, framer-motion, icons)
- [x] **Exit target:** main entry ≤ 250 KB gzipped — **shipped at 60 KB gzipped** (Lighthouse PWA + 3G LCP measurement pending on-device)

### 6.4 Offline UX affordances `[P1]` `[done]`
- [x] Banner "You're offline — showing cached codes" with Retry pill (surfaces queued-change count on the vault screen)
- [x] Delete + edit queued in a persistent outbox (`src/lib/vault-outbox.ts`) and auto-replayed on reconnect; tag edits keep their dedicated queue
- [x] QR scanning explicitly disabled offline — the scan tab renders a "Scanner unavailable offline" placeholder instead of the camera

**Exit criteria for Phase 6:** Aegis is installable on iOS + Android
home screen, opens with no network, shows cached codes, replays writes
on reconnect. Lighthouse PWA ≥ 90, main bundle ≤ 250 KB gzipped.

---

## Phase 7 — Vault UX depth II (`[P1]`, 1.5 weeks)

**Problem** — competitive-analysis #6. The schema is there; the UI isn't.

### 7.1 Tags UI `[P1]` `[done]`
- [x] Tag chips on `AccountCard` (preset palette in `src/components/vault/tags.tsx`)
- [x] Tag filter bar above the vault list with active-tag pills + clear
- [x] Tag manager sheet (rename, merge, delete) with offline queue via `vault-tag-queue`

### 7.2 Drag-and-drop reorder `[P1]` `[done]`
- [x] `@dnd-kit/core` + `sortable` on the vault list; long-press (220ms) activation preserves tap-to-copy on mobile
- [x] Writes existing `sort_order` column via `reorderAccounts()`; local state + IndexedDB mirror patched optimistically, server batch flushed after 400ms debounce
- [x] Two `SortableContext`s (favorites / others) keep the fav grouping intact; DnD auto-disabled while filtering (query or tag filter) or offline

### 7.3 Bulk operations `[P1]` `[done]`
- [x] "Select" button enters selection mode; each row shows a checkbox overlay and tap toggles instead of copying
- [x] Sticky bulk action bar: count, Select-all, Cancel, Delete, Add tag, Export (only enabled when ≥1 selected)
- [x] Bulk delete (parallel `deleteAccount`, respects offline outbox), bulk add-tag (preset picker, union into each row), bulk export subset to `.avf` via shared `ExportPassphraseSheet`
- [x] DnD auto-disabled while in selection mode so drags never race the checkbox

### 7.4 HOTP + Steam Guard support `[P1]` `[done]`
- [x] Discriminated `otp_type: 'totp' | 'hotp' | 'steam'` on `vault_accounts` + `DecryptedAccount` / `ParsedOtpauth`; `addAccount` accepts the type and coerces Steam's fixed shape (SHA1 · 5 digits · 30s)
- [x] HOTP counter stored in a per-row AES-GCM encrypted column pair (`counter_ciphertext` / `counter_iv`) — server only ever sees ciphertext; `advanceHotpCounter()` re-encrypts and PATCHes on each reveal, with an offline cache patch fallback
- [x] Steam Guard 26-char alphabet + 5-char format via HOTP(digits=10) → divmod mapping; `generateCode` branches by type and stays sync
- [x] Importer parsers accept HOTP + Steam: Google migration proto (type=1 + counter field 7), otpauth:// (HOTP scheme via `OTPAuth.HOTP`), `otpauth://steam/` URIs, Aegis/2FAS JSON, and the encrypted `.avf` export
- [x] Add-account form ships a TOTP/HOTP/Steam picker (with HOTP counter input) and the AccountCard swaps the timer ring for a refresh button when the entry is HOTP

**Exit criteria:** Tags, folders-via-tags, DnD reorder, bulk edit/delete,
HOTP + Steam Guard all in the vault screen without a new route.

---

## Phase 8 — Design system, theming, i18n, a11y (`[P0]` for GA, 2 weeks)

### 8.1 Semantic-token pass `[P0]` `[done]`
- [x] Every hard-coded hex in `chrome.tsx`, `settings.tsx`, and route files migrated to `--aegis-*` CSS variables. New tokens added: `--aegis-success`, `--aegis-warning`, `--aegis-scanner-bg` (with matching `-rgb` triplets and dark-mode overrides). Documented exceptions: Google-brand SVG fills in `chrome.tsx` (brand asset), the recovery-sheet QR foreground/background and its preview tile (printable/scannable backup — intentionally light regardless of app theme), and the initial `<meta name="theme-color">` literal (rewritten dynamically by the pre-hydration script).
- [x] Every component consumes `CREAM`, `CREAM_SOFT`, `CHARCOAL`, `MUTED`, `BORDER`, `DANGER`, `FAV`, `SUCCESS`, `WARNING`, `SCANNER_BG`, and `PLACEHOLDER` from `chrome.tsx`, all of which resolve to `var(--aegis-*)` and flip in dark mode.
- [x] Internal `/dev/tokens` route renders every Aegis token as a swatch card (name + resolved value + note) grouped into Surfaces / Text / Status / Glow / Grain, with a manual Auto / Light / Dark toggle so a reviewer can flip themes without OS changes.

### 8.2 Dark mode `[P0]` `[done]`
- [x] Warm dark palette wired through Aegis CSS variables (`--aegis-cream`, `--aegis-ink`, `--aegis-border`, `--aegis-muted`, `--aegis-danger` + glow tokens) with a `.dark` override block in `src/styles.css`; palette constants in `chrome.tsx` and `Onboarding.tsx` now reference those vars, and every `rgba(28,28,28,X)` / `rgba(180,40,40,X)` was rewritten to `rgb(var(--aegis-ink-rgb) / X)` / `rgb(var(--aegis-danger-rgb) / X)` so downstream files invert automatically
- [x] Manual override in Profile → Appearance (System / Light / Dark rows with active checkmark), syncing to `profiles.theme_pref` and mirrored to `localStorage` for instant re-apply
- [x] `prefers-color-scheme` respected via `subscribeToSystemTheme()`; inline pre-hydration script in `__root.tsx` sets the class + `theme-color` meta before first paint (no light-mode flash)
- [x] Screenshot regression harness scaffolded — Playwright config + `tests/e2e/locale-switch.spec.ts` cover the auth → profile → vault flow with per-step assertions; snapshots are opt-in per route (Playwright's `toHaveScreenshot`) and grow as flows stabilise (documented in `docs/a11y.md`).

### 8.3 Localization `[P1]` `[done]`
- [x] `@lingui/core` + `@lingui/react` wired through a single `i18n` singleton in `src/lib/i18n.ts`; all eight catalogs (en, es, pt-BR, fr, de, ja, hi, bn) statically imported so locale switches are synchronous with no flash of untranslated content. Explicit-id call style (`i18n._("id")` / `<Trans id="…">Default</Trans>`) keeps the managed `vite-tanstack-config` untouched and makes partial catalogs safe — missing ids fall back to the English default at the call site.
- [x] Pre-hydration `LOCALE_INIT_SCRIPT` in `__root.tsx` mirrors the theme boot: reads `localStorage.aegis:locale`, walks `navigator.languages`, and sets `<html lang>` before React mounts.
- [x] Profile → Language sheet in `_tabs/profile.tsx` mirrors the Appearance sheet: rows for System + the eight locales (native name + English label + active check), tap syncs `profiles.locale` (nullable text with `CHECK` constraint) and mirrors to `localStorage`. `syncPrefsFromProfile()` in `__root.tsx` re-applies the saved locale on cross-device sign-in.
- [x] String freeze policy documented in `docs/i18n.md`; enforced in CI by `src/lib/__tests__/i18n-ids.test.ts` (walks every `.ts`/`.tsx` under `src/`, extracts every `i18n._()` / local `t()` / `<Trans id>` call, and fails if any id is missing from the English source catalog or if a sibling locale defines an orphaned key).

### 8.4 Accessibility `[P0]` `[done]`
- [x] Axe-core in CI walking the public route list (`/`, `/auth`, `/auth/reset-password`) via `tests/e2e/a11y-axe.spec.ts` — zero critical or serious violations tolerated; documented rule exceptions (`color-contrast`, `region`) inlined in the test. Run with `bun run test:a11y`. Authenticated flows extend the same harness via `tests/e2e/locale-switch.spec.ts` when a Supabase session is injected.
- [x] Keyboard-only checklist for every flow (onboarding, unlock, add, import, export, change passphrase, delete, locale switch) documented in `docs/a11y.md` with the expected Tab path per flow and the reviewer's release-gate rule ("if the mouse is required, block the release").
- [x] Reduced motion honoured: `ScanTab` scanner sweep now guards its Framer Motion `animate` behind `useReducedMotion()`, matching the existing guards in `Onboarding`, `AccountCard`, `chrome.tsx`, and `auth.callback`; a `@media (prefers-reduced-motion: reduce)` block in `src/styles.css` acts as a global safety net for CSS animations, Tailwind `animate-*` utilities, and any future component that forgets to opt in.

**Exit criteria:** WCAG 2.1 AA clean, dark mode ships, en + 5 locales
in production, no hard-coded colours in `src/components/aegis/*`.


---

## Phase 9 — Security dashboard for the user (`[P1]`, 2 weeks)

### 9.1 Trusted devices `[P1]`
- [x] Table `user_sessions_meta` (server-writable only, admin-audit logged) tracking UA, coarse geo, first-seen, last-seen, current-session flag
- [x] Profile → Security → Devices list with "Sign out this device" revoking Supabase refresh token

### 9.2 Sign-in history `[P1]`
- [x] `user_login_events` row per successful sign-in, 90-day rolling window, admin-audit logged
- [x] Show last 20 to the user


### 9.3 Vault health `[P1]`
- [x] Client-side pass: duplicate secrets (hash decrypted secret in memory), issuers with no icon, favourites with weak issuers
- [x] Optional HIBP lookup for issuer domains (k-anonymity endpoint)

### 9.4 Passphrase strength on change `[P1]`
- [x] Port export passphrase meter to change-passphrase, refuse `zxcvbn score < 3`


**Exit criteria:** A user can see every device signed into their vault,
revoke any of them, see their sign-in history, and get a one-glance
"vault health" score.

---

## Phase 10 — Browser extension (`[P1]`, 2 weeks)

### 10.1 Manifest V3 shell `[P1]`
- [x] Second Vite entry point reusing `vault-crypto`, `vault-accounts`, `biometric` verbatim
- [x] Origin allow-list, minimal host permissions, CSP forbidding remote code

### 10.2 Autofill flow `[P1]`
- [x] Content script detects `<input autocomplete="one-time-code">` + `name~=otp` heuristics
- [x] Offer current code from vault matched by issuer (fuzzy match on domain)
- [x] Copy-to-clipboard fallback with 30s auto-clear

### 10.3 Cross-device push `[P2]`
- [x] WebPush from extension to web app for "approve on this device" flows
- [x] Signed payload + short-lived nonce table

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
- [x] Argon2id (memory 19 MiB, iterations 2, parallelism 1) via `hash-wasm` for the KDF; salt stays 16 bytes. Params tuned for mobile-first PWA (OWASP 2024 memory-constrained profile) — pre-registered as `argon2id-m19456-t2-p1` so future re-tunes bump the algorithm string, not the version.
- [x] AES-GCM `additionalData` = `utf8(user_id + '|' + account_id)` — gated behind per-row `crypto_version = 3`; v2 rows still readable (no AAD) until the migrator upgrades them.

### 12.2 Background re-encrypt migrator `[P1]`
- [x] On first unlock post-upgrade, for every row where `crypto_version < 3`: decrypt v2 (no AAD) → re-encrypt v3 with AAD → write back. Same DEK, only the ciphertext envelope changes.
- [x] Batched (10 rows/round-trip), idempotent, resumable — a mid-migration reload picks up where it left off by re-querying `crypto_version < 3`. Serialized per user via `runV3Migration`'s in-flight guard.

### 12.3 Migration telemetry `[P1]`
- [x] Client posts one `client_errors` row on completion with `route = 'vault-migrator'` and a summary message including `rows_migrated` + `elapsed_ms` (the table has no `kind`/`metadata` columns, so the tag lives in `route`).

**Exit criteria:** All new vaults are v2. 95% of active vaults migrated
within 30 days. Old v1 code kept in-tree for six months, then removed.

---

## Phase 13 — Sharing, family, teams (`[P2]`, 4 weeks)

### 13.1 Vault sharing (1:1) `[P2]`
- [x] Recipient's public key (X25519 wrapping key + Ed25519 signing key) auto-generated on first unlock; private halves AES-GCM'd under the vault DEK in `user_public_keys`. Discovery via rate-limited `find_user_by_email` RPC.
- [x] Sender seals the per-account TOTP secret with ephemeral-static X25519 ECDH → HKDF-SHA256 → AES-GCM (AAD binds owner|recipient|account) into `vault_shares`. Recipient decrypts locally with their X25519 private key.
- [x] Revocation soft-deletes the share row and flags `vault_accounts.needs_rotation = true`; Security tab prompts the owner to re-enroll the secret at the source site (TOTP is one-way — only the site can mint a new secret).

### 13.2 Family plan `[P2]`
- [x] Family group with admin, up to 6 members (enforced by DB trigger); invite-by-email flow with pending/accepted/declined/revoked/expired states and 14-day expiry.
- [x] Family-scoped shared accounts alongside per-user vaults, reusing the 1:1 sharing crypto (ephemeral-static X25519 → HKDF → AES-GCM per member). Admin can share/unshare accounts, remove members (auto-revokes their shares), and sync missing shares when new members join.

### 13.3 Billing `[P2]`
- [ ] Stripe subscriptions via payments connector, `family` and `pro` tiers
- [ ] Free tier permanent for single-user vault up to 25 accounts

**Exit criteria:** Two humans can share one credential end-to-end
encrypted, without the server ever seeing plaintext.

---

## Phase 14 — Openness & self-hosting (`[P2]`, 2 weeks)

### 14.1 Open-source client `[P2]`
- [x] Publish client + shared crypto under Apache 2.0 or MPL 2.0
- [x] Reproducible build recipe in `docs/reproducible-build.md`

### 14.2 Public API + docs `[P2]`
- [x] Publish OpenAPI schema for read-only vault ops (personal API token required)
- [x] Ship `docs/api.md` and a Postman collection

### 14.3 Self-hosted server recipe `[P2]`
- [x] Docker Compose stack: Postgres + migrations + lightweight edge runtime
- [x] `docs/self-host.md` walks four env vars, first-boot admin user, RLS CI test

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
- [x] Integration tests for offline export/restore + cache recovery paths (`src/lib/offline-recovery.test.ts`)
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
