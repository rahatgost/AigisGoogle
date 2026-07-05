# Disaster recovery

## Backups

**Point-in-Time Recovery (PITR).** Aegis runs on Lovable Cloud, which
manages the underlying Postgres. PITR configuration lives in the
platform (Cloud → Advanced settings), not in the app repo. Confirm at
each phase transition that PITR is enabled on the production project.

**Full snapshot export.** Lovable Cloud offers a **Data export** action
under Cloud → Advanced settings. Schedule this at the cadence your
compliance target requires; the app itself cannot ship an S3-cron
pipeline because service-role credentials are not exposed to the app
runtime.

**Note on the zero-knowledge property:** even a full DB dump does NOT
compromise vault contents. `vault_accounts.secret_ciphertext` is opaque
AES-GCM ciphertext keyed by a DEK that only lives on the user's
device. A leaked dump = no leaked codes.

## Targets

| Metric | Target |
| --- | --- |
| RPO (Recovery Point Objective) | ≤ 5 minutes (PITR) |
| RTO (Recovery Time Objective) | ≤ 60 minutes |

## Restore drill

Perform quarterly. Log each drill in `admin_audit` as
`action = 'dr_drill'` so we can prove cadence.

Procedure:

1. Provision a scratch project via Lovable Cloud.
2. Restore the most recent snapshot into it.
3. Run `tests/rls/anonymous-cannot-read.spec.mjs` against the restored
   project's URL + publishable key.
4. Sign in as a fresh test user, unlock a seeded vault with a known
   passphrase, verify one canonical TOTP code matches the expected
   RFC 6238 output.
5. Tear the scratch project down.

## What is NOT the app's responsibility

- The app never sees the service role key.
- The app never runs `pg_dump` or ships DB dumps to third-party storage.
- The app cannot toggle PITR from within its own code.

If any of the above must change, it needs a platform-side workflow.
