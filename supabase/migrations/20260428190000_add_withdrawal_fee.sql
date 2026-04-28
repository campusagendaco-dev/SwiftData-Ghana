-- Add fee tracking columns to withdrawals
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS fee NUMERIC DEFAULT 0;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS net_amount NUMERIC;

-- Update the net_amount for existing completed withdrawals (optional but good for data integrity)
UPDATE withdrawals SET net_amount = amount - fee WHERE net_amount IS NULL;

-- Update the atomic withdrawal request function to include the 1.5% fee
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
  v_fee NUMERIC;
  v_net_amount NUMERIC;
  v_fee_rate NUMERIC := 0.015; -- 1.5% fee
BEGIN
  -- 1. Lock the agent's profile to prevent concurrent withdrawal requests
  SELECT is_agent, agent_approved INTO v_is_agent, v_agent_approved
  FROM profiles
  WHERE user_id = p_agent_id
  FOR UPDATE;

  IF NOT v_is_agent OR NOT v_agent_approved THEN
    RETURN json_build_object('success', false, 'error', 'Agent not found or not approved');
  END IF;

  -- 2. Calculate total profit from fulfilled orders (direct and sub-agent markups)
  SELECT COALESCE(SUM(profit), 0) INTO v_total_profit
  FROM orders
  WHERE agent_id = p_agent_id AND status = 'fulfilled';
  
  -- Add parent profit from sub-agent sales
  DECLARE
    v_parent_profit NUMERIC;
  BEGIN
    SELECT COALESCE(SUM(parent_profit), 0) INTO v_parent_profit
    FROM orders
    WHERE parent_agent_id = p_agent_id AND status = 'fulfilled';
    
    v_total_profit := v_total_profit + v_parent_profit;
  END;

  -- 3. Calculate total already withdrawn or pending
  SELECT COALESCE(SUM(amount), 0) INTO v_total_withdrawn
  FROM withdrawals
  WHERE agent_id = p_agent_id AND status IN ('completed', 'pending', 'processing');

  -- 4. Calculate available balance
  v_available_balance := v_total_profit - v_total_withdrawn;

  IF p_amount > v_available_balance THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient balance', 'available', v_available_balance);
  END IF;

  -- 5. Calculate fee and net amount
  v_fee := ROUND(p_amount * v_fee_rate, 2);
  v_net_amount := p_amount - v_fee;

  -- 6. Insert pending withdrawal request with fee details
  v_withdrawal_id := gen_random_uuid();
  
  INSERT INTO withdrawals (id, agent_id, amount, fee, net_amount, status)
  VALUES (v_withdrawal_id, p_agent_id, p_amount, v_fee, v_net_amount, 'pending');

  RETURN json_build_object(
    'success', true, 
    'withdrawal_id', v_withdrawal_id, 
    'fee', v_fee, 
    'net_amount', v_net_amount
  );
END;
$$;
