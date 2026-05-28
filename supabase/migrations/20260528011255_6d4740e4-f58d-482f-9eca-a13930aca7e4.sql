
REVOKE EXECUTE ON FUNCTION public.is_presentation_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_presentation_owner(uuid) TO authenticated, service_role;
