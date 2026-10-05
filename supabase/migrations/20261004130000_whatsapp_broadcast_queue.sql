-- Migration: Progressive WhatsApp Broadcast Queue & Concurrency Protection
-- Prevents WhatsApp session disconnection during large viral blasts (6,000+ users)
-- and shields the bot during high-concurrency chatting (1,000+ simultaneous users)

CREATE TABLE IF NOT EXISTS public.whatsapp_broadcast_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID DEFAULT gen_random_uuid(),
  recipient_phone TEXT NOT NULL,
  message TEXT NOT NULL,
  options JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, sent, failed, skipped
  attempts INT NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wa_queue_status_created ON public.whatsapp_broadcast_queue(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_wa_queue_broadcast_id ON public.whatsapp_broadcast_queue(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_wa_queue_phone ON public.whatsapp_broadcast_queue(recipient_phone);

-- Enable RLS
ALTER TABLE public.whatsapp_broadcast_queue ENABLE ROW LEVEL SECURITY;

-- Admins & Service role can do everything
CREATE POLICY "Admins full access to whatsapp_broadcast_queue"
  ON public.whatsapp_broadcast_queue
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

-- RPC for atomic queue fetching and locking
CREATE OR REPLACE FUNCTION public.fetch_next_whatsapp_broadcast_batch(
  p_batch_size INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  broadcast_id UUID,
  recipient_phone TEXT,
  message TEXT,
  options JSONB,
  attempts INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.whatsapp_broadcast_queue q
  SET 
    status = 'processing',
    attempts = q.attempts + 1,
    updated_at = now()
  WHERE q.id IN (
    SELECT sub.id
    FROM public.whatsapp_broadcast_queue sub
    WHERE sub.status = 'pending'
    ORDER BY sub.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING q.id, q.broadcast_id, q.recipient_phone, q.message, q.options, q.attempts;
END;
$$;

-- RPC for getting live broadcast queue stats
CREATE OR REPLACE FUNCTION public.get_whatsapp_broadcast_queue_stats(p_broadcast_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_broadcast_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'broadcast_id', p_broadcast_id,
      'total', count(*),
      'pending', count(*) FILTER (WHERE status = 'pending'),
      'processing', count(*) FILTER (WHERE status = 'processing'),
      'sent', count(*) FILTER (WHERE status = 'sent'),
      'failed', count(*) FILTER (WHERE status = 'failed'),
      'skipped', count(*) FILTER (WHERE status = 'skipped')
    ) INTO v_result
    FROM public.whatsapp_broadcast_queue
    WHERE broadcast_id = p_broadcast_id;
  ELSE
    SELECT jsonb_build_object(
      'total', count(*),
      'pending', count(*) FILTER (WHERE status = 'pending'),
      'processing', count(*) FILTER (WHERE status = 'processing'),
      'sent', count(*) FILTER (WHERE status = 'sent'),
      'failed', count(*) FILTER (WHERE status = 'failed'),
      'skipped', count(*) FILTER (WHERE status = 'skipped')
    ) INTO v_result
    FROM public.whatsapp_broadcast_queue;
  END IF;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_next_whatsapp_broadcast_batch TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_broadcast_queue_stats TO authenticated, service_role;
