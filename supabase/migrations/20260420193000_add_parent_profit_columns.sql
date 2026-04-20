ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS parent_agent_id UUID,
ADD COLUMN IF NOT EXISTS parent_profit NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_parent_agent_id ON public.orders(parent_agent_id);
