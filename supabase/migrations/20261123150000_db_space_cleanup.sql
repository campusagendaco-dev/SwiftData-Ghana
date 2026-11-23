-- Database space cleanup: nightly retention for log/history tables, plus admin RPCs for the
-- admin "Database Space" page. Apply by pasting this file into the Supabase SQL editor
-- (never `supabase db push`). Safe to run more than once.
--
-- Only these tables are ever cleaned (owner-approved periods, 2026-11-23):
--   cron.job_run_details         runs older than 7 days
--   public.system_logs           older than 30 days
--   public.push_notification_logs older than 30 days
--   public.sms_logs              older than 90 days
--   public.security_logs         older than 90 days
--   public.user_notifications    READ and older than 60 days (unread are never deleted)
-- Orders, payments, wallets and profiles are never touched.

-- ── Run log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.db_cleanup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  source text NOT NULL CHECK (source IN ('nightly', 'manual')),
  triggered_by uuid,
  deleted jsonb NOT NULL DEFAULT '{}'::jsonb,
  more_remaining boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_db_cleanup_runs_started ON public.db_cleanup_runs (started_at DESC);

ALTER TABLE public.db_cleanup_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.db_cleanup_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.db_cleanup_runs TO authenticated;
GRANT ALL ON public.db_cleanup_runs TO service_role;
DROP POLICY IF EXISTS "db_cleanup_runs_admin_read" ON public.db_cleanup_runs;
CREATE POLICY "db_cleanup_runs_admin_read" ON public.db_cleanup_runs
  FOR SELECT TO authenticated USING (public.is_admin());

-- ── The rules (display) ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._db_retention_rules()
RETURNS TABLE (target text, label text, keep_days int, rule text)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  VALUES
    ('cron.job_run_details'::text, 'Scheduled job history'::text, 7, 'Runs older than 7 days'::text),
    ('public.system_logs', 'System logs', 30, 'Older than 30 days'),
    ('public.push_notification_logs', 'Push notification logs', 30, 'Older than 30 days'),
    ('public.sms_logs', 'SMS logs', 90, 'Older than 90 days'),
    ('public.security_logs', 'Security logs', 90, 'Older than 90 days'),
    ('public.user_notifications', 'Customer notifications', 60, 'Read, and older than 60 days')
$$;

