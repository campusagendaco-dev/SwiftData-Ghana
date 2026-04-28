-- Add cost_price column to orders to track platform's acquisition cost
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cost_price DECIMAL(10,2) DEFAULT NULL;

-- Comment for clarity
COMMENT ON COLUMN public.orders.cost_price IS 'The price the platform paid to the provider for this specific order.';
