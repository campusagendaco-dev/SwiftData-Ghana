-- Create RPC function to compute exact financial statistics for an agent
-- Resolves postgrest 1000-row limit truncation issue on orders table

CREATE OR REPLACE FUNCTION public.get_agent_financial_stats(p_agent_id UUID)
RETURNS TABLE (
  lifetime_profit NUMERIC,
  completed_withdrawals NUMERIC,
  pending_withdrawals NUMERIC,
  available_balance NUMERIC,
  completed_order_count BIGINT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_own_profit NUMERIC;
  v_parent_profit NUMERIC;
  v_completed_wds NUMERIC;
  v_pending_wds NUMERIC;
  v_order_count BIGINT;
BEGIN
  -- Total profit from own fulfilled sales
  SELECT COALESCE(SUM(profit), 0), COUNT(*)
  INTO v_own_profit, v_order_count
  FROM public.orders
  WHERE agent_id = p_agent_id AND status IN ('fulfilled', 'completed');

  -- Total profit from sub-agent fulfilled sales
  SELECT COALESCE(SUM(parent_profit), 0)
  INTO v_parent_profit
  FROM public.orders
  WHERE parent_agent_id = p_agent_id AND status IN ('fulfilled', 'completed');

  -- Completed withdrawals
  SELECT COALESCE(SUM(amount), 0)
  INTO v_completed_wds
  FROM public.withdrawals
  WHERE agent_id = p_agent_id AND status = 'completed';

  -- Pending withdrawals
  SELECT COALESCE(SUM(amount), 0)
  INTO v_pending_wds
  FROM public.withdrawals
  WHERE agent_id = p_agent_id AND status IN ('pending', 'processing');

  lifetime_profit := ROUND(COALESCE(v_own_profit + v_parent_profit, 0), 2);
  completed_withdrawals := ROUND(COALESCE(v_completed_wds, 0), 2);
  pending_withdrawals := ROUND(COALESCE(v_pending_wds, 0), 2);
  available_balance := ROUND(lifetime_profit - (v_completed_wds + v_pending_wds), 2);
  completed_order_count := COALESCE(v_order_count, 0);

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_agent_financial_stats(UUID) TO authenticated, service_role, anon;
