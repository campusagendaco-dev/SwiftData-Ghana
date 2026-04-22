-- Atomic withdrawal request to prevent double-spending and race conditions.
-- We lock the agent's profile to serialize concurrent withdrawal requests.
CREATE OR REPLACE FUNCTION request_withdrawal(p_agent_id UUID, p_amount NUMERIC)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_agent BOOLEAN;
  v_agent_approved BOOLEAN;
  v_total_profit NUMERIC;
  v_total_withdrawn NUMERIC;
  v_available_balance NUMERIC;
  v_withdrawal_id UUID;
BEGIN
  -- 1. Lock the agent's profile to prevent concurrent withdrawal requests
  SELECT is_agent, agent_approved INTO v_is_agent, v_agent_approved
  FROM profiles
  WHERE user_id = p_agent_id
  FOR UPDATE;

  IF NOT v_is_agent OR NOT v_agent_approved THEN
    RETURN json_build_object('success', false, 'error', 'Agent not found or not approved');
  END IF;

  -- 2. Calculate total profit from fulfilled direct Momo sales
  SELECT COALESCE(SUM(profit), 0) INTO v_total_profit
  FROM orders
  WHERE agent_id = p_agent_id AND status = 'fulfilled';

  -- 3. Calculate total already withdrawn or pending
  SELECT COALESCE(SUM(amount), 0) INTO v_total_withdrawn
  FROM withdrawals
  WHERE agent_id = p_agent_id AND status IN ('completed', 'pending', 'processing');

  -- 4. Calculate available balance
  v_available_balance := v_total_profit - v_total_withdrawn;

  IF p_amount > v_available_balance THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient balance', 'available', v_available_balance);
  END IF;

  -- 5. Insert pending withdrawal request safely
  v_withdrawal_id := gen_random_uuid();
  
  INSERT INTO withdrawals (id, agent_id, amount, status)
  VALUES (v_withdrawal_id, p_agent_id, p_amount, 'pending');

  RETURN json_build_object('success', true, 'withdrawal_id', v_withdrawal_id);
END;
$$;

GRANT EXECUTE ON FUNCTION request_withdrawal(UUID, NUMERIC) TO service_role;
