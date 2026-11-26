-- ═══════════════════════════════════════════════════════════════════════════
-- AI FIX-PROPOSER AGENT: memory category, registry entry, and 30-min pg_cron
--
-- Safe to run idempotently. Registers `ai_fix_proposer` in `ai_agent_registry`
-- (if present), expands `ai_system_memory.category` to allow 'fix_proposal',
-- and schedules `ai-fix-proposer` every 30 minutes using the service-role
-- secret stored in Supabase Vault (`supabase_service_role`).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Allow 'fix_proposal' category in ai_system_memory (if table exists)
DO $$
DECLARE
  c record;
BEGIN
  IF to_regclass('public.ai_system_memory') IS NOT NULL THEN
    FOR c IN
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public.ai_system_memory'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%category%'
    LOOP
      EXECUTE format('ALTER TABLE public.ai_system_memory DROP CONSTRAINT %I', c.conname);
    END LOOP;

    ALTER TABLE public.ai_system_memory
      ADD CONSTRAINT ai_system_memory_category_check
      CHECK (category IN (
        'baseline',
        'error_signature',
        'provider_pattern',
        'security_pattern',
        'ops_playbook',
        'fix_proposal'
      ));
  END IF;
END $$;

-- 2. Register ai_fix_proposer in ai_agent_registry (if table exists)
DO $$
BEGIN
  IF to_regclass('public.ai_agent_registry') IS NOT NULL THEN
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
      'ai_fix_proposer',
      'AI Fix Proposer',
      'Analyzes reconciliation discrepancies, margin losses, provider errors and stuck orders to generate human-approvable fix playbooks and safe remediation proposals.',
      '*/30 * * * *',
      'ai-fix-proposer',
      true,
      NULL,
      'propose',
      5.00
    )
    ON CONFLICT (name) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      description = EXCLUDED.description,
      schedule = EXCLUDED.schedule,
      edge_function = EXCLUDED.edge_function;
  ELSE
    RAISE NOTICE 'public.ai_agent_registry does not exist; skipping ai_fix_proposer registration';
  END IF;
END $$;

-- 3. Schedule pg_cron job every 30 minutes
DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed; ai-fix-proposer-patrol timer was not created';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ai-fix-proposer-patrol';

  PERFORM cron.schedule(
    'ai-fix-proposer-patrol',
    '*/30 * * * *',
    $cmd$
      SELECT net.http_post(
        url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/ai-fix-proposer',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role' LIMIT 1), ''
          )
        ),
        body := '{"source":"pg_cron"}'::jsonb,
        timeout_milliseconds := 60000
      );
    $cmd$
  );
END $$;
