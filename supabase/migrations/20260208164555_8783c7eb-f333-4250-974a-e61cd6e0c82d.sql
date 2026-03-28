
-- Replace general markups with per-package agent prices
-- Format: { "MTN": { "1GB": "7.00", "2GB": "12.00", ... }, "Telecel": { ... } }
ALTER TABLE public.profiles ADD COLUMN agent_prices JSONB NOT NULL DEFAULT '{}';
