-- Checks for migration 20261124120000_restore_admin_mfa_requirement.sql.
-- Read-only and safe on production: it only sets pretend login details for this
-- transaction and rolls back. Uses the first admin in user_roles.
-- Any failure stops with "FAIL: ..."; the last line says "admin 2FA checks passed".
BEGIN;

DO $$
DECLARE
  v_admin uuid;
  v_other uuid := gen_random_uuid();  -- not in user_roles
  v_moderator uuid;
BEGIN
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role = 'admin' ORDER BY user_id LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'FAIL: no admin in user_roles to test with'; END IF;

  -- (a) admin signed in with password only (aal1): not an admin to the database
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  IF public.is_admin() THEN RAISE EXCEPTION 'FAIL (a): is_admin() true without 2FA'; END IF;
  IF public.has_role(v_admin, 'admin') THEN RAISE EXCEPTION 'FAIL (a): has_role(self, admin) true without 2FA'; END IF;

  -- (b) same admin with the aal claim missing entirely
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  IF public.is_admin() THEN RAISE EXCEPTION 'FAIL (b): is_admin() true with no aal claim'; END IF;
  IF public.has_role(v_admin, 'admin') THEN RAISE EXCEPTION 'FAIL (b): has_role(self, admin) true with no aal claim'; END IF;

  -- (c) admin after entering the 2FA code (aal2): admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'FAIL (c): is_admin() false after 2FA'; END IF;
  IF NOT public.has_role(v_admin, 'admin') THEN RAISE EXCEPTION 'FAIL (c): has_role(self, admin) false after 2FA'; END IF;

  -- (d) non-admin, even with 2FA: never an admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  IF public.is_admin() THEN RAISE EXCEPTION 'FAIL (d): is_admin() true for a non-admin'; END IF;
  IF public.has_role(v_other, 'admin') THEN RAISE EXCEPTION 'FAIL (d): has_role true for a non-admin'; END IF;

  -- (e) backend function with the service key, checking a named admin: still works
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  IF NOT public.has_role(v_admin, 'admin') THEN RAISE EXCEPTION 'FAIL (e): has_role(admin) false for service_role'; END IF;
  IF public.has_role(v_other, 'admin') THEN RAISE EXCEPTION 'FAIL (e): has_role(non-admin) true for service_role'; END IF;

  -- (f) scheduled job / SQL editor (no login details): checking a named admin still works
  PERFORM set_config('request.jwt.claims', '', true);
  IF NOT public.has_role(v_admin, 'admin') THEN RAISE EXCEPTION 'FAIL (f): has_role(admin) false with no session'; END IF;
  IF public.is_admin() THEN RAISE EXCEPTION 'FAIL (f): is_admin() true with no session'; END IF;

  -- (g) a password-only user asking whether someone else is an admin (e.g. showing an
  --     admin badge): unchanged, still answered truthfully
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  IF NOT public.has_role(v_admin, 'admin') THEN RAISE EXCEPTION 'FAIL (g): has_role(other admin) false for aal1 viewer'; END IF;

  -- (h) other roles never need 2FA (only checked if a moderator exists)
  SELECT user_id INTO v_moderator FROM public.user_roles WHERE role = 'moderator' ORDER BY user_id LIMIT 1;
  IF v_moderator IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_moderator, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    IF NOT public.has_role(v_moderator, 'moderator') THEN RAISE EXCEPTION 'FAIL (h): moderator role needs 2FA'; END IF;
  END IF;

  -- (SMS logins: see supabase/tests/admin_sms_login_checks.sql. Owner decision 2026-11-24:
  --  an approved SMS login may view, but money/send/access changes need admin_strong().)
END;
$$;

SELECT 'admin 2FA checks passed' AS result;
ROLLBACK;
