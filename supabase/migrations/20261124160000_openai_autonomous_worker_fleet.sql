-- ═══════════════════════════════════════════════════════════════════════════
-- OPENAI AUTONOMOUS WORKER FLEET, SYSTEM MEMORY, RUN TELEMETRY & CRON JOBS
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. System Memory (learned baselines, error signatures, provider & security patterns)
CREATE TABLE IF NOT EXISTS public.ai_system_memory (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  memory_key         TEXT        UNIQUE NOT NULL,
  category           TEXT        NOT NULL DEFAULT 'baseline'
    CHECK (category IN ('baseline', 'error_signature', 'provider_pattern', 'security_pattern', 'ops_playbook')),
  summary            TEXT        NOT NULL,
  data               JSONB       NOT NULL DEFAULT '{}'::jsonb,
  confidence         NUMERIC(4,2) NOT NULL DEFAULT 0.75 CHECK (confidence BETWEEN 0 AND 1),
  observations_count INT         NOT NULL DEFAULT 1,
  last_observed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_system_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage ai_system_memory" ON public.ai_system_memory;
CREATE POLICY "Admins can manage ai_system_memory"
  ON public.ai_system_memory FOR ALL
  USING (auth.uid() IN (SELECT user_id FROM public.user_roles WHERE role = 'admin'));

DROP POLICY IF EXISTS "Service role full access ai_system_memory" ON public.ai_system_memory;
CREATE POLICY "Service role full access ai_system_memory"
  ON public.ai_system_memory FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ai_system_memory_observed ON public.ai_system_memory (last_observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_system_memory_category ON public.ai_system_memory (category);

-- 2. Agent Run Telemetry & OpenAI Spend Ledger
CREATE TABLE IF NOT EXISTS public.ai_agent_runs (
  id                 UUID           DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name         TEXT           NOT NULL,
  provider           TEXT           NOT NULL,
  model              TEXT           NOT NULL,
  status             TEXT           NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'fallback', 'budget_capped', 'error')),
  prompt_tokens      INT            NOT NULL DEFAULT 0,
  completion_tokens  INT            NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12,6)  NOT NULL DEFAULT 0,
  duration_ms        INT            NOT NULL DEFAULT 0,
  error_message      TEXT,
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_agent_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view ai_agent_runs" ON public.ai_agent_runs;
CREATE POLICY "Admins can view ai_agent_runs"
  ON public.ai_agent_runs FOR SELECT
  USING (auth.uid() IN (SELECT user_id FROM public.user_roles WHERE role = 'admin'));

DROP POLICY IF EXISTS "Service role full access ai_agent_runs" ON public.ai_agent_runs;
CREATE POLICY "Service role full access ai_agent_runs"
  ON public.ai_agent_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_created ON public.ai_agent_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_agent_created ON public.ai_agent_runs (agent_name, created_at DESC);

-- 3. Worker Task & Approval Queue
CREATE TABLE IF NOT EXISTS public.ai_worker_tasks (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name   TEXT        NOT NULL DEFAULT 'ops_worker',
  task_type    TEXT        NOT NULL,
  priority     TEXT        NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status       TEXT        NOT NULL DEFAULT 'awaiting_approval'
    CHECK (status IN ('pending', 'awaiting_approval', 'executed', 'rejected', 'failed')),
  title        TEXT        NOT NULL,
  reasoning    TEXT,
  payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  result       JSONB,
  approved_by  UUID        REFERENCES auth.users(id),
  executed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_worker_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage ai_worker_tasks" ON public.ai_worker_tasks;
CREATE POLICY "Admins can manage ai_worker_tasks"
  ON public.ai_worker_tasks FOR ALL
  USING (auth.uid() IN (SELECT user_id FROM public.user_roles WHERE role = 'admin'));

DROP POLICY IF EXISTS "Service role full access ai_worker_tasks" ON public.ai_worker_tasks;
CREATE POLICY "Service role full access ai_worker_tasks"
  ON public.ai_worker_tasks FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ai_worker_tasks_status ON public.ai_worker_tasks (status, created_at DESC);

-- 4. Upgrade ai_agent_registry with autonomy_mode, daily_budget_usd, ops_worker & OpenAI defaults
ALTER TABLE public.ai_agent_registry
  ADD COLUMN IF NOT EXISTS autonomy_mode TEXT NOT NULL DEFAULT 'autonomous',
  ADD COLUMN IF NOT EXISTS daily_budget_usd NUMERIC(10,4) NOT NULL DEFAULT 5.00;

INSERT INTO public.ai_agent_registry (name, display_name, description, schedule, edge_function, is_active, active_model, autonomy_mode, daily_budget_usd)
VALUES (
  'ops_worker',
  'Ops Worker AI',
  'Autonomous operations, learning & security worker — heals stuck orders, rebalances SME providers, triages tickets, learns baselines, and runs admin commands',
  '*/5 * * * *',
  'ops-worker-ai',
  true,
  'gpt-4o-mini',
  'autonomous',
  5.00
)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  schedule = EXCLUDED.schedule,
  edge_function = EXCLUDED.edge_function,
  active_model = COALESCE(public.ai_agent_registry.active_model, 'gpt-4o-mini');

-- Switch existing fleet defaults to OpenAI gpt-4o-mini
UPDATE public.ai_agent_registry
SET active_model = 'gpt-4o-mini'
WHERE name IN ('sentinel_prime', 'guardian_ai', 'threat_hunter', 'aml_scanner', 'account_cloner', 'sentinel_evolve', 'ops_worker');

-- 5. Enable Realtime for new tables
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_system_memory;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_agent_runs;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_worker_tasks;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 6. Schedule 24/7 pg_cron jobs using Vault supabase_service_role key
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Ops Worker AI (every 5 minutes)
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ops-worker-ai-patrol';
    PERFORM cron.schedule(
      'ops-worker-ai-patrol',
      '*/5 * * * *',
      $cmd$
        SELECT net.http_post(
          url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/ops-worker-ai',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || coalesce(
              (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role' LIMIT 1), '')
          ),
          body := '{"mode":"patrol","source":"pg_cron"}'::jsonb,
          timeout_milliseconds := 60000
        );
      $cmd$
    );

    -- Threat Hunter (every 5 minutes)
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'threat-hunter-patrol';
    PERFORM cron.schedule(
      'threat-hunter-patrol',
      '*/5 * * * *',
      $cmd$
        SELECT net.http_post(
          url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/threat-hunter',
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

    -- AML Scanner (every 10 minutes)
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'aml-scanner-patrol';
    PERFORM cron.schedule(
      'aml-scanner-patrol',
      '*/10 * * * *',
      $cmd$
        SELECT net.http_post(
          url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/aml-scanner',
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

    -- Account Cloner Detector (every 20 minutes)
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'account-cloner-patrol';
    PERFORM cron.schedule(
      'account-cloner-patrol',
      '*/20 * * * *',
      $cmd$
        SELECT net.http_post(
          url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/account-cloner',
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
