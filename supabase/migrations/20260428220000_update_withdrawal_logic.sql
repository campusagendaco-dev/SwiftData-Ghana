-- Update request_withdrawal to check actual wallet balance.
-- This prevents users from requesting withdrawals of profit they already spent on data bundles.

CREATE OR REPLACE FUNCTION public.request_withdrawal(p_agent_id UUID, p_amount NUMERIC)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_agent BOOLEAN;
  v_agent_approved BOOLEAN;
  v_total_profit NUMERIC;
  v_parent_profit NUMERIC;
  v_total_withdrawn NUMERIC;
  v_profit_available NUMERIC;
  v_wallet_balance NUMERIC;
  v_available_balance NUMERIC;
  v_withdrawal_id UUID;
  v_fee_rate NUMERIC := 0.015; -- 1.5% fee
  v_fee NUMERIC;
  v_net_amount NUMERIC;
BEGIN
  -- 1. Lock the agent's profile and check status
  SELECT is_agent, agent_approved INTO v_is_agent, v_agent_approved
  FROM profiles
  WHERE user_id = p_agent_id
  FOR UPDATE;

  IF NOT v_is_agent OR NOT v_agent_approved THEN
    RETURN json_build_object('success', false, 'error', 'Agent not found or not approved');
  END IF;

  -- 2. Check actual liquid wallet balance
  SELECT balance INTO v_wallet_balance
  FROM wallets
  WHERE agent_id = p_agent_id
  FOR UPDATE;

  -- 3. Calculate total profit from fulfilled direct sales
  SELECT COALESCE(SUM(profit), 0) INTO v_total_profit
  FROM orders
  WHERE agent_id = p_agent_id AND status = 'fulfilled';
  
  -- 4. Add parent profit from sub-agent sales
  SELECT COALESCE(SUM(parent_profit), 0) INTO v_parent_profit
  FROM orders
  WHERE parent_agent_id = p_agent_id AND status = 'fulfilled';
  
  v_total_profit := v_total_profit + v_parent_profit;

  -- 5. Calculate total already withdrawn or pending
  SELECT COALESCE(SUM(amount), 0) INTO v_total_withdrawn
  FROM withdrawals
  WHERE agent_id = p_agent_id AND status IN ('completed', 'pending', 'processing');

  -- 6. Profit-based limit
  v_profit_available := v_total_profit - v_total_withdrawn;

  -- 7. The real available balance is the MIN of profit-available and actual wallet balance
  -- (Since users can spend profit on data bundles, the wallet might be lower than profit-available)
  v_available_balance := LEAST(v_profit_available, v_wallet_balance);

  IF p_amount > v_available_balance THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Insufficient withdrawable balance', 
      'available', v_available_balance,
      'wallet_balance', v_wallet_balance,
      'profit_available', v_profit_available
    );
  END IF;

  -- 8. Calculate fee and net
  v_fee := ROUND(p_amount * v_fee_rate, 2);
  v_net_amount := p_amount - v_fee;

  -- 9. Insert pending withdrawal request safely
  v_withdrawal_id := gen_random_uuid();
  
  INSERT INTO withdrawals (id, agent_id, amount, net_amount, fee, status)
  VALUES (v_withdrawal_id, p_agent_id, p_amount, v_net_amount, v_fee, 'pending');

  RETURN json_build_object(
    'success', true, 
    'withdrawal_id', v_withdrawal_id,
    'fee', v_fee,
    'net_amount', v_net_amount
  );
END;
$$;