-- ── One batch of deletes for one table (fixed SQL per table, no dynamic SQL) ──
CREATE OR REPLACE FUNCTION public._db_retention_delete_batch(p_target text, p_batch int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int := 0;
BEGIN
  IF p_target = 'cron.job_run_details' THEN
    DELETE FROM cron.job_run_details WHERE ctid = ANY (ARRAY(
      SELECT ctid FROM cron.job_run_details WHERE start_time < now() - interval '7 days' LIMIT p_batch));
  ELSIF p_target = 'public.system_logs' THEN
    DELETE FROM public.system_logs WHERE ctid = ANY (ARRAY(
      SELECT ctid FROM public.system_logs WHERE ts < now() - interval '30 days' LIMIT p_batch));
  ELSIF p_target = 'public.push_notification_logs' THEN
    DELETE FROM public.push_notification_logs WHERE ctid = ANY (ARRAY(
      SELECT ctid FROM public.push_notification_logs WHERE created_at < now() - interval '30 days' LIMIT p_batch));
  ELSIF p_target = 'public.sms_logs' THEN
    DELETE FROM public.sms_logs WHERE ctid = ANY (ARRAY(
      SELECT ctid FROM public.sms_logs WHERE created_at < now() - interval '90 days' LIMIT p_batch));
  ELSIF p_target = 'public.security_logs' THEN
    DELETE FROM public.security_logs WHERE ctid = ANY (ARRAY(
      SELECT ctid FROM public.security_logs WHERE created_at < now() - interval '90 days' LIMIT p_batch));
  ELSIF p_target = 'public.user_notifications' THEN
    DELETE FROM public.user_notifications WHERE ctid = ANY (ARRAY(
      SELECT ctid FROM public.user_notifications
      WHERE read = true AND created_at < now() - interval '60 days' LIMIT p_batch));
  ELSE
    RAISE EXCEPTION 'unknown cleanup target %', p_target;
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ── The cleanup run (internal: nightly cron and the admin RPC) ─────────────
-- p_budget_ms > 0 stops after roughly that long and reports more_remaining, so a request
-- stays under PostgREST's statement timeout; 0 runs to the end (nightly).
CREATE OR REPLACE FUNCTION public.run_db_retention(
  p_source text DEFAULT 'nightly',
  p_budget_ms int DEFAULT 0,
  p_triggered_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch CONSTANT int := 2000;
  v_deadline timestamptz := CASE WHEN p_budget_ms > 0
    THEN clock_timestamp() + make_interval(secs => p_budget_ms / 1000.0) END;
  v_deleted jsonb := '{}'::jsonb;
  v_more boolean := false;
  v_run uuid;
  v_total bigint;
  v_n int;
  r record;
BEGIN
  INSERT INTO public.db_cleanup_runs (source, triggered_by)
  VALUES (p_source, p_triggered_by)
  RETURNING id INTO v_run;

  FOR r IN SELECT target FROM public._db_retention_rules() LOOP
    v_total := 0;
    LOOP
      v_n := public._db_retention_delete_batch(r.target, v_batch);
      v_total := v_total + v_n;
      EXIT WHEN v_n < v_batch;
      IF v_deadline IS NOT NULL AND clock_timestamp() >= v_deadline THEN
        v_more := true;
        EXIT;
      END IF;
    END LOOP;
    v_deleted := v_deleted || jsonb_build_object(r.target, v_total);
    EXIT WHEN v_more;
  END LOOP;

  UPDATE public.db_cleanup_runs
  SET finished_at = now(), deleted = v_deleted, more_remaining = v_more
  WHERE id = v_run;

  RETURN jsonb_build_object('deleted', v_deleted, 'more_remaining', v_more);
END;
$$;

-- ── Admin guard: full admin, and a 2FA-verified session (production is_admin() no
--    longer checks 2FA itself) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._db_space_require_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.jwt()->>'role', '') = 'service_role' THEN
    RETURN;
  END IF;
  IF NOT public.is_admin() OR coalesce(auth.jwt()->>'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ── Admin RPCs ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_db_cleanup_now()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._db_space_require_admin();
  RETURN public.run_db_retention('manual', 5000, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_db_space()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._db_space_require_admin();
  RETURN jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'tables', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'target', r.target,
        'label', r.label,
        'keep_days', r.keep_days,
        'rule', r.rule,
        'total_bytes', coalesce(pg_total_relation_size(to_regclass(r.target)), 0),
        'approx_rows', coalesce((SELECT greatest(c.reltuples, 0)::bigint FROM pg_class c WHERE c.oid = to_regclass(r.target)), 0)
      )), '[]'::jsonb)
      FROM public._db_retention_rules() r
    ),
    'last_run', (
      SELECT to_jsonb(x) FROM (
        SELECT started_at, finished_at, source, deleted, more_remaining
        FROM public.db_cleanup_runs
        ORDER BY started_at DESC
        LIMIT 1
      ) x
    )
  );
END;
$$;

-- ── Grants: only the two admin RPCs are callable by signed-in users ────────
REVOKE ALL ON FUNCTION public._db_retention_rules() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._db_retention_delete_batch(text, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_db_retention(text, int, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._db_space_require_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_db_cleanup_now() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_db_space() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_db_cleanup_now() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_db_space() TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_db_retention(text, int, uuid) TO service_role;

-- ── Nightly schedule (03:20 UTC = Ghana time), replaced if it already exists ──
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'db-retention-nightly';
  PERFORM cron.schedule('db-retention-nightly', '20 3 * * *', $cmd$SELECT public.run_db_retention('nightly', 0, NULL)$cmd$);
END;
$$;
