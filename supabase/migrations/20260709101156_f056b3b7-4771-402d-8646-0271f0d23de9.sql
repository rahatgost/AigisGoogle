CREATE OR REPLACE FUNCTION public.get_family_member_public_keys()
RETURNS TABLE(user_id UUID, x25519_public_key BYTEA, ed25519_public_key BYTEA, email TEXT)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller UUID;
  fam UUID;
BEGIN
  caller := auth.uid();
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT family_id INTO fam FROM public.family_members WHERE user_id = caller LIMIT 1;
  IF fam IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT k.user_id, k.x25519_public_key, k.ed25519_public_key, lower(u.email)::text AS email
      FROM public.family_members fm
      JOIN public.user_public_keys k ON k.user_id = fm.user_id
      LEFT JOIN auth.users u ON u.id = fm.user_id
     WHERE fm.family_id = fam;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_family_member_public_keys() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_family_member_public_keys() TO authenticated;