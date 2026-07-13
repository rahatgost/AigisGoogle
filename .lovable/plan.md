# Local-only guest mode

## Goal

New user app khulle direct onboarding → vault-e jabe, kono signin dorkar hobe na. Vault-e TOTP add/scan/copy — sob local encrypted storage-e kaj korbe. Profile page-e cloud-dependent features (Backup, Sync, Family, Devices, Emergency, Sharing, Extension pairing, Push) lock icon niye "Sign in to unlock" CTA dekhabe. Sign in korle sob unlock hobe automatic.

## Approach

Guest mode = local-only user identity (`guest-<uuid>` in localStorage). Vault crypto, IndexedDB cache, PIN/passphrase — sob already local, just need to bypass Supabase gates.

### Routing changes

- `src/routes/_authenticated/route.tsx` — no longer redirect to `/auth` when session missing. Instead synthesize a guest user object `{ id: guestId, email: null, isGuest: true }` and put in context.
- `src/routes/index.tsx` — remove auth check; go to `/onboarding` if not onboarded, else `/vault`.
- `/auth` route stays as an opt-in surface (from Profile "Sign in" button).

### Vault path (already local)

- `vault_accounts` writes: skip Supabase, keep only IndexedDB cache (`vault-cache.ts`) + outbox for later sync.
- `vault_meta`: local-only during guest mode.
- Passphrase / PIN / auto-unlock: unchanged (all localStorage).

### Profile page gating

Add `isGuest` flag from route context. Wrap each cloud section with a `<LockedSection>` that:
- Guest: renders section title + lock icon + "Sign in to unlock" button → navigate `/auth`.
- Signed in: renders the real section.

Sections to gate: Cloud Backup, Sync/Devices, Family, Emergency contacts, Sharing, Extension pairing, Push notifications, Sign-in history, Subscription/Plan.

Sections that stay available for guest: Language, Theme, Auto-lock, Hide codes, PIN, Passphrase, Auto-unlock, Export (local .avf), Import, Delete local vault.

### Sign-in migration

When guest signs in via `/auth`, on success:
1. Detect existing local vault under `guest-<id>`.
2. Re-key local IndexedDB entries under the new `user.id` (rename keys).
3. Push queued outbox writes to Supabase.
4. Continue to `/vault`.

## Files to touch

- `src/routes/_authenticated/route.tsx` — guest user synthesis
- `src/routes/index.tsx` — remove auth redirect
- `src/lib/guest-user.ts` (new) — guestId persistence + migration helper
- `src/routes/_authenticated/_tabs/profile.tsx` — wrap cloud sections in `<LockedSection>`
- `src/components/aegis/LockedSection.tsx` (new) — reusable lock overlay
- `src/lib/vault-accounts.ts` — skip Supabase writes when `isGuest`
- `src/lib/vault-sync.ts` / outbox — no-op when guest
- `src/routes/auth.tsx` — after signin, call `migrateGuestToUser()` before redirect
- i18n strings for "Sign in to unlock" etc.

## Out of scope (guest cannot use)

Family, Emergency, Sharing, Devices, Cloud backup, Push, Extension pairing, Plan/Subscription — all show lock. Explicitly no data leaves the device in guest mode.

## Risks

- Big blast radius: touching auth gate breaks every protected route if wrong.
- Existing signed-in users must not regress — guest logic only kicks in when no session.
- Sync/outbox already assumes user_id; needs careful null-guard.

## Estimated scope

~10 files, ~400 lines. One iteration, then verify: guest onboarding → add account → copy code → open Profile → confirm locked sections show CTA.

Approve korle build shuru kori.
