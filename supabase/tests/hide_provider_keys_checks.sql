-- Checks for 20261125030000_hide_provider_keys.sql. Read-only (catalog checks, then a read as an
-- admin inside a rolled-back transaction). No error = passed.
BEGIN;
DO $$
DECLARE
  v_admin uuid;
  v_failed boolean := false;
  n int;
BEGIN
  IF has_column_privilege('authenticated', 'public.providers', 'api_key', 'SELECT')
     OR has_column_privilege('authenticated', 'public.providers', 'api_secret', 'SELECT')
     OR has_column_privilege('anon', 'public.providers', 'api_secret', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: signed-in users can read supplier keys';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.providers', 'name', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: admins can no longer read supplier names';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.providers', 'api_key', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL: admins can no longer set a supplier key';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'providers_public'
              AND column_name IN ('api_key', 'api_secret')) THEN
    RAISE EXCEPTION 'FAIL: providers_public includes key columns';
  END IF;
  IF EXISTS (SELECT 1 FROM public.providers WHERE jsonb_typeof(settings) = 'object' AND (settings ? 'client_key' OR settings ? 'secret_key')) THEN
    RAISE EXCEPTION 'FAIL: Korba keys are still kept inside settings';
  END IF;

  -- an admin reads the safe view, but asking for a key column is refused
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role = 'admin' LIMIT 1;
  IF v_admin IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO n FROM public.providers_public;
    BEGIN
      PERFORM api_secret FROM public.providers LIMIT 1;
    EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
    END;
    EXECUTE 'RESET ROLE';
    IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: an admin read api_secret'; END IF;
  END IF;
END $$;
SELECT 'provider key checks passed' AS result;
ROLLBACK;

-- Read-only: which suppliers have keys stored (yes/no only, never the keys)
SELECT name, handler_type, is_active,
       coalesce(api_key, '') <> '' AS has_key, coalesce(api_secret, '') <> '' AS has_secret
FROM public.providers ORDER BY priority NULLS LAST, name;
