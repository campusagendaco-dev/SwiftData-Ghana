-- Migration: Atomic Deduplication for WhatsApp Webhook Events
-- Prevents double responses caused by Wasender firing both messages.upsert and messages.received simultaneously

CREATE TABLE IF NOT EXISTS public.whatsapp_processed_messages (
  message_id TEXT PRIMARY KEY,
  from_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_processed_messages_created ON public.whatsapp_processed_messages(created_at);

-- Enable RLS
ALTER TABLE public.whatsapp_processed_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on whatsapp_processed_messages"
  ON public.whatsapp_processed_messages
  FOR ALL
  TO authenticated, service_role
  USING (true)
  WITH CHECK (true);

-- Atomic RPC: Claims message_id. Returns TRUE if first time, FALSE if duplicate.
CREATE OR REPLACE FUNCTION public.claim_whatsapp_webhook_message(
  p_message_id TEXT,
  p_from TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_message_id IS NULL OR trim(p_message_id) = '' THEN
    RETURN TRUE;
  END IF;

  INSERT INTO public.whatsapp_processed_messages (message_id, from_phone, created_at)
  VALUES (trim(p_message_id), p_from, now());

  RETURN TRUE;
EXCEPTION
  WHEN unique_violation THEN
    RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_whatsapp_webhook_message TO authenticated, service_role, anon;
