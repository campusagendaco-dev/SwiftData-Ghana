-- This script will safely reverse the 5 GHS overcredit you received.
-- It works by finding the latest store_wallet_topup order that caused the double credit.

DO $$
DECLARE
  v_agent_id UUID;
  v_amount NUMERIC(12, 2);
BEGIN
  -- Find the most recent store deposit where the agent deposited to their own store
  SELECT agent_id, amount INTO v_agent_id, v_amount
  FROM public.orders
  WHERE order_type = 'store_wallet_topup' 
    AND status = 'fulfilled'
    AND metadata->>'customer_id' = agent_id::text
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_agent_id IS NOT NULL THEN
    -- Reverse the overcredit by deducting exactly the deposit amount once
    UPDATE public.wallets
    SET balance = balance - v_amount
    WHERE agent_id = v_agent_id;
    
    RAISE NOTICE 'Successfully reversed overcredit of GHS % for agent %', v_amount, v_agent_id;
  ELSE
    RAISE NOTICE 'No matching overcredited deposit found.';
  END IF;
END;
$$;
