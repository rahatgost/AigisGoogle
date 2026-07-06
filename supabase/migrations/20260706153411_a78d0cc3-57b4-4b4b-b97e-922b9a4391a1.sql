
ALTER TABLE public.vault_accounts
  ADD COLUMN IF NOT EXISTS otp_type text NOT NULL DEFAULT 'totp',
  ADD COLUMN IF NOT EXISTS counter_ciphertext bytea,
  ADD COLUMN IF NOT EXISTS counter_iv bytea;

ALTER TABLE public.vault_accounts
  DROP CONSTRAINT IF EXISTS vault_accounts_otp_type_check;

ALTER TABLE public.vault_accounts
  ADD CONSTRAINT vault_accounts_otp_type_check
  CHECK (otp_type IN ('totp','hotp','steam'));
