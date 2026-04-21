-- Atomic wallet debit to prevent race conditions on concurrent purchases.
-- Uses FOR UPDATE row lock so concurrent calls queue instead of double-spending.
CREATE OR REPLACE FUNCTION debit_wallet(p_agent_id UUID, p_amount NUMERIC)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  SELECT balance INTO v_balance
  FROM wallets
  WHERE agent_id = p_agent_id
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  IF v_balance < p_amount THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient balance', 'balance', v_balance);
  END IF;

  v_new_balance := ROUND(v_balance - p_amount, 2);

  UPDATE wallets
  SET balance = v_new_balance, updated_at = now()
  WHERE agent_id = p_agent_id;

  RETURN json_build_object('success', true, 'new_balance', v_new_balance);
END;
$$;

GRANT EXECUTE ON FUNCTION debit_wallet(UUID, NUMERIC) TO service_role;
