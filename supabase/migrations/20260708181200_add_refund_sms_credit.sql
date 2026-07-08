-- Migration to add refund_sms_credit RPC
CREATE OR REPLACE FUNCTION public.refund_sms_credit(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.wallets SET sms_balance = sms_balance + 1, updated_at = now() WHERE agent_id = p_user_id;
END;
$$;
