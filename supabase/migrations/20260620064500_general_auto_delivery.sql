-- Migration: General Delayed Auto-Fulfillment
-- Re-defines public.auto_deliver_mashup_orders() function to transition ALL processing orders
-- (excluding activations and wallet topups) to 'fulfilled' after the configured delay.

CREATE OR REPLACE FUNCTION public.auto_deliver_mashup_orders()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delay_mins INTEGER;
  v_count INTEGER;
BEGIN
  -- Fetch delay minutes setting (reusing mashup_delivery_delay_mins)
  SELECT COALESCE(mashup_delivery_delay_mins, 15) INTO v_delay_mins
  FROM public.system_settings
  WHERE id = 1;

  -- Update processing orders that have exceeded the delay
  -- Excluding wallet topups and activations since they are immediately fulfilled
  UPDATE public.orders
  SET 
    status = 'fulfilled',
    updated_at = now()
  WHERE 
    status = 'processing'
    AND order_type NOT IN ('agent_activation', 'sub_agent_activation', 'wallet_topup')
    AND updated_at <= (now() - (v_delay_mins * interval '1 minute'));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    RAISE NOTICE 'Auto-delivered % processing orders.', v_count;
  END IF;
END;
$$;
