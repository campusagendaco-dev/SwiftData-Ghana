-- ═══════════════════════════════════════════════════════════════════════════
-- SAFE AI AGENT FLEET: system memory, run log, approval queue, agent modes
-- (rewritten 2026-11-24 from the owner's draft; design:
--  docs/superpowers/specs/2026-11-24-safe-ai-agents-design.md)
--
-- Agents WATCH and PROPOSE. Every agent starts 'observe_only'; an admin may raise one to
-- 'propose', which queues actions in ai_worker_tasks for an admin with 2FA to approve
-- (ai-task-decide). There is no autonomous mode.
--
-- Safe to run whether or not the earlier draft of this file was already pasted, and safe to
-- run twice. It schedules nothing: the timers are in 20261124180000_ai_agent_schedules.sql,
-- to be run only AFTER the new agent functions are deployed.
-- Apply by pasting into the Supabase SQL editor (never db push), then run
-- supabase/tests/ai_agents_checks.sql (no error = passed).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. System memory (learned baselines, error signatures, provider & security patterns)
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
CREATE INDEX IF NOT EXISTS idx_ai_system_memory_observed ON public.ai_system_memory (last_observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_system_memory_category ON public.ai_system_memory (category);

-- 2. Agent run log & spend
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
CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_created ON public.ai_agent_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_agent_created ON public.ai_agent_runs (agent_name, created_at DESC);

-- 3. Approval queue
CREATE TABLE IF NOT EXISTS public.ai_worker_tasks (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name   TEXT        NOT NULL DEFAULT 'ops_worker',
  task_type    TEXT        NOT NULL,
  priority     TEXT        NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status       TEXT        NOT NULL DEFAULT 'awaiting_approval',
  title        TEXT        NOT NULL,
  reasoning    TEXT,
  payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  result       JSONB,
  approved_by  UUID        REFERENCES auth.users(id),
  executed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_worker_tasks_status ON public.ai_worker_tasks (status, created_at DESC);

-- 'deciding' = claimed by ai-task-decide, so a task runs only once
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.ai_worker_tasks'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%status%' LOOP
    EXECUTE format('ALTER TABLE public.ai_worker_tasks DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.ai_worker_tasks ADD CONSTRAINT ai_worker_tasks_status_check
  CHECK (status IN ('awaiting_approval', 'deciding', 'executed', 'rejected', 'failed'));

-- 4. Row security: admins who completed 2FA (is_admin()) can read; only the service role
--    (edge functions) writes. Old draft policies that skipped 2FA are removed.
ALTER TABLE public.ai_system_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_worker_tasks  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage ai_system_memory" ON public.ai_system_memory;
DROP POLICY IF EXISTS "Admins can view ai_agent_runs" ON public.ai_agent_runs;
DROP POLICY IF EXISTS "Admins can manage ai_worker_tasks" ON public.ai_worker_tasks;
DROP POLICY IF EXISTS "Admins can read ai_system_memory" ON public.ai_system_memory;
DROP POLICY IF EXISTS "Admins can read ai_agent_runs" ON public.ai_agent_runs;
DROP POLICY IF EXISTS "Admins can read ai_worker_tasks" ON public.ai_worker_tasks;
DROP POLICY IF EXISTS "Service role full access ai_system_memory" ON public.ai_system_memory;
DROP POLICY IF EXISTS "Service role full access ai_agent_runs" ON public.ai_agent_runs;
DROP POLICY IF EXISTS "Service role full access ai_worker_tasks" ON public.ai_worker_tasks;

CREATE POLICY "Admins can read ai_system_memory" ON public.ai_system_memory FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can read ai_agent_runs" ON public.ai_agent_runs FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can read ai_worker_tasks" ON public.ai_worker_tasks FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Service role full access ai_system_memory" ON public.ai_system_memory FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access ai_agent_runs" ON public.ai_agent_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access ai_worker_tasks" ON public.ai_worker_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. Agent registry: modes, budget, 2FA-only admin access
ALTER TABLE public.ai_agent_registry ADD COLUMN IF NOT EXISTS autonomy_mode TEXT NOT NULL DEFAULT 'observe_only';
ALTER TABLE public.ai_agent_registry ADD COLUMN IF NOT EXISTS daily_budget_usd NUMERIC(10,4) NOT NULL DEFAULT 5.00;
ALTER TABLE public.ai_agent_registry ALTER COLUMN autonomy_mode SET DEFAULT 'observe_only';
ALTER TABLE public.ai_agent_registry DROP CONSTRAINT IF EXISTS ai_agent_registry_autonomy_mode_check;
UPDATE public.ai_agent_registry SET autonomy_mode = 'observe_only';
ALTER TABLE public.ai_agent_registry ADD CONSTRAINT ai_agent_registry_autonomy_mode_check
  CHECK (autonomy_mode IN ('observe_only', 'propose'));

INSERT INTO public.ai_agent_registry (name, display_name, description, schedule, edge_function, is_active, active_model, autonomy_mode, daily_budget_usd)
VALUES (
  'ops_worker',
  'Ops Worker AI',
  'Watches stuck orders, providers, errors, tickets and security signals; learns baselines; proposes actions for admin approval',
  '*/15 * * * *',
  'ops-worker-ai',
  true,
  NULL,
  'observe_only',
  5.00
)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  schedule = EXCLUDED.schedule,
  edge_function = EXCLUDED.edge_function,
  autonomy_mode = 'observe_only';
-- Each agent keeps the model it already has; ops_worker uses the default routing until an
-- admin picks one.

ALTER TABLE public.ai_agent_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can manage ai_agent_registry" ON public.ai_agent_registry;
DROP POLICY IF EXISTS "Admins can read ai_agent_registry" ON public.ai_agent_registry;
DROP POLICY IF EXISTS "Admins can update ai_agent_registry" ON public.ai_agent_registry;
CREATE POLICY "Admins can read ai_agent_registry" ON public.ai_agent_registry FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can update ai_agent_registry" ON public.ai_agent_registry FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
-- Signed-in admins may change only these three columns from the admin pages.
REVOKE INSERT, UPDATE, DELETE ON public.ai_agent_registry FROM anon, authenticated;
GRANT UPDATE (is_active, autonomy_mode, active_model) ON public.ai_agent_registry TO authenticated;

-- 6. Realtime for the approval queue and run log (memory stays out of realtime)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_agent_runs;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_worker_tasks;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.ai_system_memory;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 7. Remove any agent timers the draft may have created; 20261124180000 adds the safe ones
--    after the new functions are deployed.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job
     WHERE jobname IN ('ops-worker-ai-patrol', 'threat-hunter-patrol', 'aml-scanner-patrol', 'account-cloner-patrol');
  END IF;
END $$;
