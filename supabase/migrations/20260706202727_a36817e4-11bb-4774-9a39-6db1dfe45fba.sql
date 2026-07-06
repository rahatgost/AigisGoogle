-- Restrict the new SECURITY DEFINER helpers to service_role only.
REVOKE ALL ON FUNCTION public.log_user_login_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_old_login_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_login_events(integer) TO service_role;