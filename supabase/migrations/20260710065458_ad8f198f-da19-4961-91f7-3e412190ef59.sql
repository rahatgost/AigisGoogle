
-- Emergency Access status enum
DO $$ BEGIN
  CREATE TYPE public.emergency_status AS ENUM ('active','requested','approved','revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Table
CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grantor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grantee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grantee_email text NOT NULL,
  status public.emergency_status NOT NULL DEFAULT 'active',
  wait_days integer NOT NULL DEFAULT 7 CHECK (wait_days BETWEEN 1 AND 30),
  -- Sealed DEK payload (grantor's DEK sealed for grantee's X25519 pubkey)
  sealed_dek bytea NOT NULL,
  sealed_dek_iv bytea NOT NULL,
  sealed_dek_ephemeral_pub bytea NOT NULL,
  requested_at timestamptz,
  approved_at timestamptz,
  needs_reseal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT emergency_contacts_unique_pair UNIQUE (grantor_id, grantee_id),
  CONSTRAINT emergency_contacts_no_self CHECK (grantor_id <> grantee_id)
);

CREATE INDEX IF NOT EXISTS emergency_contacts_grantee_idx ON public.emergency_contacts(grantee_id);
CREATE INDEX IF NOT EXISTS emergency_contacts_grantor_idx ON public.emergency_contacts(grantor_id);

-- GRANTs — column-scoped: sealed_dek columns are readable only via the
-- SECURITY DEFINER function fetch_emergency_dek(), never via the Data API.
GRANT SELECT (
  id, grantor_id, grantee_id, grantee_email, status, wait_days,
  requested_at, approved_at, needs_reseal, created_at, updated_at
) ON public.emergency_contacts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.emergency_contacts TO authenticated;
GRANT ALL ON public.emergency_contacts TO service_role;

-- RLS
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;

-- Grantor: full access to their own contacts. Family-plan gating enforced.
CREATE POLICY "Grantor manages their emergency contacts"
  ON public.emergency_contacts FOR ALL
  TO authenticated
  USING (auth.uid() = grantor_id)
  WITH CHECK (
    auth.uid() = grantor_id
    AND EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.user_id = auth.uid()
        AND s.tier = 'family'
        AND s.status IN ('active','trialing')
        AND (s.current_period_end IS NULL OR s.current_period_end > now())
    )
  );

-- Grantee: read own row (metadata columns only via column-scoped GRANT).
CREATE POLICY "Grantee reads their emergency invitations"
  ON public.emergency_contacts FOR SELECT
  TO authenticated
  USING (auth.uid() = grantee_id);

-- Grantee: request access — only transition allowed for grantee is
-- status active -> requested (with requested_at set to now()).
CREATE POLICY "Grantee requests emergency access"
  ON public.emergency_contacts FOR UPDATE
  TO authenticated
  USING (auth.uid() = grantee_id AND status = 'active')
  WITH CHECK (auth.uid() = grantee_id AND status = 'requested');

-- Updated-at trigger
DROP TRIGGER IF EXISTS trg_emergency_contacts_updated_at ON public.emergency_contacts;
CREATE TRIGGER trg_emergency_contacts_updated_at
  BEFORE UPDATE ON public.emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Secure fetch: only the grantee can call, and only when (a) grantor
-- has explicitly approved, or (b) the request has aged past wait_days.
CREATE OR REPLACE FUNCTION public.fetch_emergency_dek(_contact_id uuid)
RETURNS TABLE (
  sealed_dek bytea,
  sealed_dek_iv bytea,
  sealed_dek_ephemeral_pub bytea,
  grantor_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.emergency_contacts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO row FROM public.emergency_contacts WHERE id = _contact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = 'P0002';
  END IF;

  IF row.grantee_id <> auth.uid() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF row.status = 'revoked' THEN
    RAISE EXCEPTION 'Access has been revoked' USING ERRCODE = 'P0001';
  END IF;

  IF row.status = 'approved' THEN
    -- allowed
    NULL;
  ELSIF row.status = 'requested'
     AND row.requested_at IS NOT NULL
     AND now() >= row.requested_at + make_interval(days => row.wait_days) THEN
    -- Auto-approve on wait elapse
    UPDATE public.emergency_contacts
       SET status = 'approved', approved_at = now()
     WHERE id = _contact_id;
  ELSE
    RAISE EXCEPTION 'Emergency access not yet available' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    SELECT c.sealed_dek, c.sealed_dek_iv, c.sealed_dek_ephemeral_pub, c.grantor_id
      FROM public.emergency_contacts c WHERE c.id = _contact_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fetch_emergency_dek(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fetch_emergency_dek(uuid) TO authenticated;

-- Grantor approves an outstanding request early
CREATE OR REPLACE FUNCTION public.approve_emergency_request(_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  UPDATE public.emergency_contacts
     SET status = 'approved', approved_at = now()
   WHERE id = _contact_id
     AND grantor_id = auth.uid()
     AND status = 'requested';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending request to approve' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_emergency_request(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_emergency_request(uuid) TO authenticated;

-- Grantor rejects a pending request (back to active)
CREATE OR REPLACE FUNCTION public.reject_emergency_request(_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  UPDATE public.emergency_contacts
     SET status = 'active', requested_at = NULL, approved_at = NULL
   WHERE id = _contact_id
     AND grantor_id = auth.uid()
     AND status IN ('requested','approved');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No request to reject' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_emergency_request(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reject_emergency_request(uuid) TO authenticated;
