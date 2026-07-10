
## Family v2 — Emergency Access (phase 2a)

Family tier er "emergency-access" feature currently placeholder — plan matrix e ache, kono real implementation nei. Bitwarden-style trusted contact + waiting-period recovery ke ship kori. Shared household vault (bigger crypto surface) alada phase e rakhbo.

### User story

1. **Grantor** (Family plan user) trusted contact ke email diye invite koren; ekta waiting period (1/3/7/14/30 din) set koren.
2. Contact accept korle, grantor er wrapped DEK contact er X25519 pubkey er jonno seal hoy — server plaintext dekhe na (already `sealForRecipient` ache).
3. **Grantee** emergency access request pathan.
4. Grantor 48h er moddhe reject korte paren, na hole waiting period elapse hole grantee vault read-only unlock korte paren (recovery kit-er moto UI).
5. Grantor jekono somoy revoke korte paren; revoke = row delete + status flip.

### Data model (one migration)

```sql
create type public.emergency_status as enum
  ('invited','active','requested','approved','rejected','revoked');

create table public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  grantor_id uuid not null references auth.users(id) on delete cascade,
  grantee_email text not null,
  grantee_id uuid references auth.users(id) on delete set null,
  status public.emergency_status not null default 'invited',
  wait_days int not null default 7 check (wait_days between 1 and 30),
  -- sealed copy of grantor's DEK for grantee (base64), set on accept
  sealed_dek text,
  sealed_dek_nonce text,
  requested_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (grantor_id, grantee_email)
);
```

+ GRANT block, RLS: grantor read/write own rows; grantee read rows where `grantee_id = auth.uid()`; `approved_at` computed only by security-definer RPC `approve_emergency_request(contact_id)` that enforces wait period.

### Files

**New**
- `supabase/migrations/<ts>_emergency_access.sql` — table, enum, RLS, RPC.
- `src/lib/emergency.ts` — high-level API: `inviteContact`, `listMyContacts`, `listMyGrantors`, `acceptInvite` (seals DEK), `requestAccess`, `rejectRequest`, `revokeContact`, `unlockGrantorVault` (returns decrypted DEK for read-only session).
- `src/lib/emergency.functions.ts` — 2 server fns: `sendEmergencyInviteEmail`, `notifyEmergencyRequest` (uses existing transactional email infra).
- `src/routes/_authenticated/emergency.tsx` — main screen (grantor + grantee tabs).
- `src/components/aegis/emergency-contact-row.tsx` — reusable row.

**Edited**
- `src/routes/_authenticated/family.tsx` — add "Emergency access" section with link to `/emergency` (Family gate reused).
- `src/routes/_authenticated/_tabs/profile.tsx` — surface pending requests badge if any.
- `src/lib/vault-session.ts` — support read-only session initialized from a grantor DEK.
- 8× `src/locales/*/messages.ts` — ~30 new `emergency.*` keys with placeholders (`{name}`, `{days}`, `{date}`).
- `src/lib/__tests__/i18n-critical-keys.test.ts` — add `routes/_authenticated/emergency.tsx` to critical list.

### Gating

- `usePlan().hasFeature("emergency-access")` — Family only. Free/Pro see `<UpgradePrompt feature="emergency-access" />`.
- Server: RLS + `has_role`-style check in the migration's RPC that grantor's subscription tier = `family` (call `has_feature('emergency-access')` inline via subquery on `subscriptions`).

### Crypto invariants

- DEK never leaves grantor's device unencrypted. On accept, grantor client fetches grantee pubkey, seals current DEK, uploads ciphertext.
- On unlock, grantee client downloads sealed DEK, opens locally, hydrates a **read-only** vault session (writes disabled via a session flag).
- If grantor rotates passphrase → all `emergency_contacts` marked `needs_reseal`; next unlock triggers re-seal step.

### Out of scope (later phases)

- Shared household vault (group crypto, dedicated migration).
- Push/email delivery of the actual invite (stubbed — logs to console this phase; wired via Resend in a follow-up).
- Mobile push notifications for requests.

### Verification

- `bunx vitest run vault-sharing.roundtrip` still green (crypto primitives untouched).
- New unit test `src/lib/__tests__/emergency.roundtrip.test.ts` — seal → open → same DEK bytes.
- Manual: two accounts (grantor Family, grantee Free) via preview auth restore; run invite → accept → request → wait override → unlock.

Scope: ~1 migration + 5 new files + 12 edited + 8 locales. One PR-sized change.
