-- Migration to add SMS balance to wallets

ALTER TABLE public.wallets 
ADD COLUMN IF NOT EXISTS sms_balance INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.wallets.sms_balance IS 'Number of SMS credits the agent has for custom Sender IDs';

-- RPC to atomic charge SMS credit
CREATE OR REPLACE FUNCTION public.charge_sms_credit(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  -- Lock the wallet row
  SELECT sms_balance INTO v_balance FROM public.wallets WHERE agent_id = p_user_id FOR UPDATE;
  
  IF v_balance >= 1 THEN
    UPDATE public.wallets SET sms_balance = sms_balance - 1, updated_at = now() WHERE agent_id = p_user_id;
    RETURN TRUE;
  END IF;
  
  RETURN FALSE;
END;
$$;
