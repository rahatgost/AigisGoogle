REVOKE EXECUTE ON FUNCTION public.reject_emergency_request(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_emergency_request(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fetch_emergency_dek(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_emergency_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_emergency_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_emergency_dek(uuid) TO authenticated;