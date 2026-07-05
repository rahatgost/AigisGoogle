# Aegis — Competitive Analysis

Last updated: 2026-07-05 · Owner: Product + Engineering

This is a feature-by-feature audit of Aegis against the seven TOTP /
authenticator apps that dominate the market today. It exists to make our
roadmap defensible — every "next feature candidate" in `docs/roadmap.md`
maps back to a gap identified here.

## The comparison set

| App | Model | Sync | E2E | Platforms | Notable |
| --- | --- | --- | --- | --- | --- |
| **Google Authenticator** | Free | Google account | ❌ (opt-in E2E only 2023+) | iOS, Android | Ubiquitous; QR migration is de-facto standard |
| **Microsoft Authenticator** | Free | Microsoft account | ✅ | iOS, Android | Push auth for MS accounts, passwordless |
| **Authy (Twilio)** | Free → shutting down consumer 2024–25 | Phone-number + cloud | ✅ (passphrase) | iOS, Android, desktop | Multi-device, Apple Watch |
| **2FAS** | Free, open-source | iCloud/Drive | ✅ (optional passphrase) | iOS, Android, browser ext. | Browser extension push, open code |
| **Aegis Authenticator** | Free, open-source | ❌ (manual backups) | ✅ (local vault) | Android only | Gold standard for local security & UX |
| **Ente Auth** | Free, open-source | Ente cloud | ✅ (E2E, SRP) | iOS, Android, web, desktop | True zero-knowledge sync, self-hostable |
| **Raivo OTP** | Free, open-source (archived) | iCloud | ✅ | iOS, macOS | Apple Watch, Spotlight, Siri |
| **Bitwarden Authenticator** | Free | Bitwarden vault | ✅ | iOS, Android, web | Integrates with the Bitwarden password manager |
| **1Password** | Paid | 1Password cloud | ✅ (SRP + secret key) | Everywhere | TOTP inside the password manager, autofill |

## Feature matrix

Legend: ✅ shipped · 🟡 partial / behind flag · ❌ not started · N/A not applicable.

| Capability | Aegis (us) | Google | MS | Authy | 2FAS | Aegis Android | Ente | Raivo | Bitwarden | 1Password |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **Core TOTP (SHA1/256/512, 6/8 digit, 30/60s)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| HOTP counter-based | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Steam Guard | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Yubico OTP / hardware tokens | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| **Zero-knowledge E2E encryption** | ✅ (PBKDF2 600k + AES-GCM) | 🟡 opt-in | ✅ | ✅ | ✅ | ✅ (local) | ✅ | ✅ | ✅ | ✅ |
| Passphrase change without re-encrypt of secrets | ✅ (rewrap KEK, DEK unchanged) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Biometric unlock (WebAuthn / Face ID / fingerprint) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Auto-lock timer | ✅ (1/5/15/30 / never) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Recovery kit / master key printable | ✅ | ❌ | ❌ | ✅ | 🟡 | ❌ | ✅ | ❌ | ✅ | ✅ (secret key) |
| **Multi-device sync** | ✅ (Supabase, E2E) | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Web app / PWA | ✅ | ❌ | ❌ | ✅ (desktop) | ✅ (ext.) | ❌ | ✅ | ❌ | ✅ | ✅ |
| Native iOS app | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Native Android app | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Apple Watch / Wear OS companion | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Home-screen widget | ❌ | ❌ | ❌ | ❌ | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ |
| Browser extension autofill | ❌ | ❌ | ❌ | ❌ | ✅ (push) | ❌ | ❌ | ❌ | ✅ | ✅ |
| Push authentication ("approve on phone") | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **QR scan (camera)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| QR-from-image (screenshot upload) | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Google Authenticator `otpauth-migration://` | ✅ | N/A | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Aegis JSON import | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| 2FAS JSON import | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Own encrypted backup format | ✅ (`.avf`) | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Search** | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Favorites / pinning | ✅ (server-synced) | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Tags | ✅ (schema in place) | ❌ | ❌ | ❌ | ❌ | ✅ (groups) | ✅ | ❌ | ✅ (folders) | ✅ |
| Folders / groups (UI) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Custom icons / branded issuer icons | 🟡 (logo.dev) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Copy-and-clear clipboard | ✅ (30s) | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reorder (drag-and-drop) | 🟡 (`sort_order` col) | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Bulk delete / bulk edit | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **Offline (works with no network)** | 🟡 (SW cache missing) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Passkeys / FIDO2 login to the app itself | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Password-manager integration | ❌ | ❌ | ❌ | ❌ | ✅ (Bitwarden) | ❌ | ❌ | ❌ | ✅ (native) | ✅ (native) |
| **Localization (i18n)** | ❌ | ✅ 50+ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ |
| Accessibility (WCAG 2.1 AA) | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dark mode | 🟡 (cream theme only) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Delete account** | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ✅ | ✅ | ✅ |
| Session / trusted-device list | ❌ | ✅ | ✅ | ✅ | ❌ | N/A | ✅ | ❌ | ✅ | ✅ |
| Security audit log for the user | ❌ | ✅ | ✅ | ❌ | ❌ | N/A | ❌ | ❌ | ✅ | ✅ |
| Weak / duplicate / breached secret detection | ❌ | ❌ | 🟡 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (Watchtower) |
| **Team / family / sharing** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (families) | ❌ | ✅ | ✅ |
| Enterprise SSO / SCIM | ❌ | 🟡 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Self-hostable server | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ✅ | ❌ | ✅ | ❌ |
| Open source client | 🟡 (private repo) | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ (archived) | ✅ | ❌ |

