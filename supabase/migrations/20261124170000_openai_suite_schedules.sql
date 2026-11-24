-- ═══════════════════════════════════════════════════════════════════════════
-- OPENAI SUITE DAILY SCHEDULES & MARGIN WATCHDOG REGISTRY
-- Schedules:
--   1. ai-margin-watchdog  — daily at 06:30 UTC (pg_cron + Vault supabase_service_role)
--   2. cron-daily-report   — daily at 07:00 UTC (pg_cron + Vault supabase_service_role)
-- Registry:
--   Registers `margin_watchdog` in public.ai_agent_registry with active_model = 'gpt-4o-mini'
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Register margin_watchdog in ai_agent_registry
INSERT INTO public.ai_agent_registry (
  name,
  display_name,
  description,
  schedule,
  edge_function,
  is_active,
  active_model,
  autonomy_mode,
  daily_budget_usd
)
VALUES (
  'margin_watchdog',
  'AI Margin Watchdog',
  'Audits non-Korba SME provider wholesale costs against global_package_settings and agent pricing tables, flags loss-making or razor-thin (<2%) bundles, and alerts admins via SMS',
  '30 6 * * *',
  'ai-margin-watchdog',
  true,
  'gpt-4o-mini',
  'autonomous',
  2.00
)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  schedule = EXCLUDED.schedule,
  edge_function = EXCLUDED.edge_function,
  is_active = true,
  active_model = 'gpt-4o-mini';

-- 2. Schedule daily pg_cron jobs using Vault supabase_service_role
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- AI Margin Watchdog (daily at 06:30 UTC)
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('ai-margin-watchdog', 'ai-margin-watchdog-daily');
    PERFORM cron.schedule(
      'ai-margin-watchdog-daily',
      '30 6 * * *',
      $cmd$
        SELECT net.http_post(
          url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/ai-margin-watchdog',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || coalesce(
              (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role' LIMIT 1), '')
          ),
          body := '{"source":"pg_cron"}'::jsonb,
          timeout_milliseconds := 60000
        );
      $cmd$
    );

    -- Daily CEO Briefing & Report (daily at 07:00 UTC)
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('cron-daily-report', 'cron-daily-report-daily');
    PERFORM cron.schedule(
      'cron-daily-report',
      '0 7 * * *',
      $cmd$
        SELECT net.http_post(
          url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/cron-daily-report',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || coalesce(
              (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role' LIMIT 1), '')
          ),
          body := '{"source":"pg_cron"}'::jsonb,
          timeout_milliseconds := 60000
        );
      $cmd$
    );
  END IF;
END $$;
