
-- 1. Bound client_errors payload sizes (anon can INSERT for error reporting).
ALTER TABLE public.client_errors
  ADD CONSTRAINT client_errors_message_len CHECK (message IS NULL OR length(message) <= 4096),
  ADD CONSTRAINT client_errors_stack_len CHECK (stack_redacted IS NULL OR length(stack_redacted) <= 8192),
  ADD CONSTRAINT client_errors_ua_len CHECK (user_agent IS NULL OR length(user_agent) <= 512),
  ADD CONSTRAINT client_errors_route_len CHECK (route IS NULL OR length(route) <= 256);

-- 2. Lock down SECURITY DEFINER functions: revoke from anon/PUBLIC, grant only
--    to authenticated where the app calls them as RPCs. Trigger functions and
--    cron/maintenance functions do not need any EXECUTE grants.
REVOKE EXECUTE ON FUNCTION public.fetch_emergency_dek(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.find_user_by_email(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_emergency_request(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_emergency_request(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_family_member_public_keys() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_family_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_family_id(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_active_subscription(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_email() FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.purge_old_server_logs(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_old_client_errors(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_old_login_events(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_old_share_lookup_attempts(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fetch_emergency_dek(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_user_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_emergency_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_emergency_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_family_member_public_keys() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_family_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_family_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_email() TO authenticated;
