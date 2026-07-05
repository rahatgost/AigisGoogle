
-- Phase 1.1: profiles.role + is_admin helper + self-promotion guard
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'admin'));

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.prevent_role_self_promotion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Only allow role changes from service_role connections (admin tooling).
    IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Role changes must be performed by service role only';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_role_self_promotion_trg ON public.profiles;
CREATE TRIGGER prevent_role_self_promotion_trg
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_self_promotion();

-- Phase 1.1: client_errors table
CREATE TABLE IF NOT EXISTS public.client_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  message text NOT NULL,
  stack_redacted text,
  route text,
  user_agent text,
  at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.client_errors TO anon, authenticated;
GRANT SELECT ON public.client_errors TO authenticated;
GRANT ALL ON public.client_errors TO service_role;

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can log a client error"
  ON public.client_errors FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can view client errors"
  ON public.client_errors FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS client_errors_at_idx ON public.client_errors (at DESC);

CREATE OR REPLACE FUNCTION public.purge_old_client_errors(days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM public.client_errors WHERE at < now() - make_interval(days => days);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

-- Phase 1.1: admin_audit (append-only)
CREATE TABLE IF NOT EXISTS public.admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action text NOT NULL,
  target text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.admin_audit TO authenticated;
GRANT INSERT ON public.admin_audit TO service_role;
-- Explicitly REVOKE update/delete even from service_role to keep it append-only.
REVOKE UPDATE, DELETE ON public.admin_audit FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit log"
  ON public.admin_audit FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS admin_audit_at_idx ON public.admin_audit (at DESC);

-- Phase 1.1: defensive size caps on vault_accounts
ALTER TABLE public.vault_accounts
  ADD CONSTRAINT vault_accounts_secret_ciphertext_size_chk
    CHECK (octet_length(secret_ciphertext) <= 512),
  ADD CONSTRAINT vault_accounts_secret_iv_size_chk
    CHECK (octet_length(secret_iv) = 12),
  ADD CONSTRAINT vault_accounts_issuer_length_chk
    CHECK (char_length(issuer) <= 200),
  ADD CONSTRAINT vault_accounts_label_length_chk
    CHECK (char_length(label) <= 200),
  ADD CONSTRAINT vault_accounts_icon_slug_length_chk
    CHECK (icon_slug IS NULL OR char_length(icon_slug) <= 100);

-- Cap each user at 500 accounts.
CREATE OR REPLACE FUNCTION public.enforce_vault_accounts_per_user_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt integer;
BEGIN
  SELECT count(*) INTO cnt FROM public.vault_accounts WHERE user_id = NEW.user_id;
  IF cnt >= 500 THEN
    RAISE EXCEPTION 'Vault account limit reached (500 per user).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_vault_accounts_per_user_limit_trg ON public.vault_accounts;
CREATE TRIGGER enforce_vault_accounts_per_user_limit_trg
  BEFORE INSERT ON public.vault_accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_vault_accounts_per_user_limit();
