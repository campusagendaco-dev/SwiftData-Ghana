-- Atomic wallet credit to prevent race conditions when multiple sub-agents purchase concurrently.
-- Uses FOR UPDATE row lock so concurrent calls queue instead of overwriting balances.
CREATE OR REPLACE FUNCTION credit_wallet(p_agent_id UUID, p_amount NUMERIC)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  -- Lock the row for update
  SELECT balance INTO v_balance
  FROM wallets
  WHERE agent_id = p_agent_id
  FOR UPDATE;

  -- If wallet doesn't exist, create it
  IF v_balance IS NULL THEN
    INSERT INTO wallets (agent_id, balance, updated_at)
    VALUES (p_agent_id, p_amount, now());
    RETURN json_build_object('success', true, 'new_balance', p_amount);
  END IF;

  v_new_balance := ROUND(v_balance + p_amount, 2);

  UPDATE wallets
  SET balance = v_new_balance, updated_at = now()
  WHERE agent_id = p_agent_id;

  RETURN json_build_object('success', true, 'new_balance', v_new_balance);
END;
$$;

GRANT EXECUTE ON FUNCTION credit_wallet(UUID, NUMERIC) TO service_role;
