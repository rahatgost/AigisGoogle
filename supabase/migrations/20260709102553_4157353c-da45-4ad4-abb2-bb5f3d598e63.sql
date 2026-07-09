
-- 1) Prevent role self-promotion at the privilege layer: revoke UPDATE on the
--    role column so authenticated users cannot include it in an UPDATE at all.
--    Grant column-level UPDATE on all other user-editable columns.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (
  display_name,
  avatar_url,
  onboarded_at,
  auto_lock_pref,
  hide_codes_pref,
  theme_pref,
  locale
) ON public.profiles TO authenticated;

-- 2) Revoke public EXECUTE on trigger-only SECURITY DEFINER functions.
--    Trigger functions are invoked by the trigger machinery and never need
--    to be callable directly by anon or authenticated.
REVOKE EXECUTE ON FUNCTION public.enforce_family_member_cap() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_family_admin_self_removal() FROM PUBLIC, anon, authenticated;
