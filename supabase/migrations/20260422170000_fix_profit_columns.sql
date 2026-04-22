-- Ensure parent profit columns exist (idempotent)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS parent_agent_id UUID;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS parent_profit NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_parent_agent_id ON public.orders(parent_agent_id);
CREATE INDEX IF NOT EXISTS idx_orders_agent_id ON public.orders(agent_id);

-- Make wallets.updated_at column exist for profit credit updates
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