## Where Aegis already wins

1. **Zero-knowledge sync in a browser tab.** No competitor except Ente
   ships true E2E sync with a pure-web experience. Google's opt-in E2E
   is only in the mobile app and defaults off; Microsoft's requires the
   MS account. Ours is on by construction — the server literally cannot
   read the codes.
2. **Import breadth without leaving the browser.** Google Authenticator
   migration URIs, Aegis JSON, 2FAS JSON, plain `otpauth://` links,
   QR-from-screenshot, and our own `.avf` all land in one flow with a
   per-row preview + checkbox stage. Only Ente comes close.
3. **Encrypted personal backup (`.avf`).** Passphrase-independent from
   the vault passphrase, PBKDF2-SHA256-600k + AES-GCM, RFC 6238 golden
   vectors green. Bitwarden ships an encrypted export too, but few
   others do at all.
4. **Recovery kit + biometric + auto-lock triad.** Every top-tier
   competitor ships all three; we already do too. This is table stakes
   we've cleared.
5. **Backend posture.** RLS on every user table, admin-audit trail,
   strict CSP + HSTS + Permissions-Policy, per-user insert rate limit,
   append-only audit table. Ente is the only comparable competitor with
   this level of disclosed hardening.

## Where the gap is real

Ordered by impact on acquisition and retention (not by effort):

1. **No native mobile app or PWA install.** Google, Microsoft, Authy,
   2FAS, Ente, Bitwarden, 1Password are all installed-app-first. A web
   authenticator is a real handicap on iOS in particular (Safari
   throttles background timers, camera prompt is uglier, no home-screen
   widget).
2. **No offline story.** The service worker isn't wired, so a code you
   already synced can't be shown on the subway. This is the single
   biggest daily-use complaint any web-first authenticator gets.
3. **No HOTP / Steam Guard.** Blocks power users and Steam gamers from
   migrating entirely — they still need a second app on the side.
4. **No push auth ("approve on phone").** Microsoft and Authy both use
   this for their killer flows. We can't ship it without a native app,
   so it goes with the mobile phase.
5. **No browser-extension autofill.** 2FAS, Bitwarden, and 1Password
   all send the current code straight into the login form. Users who
   try it never go back.
6. **No tags/folders UI.** We already have the `tags text[]` column and
   a `sort_order` column — the schema shipped in Phase 1.1. There is
   just no UI on top yet.
7. **No dark mode / localization / accessibility polish.** Cream-only
   theme reads as design opinion today; at scale it becomes an
   accessibility complaint. WCAG 2.1 AA and 6–10 locales are the price
   of admission for anything above 100k MAU.
8. **No security dashboard for the user.** Trusted-device list, sign-in
   history, weak-secret detection, breach lookups. Bitwarden and
   1Password print money off this surface.
9. **No sharing / family / team.** Ente Families, 1Password Families,
   Bitwarden Organizations. This is where the revenue is.
10. **No self-hosted or open-source posture.** Ente and Bitwarden win
    every privacy-forum thread because you can run their server. We
    should at minimum publish the client under a permissive licence.

## What we intentionally will not chase

- **Yubico OTP** — hardware-token OTP is a fading niche outside of
  Yubico's own ecosystem.
- **SMS / call-based 2FA** — insecure by design (SIM swap).
- **Being a full password manager** — that's a different product;
  integrate with them instead.
- **Enterprise SSO/SCIM in year one** — different sales motion, gated
  behind mobile + audit surface being real first.

The roadmap in `docs/roadmap.md` turns each gap above into a scoped
phase with an exit criterion.
