
-- Create orders table for both data and AFA bundle orders
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('data', 'afa')),
  -- Data order fields
  customer_phone TEXT,
  network TEXT,
  package_size TEXT,
  -- AFA order fields
  afa_full_name TEXT,
  afa_ghana_card TEXT,
  afa_occupation TEXT,
  afa_email TEXT,
  afa_residence TEXT,
  afa_date_of_birth TEXT,
  -- Common fields
  amount NUMERIC(10,2) NOT NULL,
  profit NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Agents can view their own orders
CREATE POLICY "Agents can view their own orders"
ON public.orders
FOR SELECT
USING (auth.uid() = agent_id);

-- Agents can insert their own orders
CREATE POLICY "Agents can insert their own orders"
ON public.orders
FOR INSERT
WITH CHECK (auth.uid() = agent_id);

-- Agents can update their own orders
CREATE POLICY "Agents can update their own orders"
ON public.orders
FOR UPDATE
USING (auth.uid() = agent_id);

-- Index for fast agent lookups
CREATE INDEX idx_orders_agent_id ON public.orders (agent_id);
CREATE INDEX idx_orders_created_at ON public.orders (created_at DESC);
