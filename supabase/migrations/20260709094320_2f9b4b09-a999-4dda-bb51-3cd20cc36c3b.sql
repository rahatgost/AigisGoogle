-- 1. user_public_keys: restrict SELECT to owner. Other users' public keys are
-- exposed via the SECURITY DEFINER function public.find_user_by_email, which
-- returns only public columns after a rate-limit check.
DROP POLICY IF EXISTS "authenticated users can read any user_public_keys" ON public.user_public_keys;
CREATE POLICY "Users can read own user_public_keys"
  ON public.user_public_keys
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 2. profiles: attach the existing prevent_role_self_promotion trigger so
-- users cannot escalate to admin by updating their own row.
DROP TRIGGER IF EXISTS trg_prevent_role_self_promotion ON public.profiles;
CREATE TRIGGER trg_prevent_role_self_promotion
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_role_self_promotion();

-- 3. Revoke EXECUTE from anon (and PUBLIC) on SECURITY DEFINER functions.
-- Authenticated callers retain access.
REVOKE EXECUTE ON FUNCTION public.find_user_by_email(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.purge_old_share_lookup_attempts(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.purge_old_client_errors(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.purge_old_login_events(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.find_user_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_share_lookup_attempts(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_old_client_errors(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_old_login_events(integer) TO service_role;