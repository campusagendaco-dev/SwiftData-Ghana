-- Checks for migration 20261124130000_admin_security_2fa_report.sql.
-- LOCAL ONLY (PGlite with stub tables): it creates a stub table and policies. Do NOT run on
-- production. Any failure raises "FAIL (x)"; the last line says the checks passed.
-- Check (d) runs when the setting test.expect_2fa is 'true' or 'false' (set by the runner).
BEGIN;

CREATE TABLE public.stub_t (id int);
ALTER TABLE public.stub_t ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read (inline)" ON public.stub_t FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins read (fn)" ON public.stub_t FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY "Admins read (has_role)" ON public.stub_t FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- functions: one with its own inline admin check (listed), one using is_admin() (not listed),
-- one with an inline check that only the service key may run (not listed)
CREATE FUNCTION public.stub_inline_admin() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'no';
  END IF;
END $f$;
GRANT EXECUTE ON FUNCTION public.stub_inline_admin() TO authenticated;
CREATE FUNCTION public.stub_uses_is_admin() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'no'; END IF;
END $f$;
CREATE FUNCTION public.stub_service_only(p uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p AND role = 'admin') THEN
    RAISE EXCEPTION 'no';
  END IF;
END $f$;
REVOKE ALL ON FUNCTION public.stub_service_only(uuid) FROM PUBLIC;

DO $$
DECLARE
  v_admin uuid;
  v_other uuid := gen_random_uuid();
  v_res jsonb;
  v_expect text := current_setting('test.expect_2fa', true);
BEGIN
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role = 'admin' LIMIT 1;

  -- (a) admin without 2FA is refused
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  BEGIN
    PERFORM public.admin_security_2fa_report();
    RAISE EXCEPTION 'FAIL (a): report ran for an admin without 2FA';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- (b) non-admin with 2FA is refused
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  BEGIN
    PERFORM public.admin_security_2fa_report();
    RAISE EXCEPTION 'FAIL (b): report ran for a non-admin';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- (c) admin with 2FA gets the report; only the policy with its own admin check is listed
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_res := public.admin_security_2fa_report();
  IF NOT (v_res->'policies') @> '[{"table":"public.stub_t","policy":"Admins read (inline)","command":"SELECT"}]'::jsonb THEN
    RAISE EXCEPTION 'FAIL (c): inline admin policy not listed: %', v_res;
  END IF;
  IF (v_res->'policies') @> '[{"policy":"Admins read (fn)"}]'::jsonb
     OR (v_res->'policies') @> '[{"policy":"Admins read (has_role)"}]'::jsonb THEN
    RAISE EXCEPTION 'FAIL (c): policy using is_admin()/has_role() listed: %', v_res;
  END IF;

  -- (e) only the callable function with its own admin check is listed
  IF NOT coalesce(v_res->'functions', '[]'::jsonb) @> '[{"function":"public.stub_inline_admin()"}]'::jsonb THEN
    RAISE EXCEPTION 'FAIL (e): inline admin function not listed: %', v_res->'functions';
  END IF;
  IF (v_res->'functions') @> '[{"function":"public.stub_uses_is_admin()"}]'::jsonb
     OR (v_res->'functions') @> '[{"function":"public.stub_service_only(p uuid)"}]'::jsonb
     OR (v_res->'functions') @> '[{"function":"public.admin_security_2fa_report()"}]'::jsonb THEN
    RAISE EXCEPTION 'FAIL (e): function listed that should not be: %', v_res->'functions';
  END IF;

  -- (d) the 2FA flags match whether the restore migration was applied
  IF v_expect IN ('true', 'false') THEN
    IF (v_res->>'is_admin_requires_2fa') <> v_expect OR (v_res->>'has_role_requires_2fa') <> v_expect THEN
      RAISE EXCEPTION 'FAIL (d): expected requires_2fa = %, got %', v_expect, v_res;
    END IF;
  END IF;
END;
$$;

SELECT 'admin security report checks passed' AS result;
ROLLBACK;
