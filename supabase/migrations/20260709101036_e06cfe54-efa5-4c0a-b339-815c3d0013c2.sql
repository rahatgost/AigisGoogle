-- =========================================================================
-- FAMILIES
-- =========================================================================
CREATE TABLE public.families (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.families TO authenticated;
GRANT ALL ON public.families TO service_role;

ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- FAMILY MEMBERS  (one row per user; a user can be in only ONE family)
-- =========================================================================
CREATE TYPE public.family_role AS ENUM ('admin', 'member');

CREATE TABLE public.family_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role public.family_role NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX family_members_family_id_idx ON public.family_members(family_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_members TO authenticated;
GRANT ALL ON public.family_members TO service_role;

ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- HELPER FUNCTIONS  (SECURITY DEFINER; safe RLS helpers)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.get_user_family_id(_user_id UUID DEFAULT auth.uid())
RETURNS UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT family_id FROM public.family_members WHERE user_id = _user_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_family_admin(_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE user_id = _user_id AND role = 'admin'
  )
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_family_id(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_family_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_family_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_family_admin(UUID) TO authenticated;

-- =========================================================================
-- FAMILIES POLICIES
-- =========================================================================
CREATE POLICY "Members can view their family"
  ON public.families FOR SELECT TO authenticated
  USING (id = public.get_user_family_id(auth.uid()));

CREATE POLICY "Users can create a family (as admin)"
  ON public.families FOR INSERT TO authenticated
  WITH CHECK (admin_user_id = auth.uid());

CREATE POLICY "Only admin can update family"
  ON public.families FOR UPDATE TO authenticated
  USING (admin_user_id = auth.uid())
  WITH CHECK (admin_user_id = auth.uid());

CREATE POLICY "Only admin can delete family"
  ON public.families FOR DELETE TO authenticated
  USING (admin_user_id = auth.uid());

-- =========================================================================
-- FAMILY MEMBERS POLICIES
-- =========================================================================
CREATE POLICY "Members can view co-members"
  ON public.family_members FOR SELECT TO authenticated
  USING (family_id = public.get_user_family_id(auth.uid()));

CREATE POLICY "Admin creates admin row on family creation"
  ON public.family_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.families f WHERE f.id = family_id AND f.admin_user_id = auth.uid())
  );

CREATE POLICY "Users can leave (delete own row)"
  ON public.family_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admin can remove members"
  ON public.family_members FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.families f
      WHERE f.id = family_members.family_id AND f.admin_user_id = auth.uid()
    )
    AND user_id <> auth.uid()
  );

-- Prevent admin from deleting their own membership without transferring ownership.
CREATE OR REPLACE FUNCTION public.prevent_family_admin_self_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fam_admin UUID;
BEGIN
  SELECT admin_user_id INTO fam_admin FROM public.families WHERE id = OLD.family_id;
  IF fam_admin = OLD.user_id THEN
    RAISE EXCEPTION 'Family admin cannot leave; delete the family or transfer ownership first.';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER family_members_prevent_admin_self_removal
  BEFORE DELETE ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_family_admin_self_removal();

-- Enforce 6-member cap.
CREATE OR REPLACE FUNCTION public.enforce_family_member_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt INT;
BEGIN
  SELECT count(*) INTO cnt FROM public.family_members WHERE family_id = NEW.family_id;
  IF cnt >= 6 THEN
    RAISE EXCEPTION 'Family is full (6 members maximum).';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER family_members_enforce_cap
  BEFORE INSERT ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_family_member_cap();

-- =========================================================================
-- FAMILY INVITES
-- =========================================================================
CREATE TYPE public.family_invite_status AS ENUM ('pending','accepted','declined','revoked','expired');

CREATE TABLE public.family_invites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status public.family_invite_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX family_invites_unique_pending
  ON public.family_invites(family_id, lower(email))
  WHERE status = 'pending';

CREATE INDEX family_invites_email_idx ON public.family_invites(lower(email));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_invites TO authenticated;
GRANT ALL ON public.family_invites TO service_role;

ALTER TABLE public.family_invites ENABLE ROW LEVEL SECURITY;

-- Helper: current user's email (SECURITY DEFINER; reads auth.users).
CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS TEXT
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(email) FROM auth.users WHERE id = auth.uid()
$$;
REVOKE EXECUTE ON FUNCTION public.current_user_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_email() TO authenticated;

CREATE POLICY "Admin sees invites for their family"
  ON public.family_invites FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.families f WHERE f.id = family_id AND f.admin_user_id = auth.uid())
  );

CREATE POLICY "Invitee sees invites addressed to them"
  ON public.family_invites FOR SELECT TO authenticated
  USING (lower(email) = public.current_user_email());

CREATE POLICY "Admin can create invites"
  ON public.family_invites FOR INSERT TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.families f WHERE f.id = family_id AND f.admin_user_id = auth.uid())
  );

CREATE POLICY "Admin can update invites (revoke)"
  ON public.family_invites FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.families f WHERE f.id = family_id AND f.admin_user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.families f WHERE f.id = family_id AND f.admin_user_id = auth.uid())
  );

CREATE POLICY "Invitee can update their invite (accept/decline)"
  ON public.family_invites FOR UPDATE TO authenticated
  USING (lower(email) = public.current_user_email())
  WITH CHECK (lower(email) = public.current_user_email());

CREATE POLICY "Admin can delete invites"
  ON public.family_invites FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.families f WHERE f.id = family_id AND f.admin_user_id = auth.uid())
  );

-- =========================================================================
-- FAMILY SHARED ACCOUNTS  (which accounts the admin has shared with the family)
-- Actual encrypted share rows still live in vault_shares (one per member).
-- =========================================================================
CREATE TABLE public.family_shared_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.vault_accounts(id) ON DELETE CASCADE,
  shared_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, account_id)
);

CREATE INDEX family_shared_accounts_family_idx ON public.family_shared_accounts(family_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_shared_accounts TO authenticated;
GRANT ALL ON public.family_shared_accounts TO service_role;

ALTER TABLE public.family_shared_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family members can view family-shared accounts"
  ON public.family_shared_accounts FOR SELECT TO authenticated
  USING (family_id = public.get_user_family_id(auth.uid()));

CREATE POLICY "Admin can add family-shared accounts"
  ON public.family_shared_accounts FOR INSERT TO authenticated
  WITH CHECK (
    shared_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.families f WHERE f.id = family_id AND f.admin_user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.vault_accounts a WHERE a.id = account_id AND a.user_id = auth.uid())
  );

CREATE POLICY "Admin can remove family-shared accounts"
  ON public.family_shared_accounts FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.families f WHERE f.id = family_id AND f.admin_user_id = auth.uid())
  );

-- =========================================================================
-- updated_at triggers
-- =========================================================================
CREATE TRIGGER update_families_updated_at
  BEFORE UPDATE ON public.families
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_family_members_updated_at
  BEFORE UPDATE ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_family_invites_updated_at
  BEFORE UPDATE ON public.family_invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_family_shared_accounts_updated_at
  BEFORE UPDATE ON public.family_shared_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();