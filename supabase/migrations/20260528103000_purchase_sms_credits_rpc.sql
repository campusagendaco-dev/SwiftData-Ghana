-- RPC for purchasing SMS credits
CREATE OR REPLACE FUNCTION public.purchase_sms_credits(p_amount INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_wallet_balance NUMERIC;
  v_sms_balance INTEGER;
  v_cost NUMERIC;
BEGIN
  -- Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than 0');
  END IF;

  -- Calculate cost: 0.02 GHS per SMS credit
  v_cost := p_amount * 0.02;

  -- Lock the wallet row
  SELECT balance, sms_balance INTO v_wallet_balance, v_sms_balance 
  FROM public.wallets 
  WHERE agent_id = v_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  IF v_wallet_balance < v_cost THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
  END IF;

  -- Perform deduction and increment
  UPDATE public.wallets 
  SET 
    balance = balance - v_cost,
    sms_balance = sms_balance + p_amount,
    updated_at = now()
  WHERE agent_id = v_user_id;

  RETURN jsonb_build_object(
    'success', true, 
    'new_wallet_balance', v_wallet_balance - v_cost,
    'new_sms_balance', v_sms_balance + p_amount
  );
END;
$$;
