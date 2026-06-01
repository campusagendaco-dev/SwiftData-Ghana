-- Migration: Disable API to Main Wallet Transfers
-- Description: Re-creates api.transfer_funds to block transfers from api to main wallet for deposit fee security.

CREATE OR REPLACE FUNCTION api.transfer_funds(
  p_user_id UUID, p_amount NUMERIC, p_from TEXT, p_to TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, api AS $$
DECLARE v_main_balance NUMERIC; v_api_balance NUMERIC;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;
  
  IF p_from = 'main' AND p_to = 'api' THEN
    UPDATE public.wallets SET balance = balance - p_amount, api_balance = api_balance + p_amount, updated_at = now()
    WHERE agent_id = p_user_id AND balance >= p_amount
    RETURNING balance, api_balance INTO v_main_balance, v_api_balance;
  ELSIF p_from = 'api' AND p_to = 'main' THEN
    -- Block API to Main transfers to prevent deposit fee bypass
    RETURN jsonb_build_object('success', false, 'error', 'Transfers from API wallet to Main wallet are disabled for security reasons.');
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Invalid transfer direction');
  END IF;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient funds or wallet not found');
  END IF;
  
  RETURN jsonb_build_object('success', true, 'main_balance', v_main_balance, 'api_balance', v_api_balance);
END; $$;
