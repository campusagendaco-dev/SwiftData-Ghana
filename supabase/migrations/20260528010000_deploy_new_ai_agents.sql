-- ═══════════════════════════════════════════════════════════════════════════
-- DEPLOY NEW AI SECURITY AGENTS
-- Creates support tables and pg_cron jobs for:
--   • threat-hunter   (every 3 min)  – cross-signal attack correlation
--   • aml-scanner     (every 10 min) – anti-money laundering
--   • account-cloner  (every 20 min) – multi-account fraud detection
-- ═══════════════════════════════════════════════════════════════════════════

-- ── AML Alerts Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.aml_alerts (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  agent_id            UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type          TEXT        NOT NULL,
  risk_score          INT         NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  pattern_description TEXT,
  transactions_analyzed INT       DEFAULT 0,
  action_taken        TEXT        DEFAULT 'pending',
  resolved_at         TIMESTAMPTZ,
  is_resolved         BOOLEAN     DEFAULT false
);

ALTER TABLE public.aml_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage aml_alerts"
  ON public.aml_alerts FOR ALL
  USING (auth.uid() IN (SELECT user_id FROM user_roles WHERE role = 'admin'));

CREATE INDEX IF NOT EXISTS aml_alerts_agent_idx   ON public.aml_alerts (agent_id);
CREATE INDEX IF NOT EXISTS aml_alerts_created_idx ON public.aml_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS aml_alerts_resolved_idx ON public.aml_alerts (is_resolved);

-- ── Duplicate Account Flags Table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.duplicate_account_flags (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  primary_user_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  duplicate_user_ids  UUID[]      NOT NULL DEFAULT '{}',
  matching_criteria   TEXT,
  confidence_score    NUMERIC(3,2) NOT NULL DEFAULT 0.5 CHECK (confidence_score BETWEEN 0 AND 1),
  action_taken        TEXT        DEFAULT 'pending',
  reviewed_by         UUID        REFERENCES auth.users(id),
  reviewed_at         TIMESTAMPTZ
);

ALTER TABLE public.duplicate_account_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage duplicate_account_flags"
  ON public.duplicate_account_flags FOR ALL
  USING (auth.uid() IN (SELECT user_id FROM user_roles WHERE role = 'admin'));

CREATE INDEX IF NOT EXISTS dup_flags_primary_idx  ON public.duplicate_account_flags (primary_user_id);
CREATE INDEX IF NOT EXISTS dup_flags_created_idx  ON public.duplicate_account_flags (created_at DESC);

-- ── Threat Intelligence Log ──────────────────────────────────────────────────
-- Stores cross-signal threat reports from the Threat Hunter agent
CREATE TABLE IF NOT EXISTS public.threat_intel (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  threat_level  TEXT        NOT NULL DEFAULT 'LOW',
  source_agent  TEXT        NOT NULL DEFAULT 'threat_hunter',
  signals       JSONB       DEFAULT '{}',
  actions_taken INT         DEFAULT 0,
  summary       TEXT
);

ALTER TABLE public.threat_intel ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view threat_intel"
  ON public.threat_intel FOR ALL
  USING (auth.uid() IN (SELECT user_id FROM user_roles WHERE role = 'admin'));

CREATE INDEX IF NOT EXISTS threat_intel_created_idx ON public.threat_intel (created_at DESC);
CREATE INDEX IF NOT EXISTS threat_intel_level_idx   ON public.threat_intel (threat_level);

-- ── Agent Registry — tracks all deployed AI agents ──────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_agent_registry (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT        UNIQUE NOT NULL,
  display_name  TEXT        NOT NULL,
  description   TEXT,
  schedule      TEXT        NOT NULL,  -- cron expression
  edge_function TEXT        NOT NULL,  -- edge function slug
  is_active     BOOLEAN     DEFAULT true,
  last_run_at   TIMESTAMPTZ,
  last_status   TEXT        DEFAULT 'pending',
  total_actions INT         DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.ai_agent_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage ai_agent_registry"
  ON public.ai_agent_registry FOR ALL
  USING (auth.uid() IN (SELECT user_id FROM user_roles WHERE role = 'admin'));

-- Seed existing + new agents into the registry
INSERT INTO public.ai_agent_registry (name, display_name, description, schedule, edge_function, is_active) VALUES
  ('sentinel_prime',    'Sentinel Prime',          'Autonomous system controller — fraud, liquidity, network healing', '* * * * *',     'sentinel-ai',    true),
  ('guardian_ai',       'Guardian AI',             '24/7 security patrol — wallet draining, impossible travel, API abuse', '*/5 * * * *',  'guardian-ai',    true),
  ('sentinel_evolve',   'Sentinel Evolve',         'Self-learning loop — evaluates action effectiveness and updates confidence scores', '*/15 * * * *', 'sentinel-evolve', true),
  ('threat_hunter',     'Threat Hunter',           'Cross-signal attack correlation — IP clusters, subnet sweeps, referral rings, login bots', '*/3 * * * *',  'threat-hunter',  true),
  ('aml_scanner',       'AML Scanner',             'Anti-money laundering — structuring, rapid cashout, volume spikes, circular flows, smurfing', '*/10 * * * *', 'aml-scanner',    true),
  ('account_cloner',    'Account Cloner Detector', 'Multi-account fraud — phone duplicates, IP burst signups, self-referral loops', '*/20 * * * *', 'account-cloner', true)
ON CONFLICT (name) DO NOTHING;

-- ── Realtime on new tables ───────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.aml_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.duplicate_account_flags;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_agent_registry;

-- ── pg_cron jobs for new agents ──────────────────────────────────────────────
-- (pg_cron block removed to fix syntax errors, scheduling will be handled via Deno.cron)
