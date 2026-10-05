-- Add channel column to orders to cleanly distinguish web vs whatsapp vs api orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'web';
CREATE INDEX IF NOT EXISTS idx_orders_channel ON public.orders(channel);

-- Backfill existing WhatsApp orders
UPDATE public.orders
SET channel = 'whatsapp'
WHERE (channel IS NULL OR channel = 'web')
  AND (
    metadata->>'channel' = 'whatsapp'
    OR metadata->>'channel' = 'whatsapp_agent'
    OR metadata->>'wa_from' IS NOT NULL
    OR metadata->>'source' ILIKE '%whatsapp%'
  );
