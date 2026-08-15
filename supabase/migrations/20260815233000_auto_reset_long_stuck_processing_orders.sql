-- Migration: Enhance auto_reset_stuck_orders to handle provider webhook timeouts (>60 mins)
-- Ensures orders with provider_order_id stuck in processing for >60 mins are automatically transitioned to fulfillment_failed and refunded to user wallet.

CREATE OR REPLACE FUNCTION public.auto_reset_stuck_orders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count int := 0;
  v_stuck_rec RECORD;
BEGIN
  -- 1. Reset orders stuck in processing without provider submission (> 15 mins)
  UPDATE public.orders
  SET
    status = 'fulfillment_failed',
    failure_reason = 'Auto-reset: stuck in processing without provider submission (>15 mins)',
    updated_at = now()
  WHERE
    status = 'processing'
    AND provider_order_id IS NULL
    AND updated_at < now() - interval '15 minutes'
    AND order_type IN ('data', 'airtime', 'utility', 'store_wallet_topup');

  -- 2. Auto-reset orders with provider_order_id stuck in processing (> 60 mins)
  -- If provider hasn't sent a completion webhook in 1 hour, transition to failed and refund
  UPDATE public.orders
  SET
    status = 'fulfillment_failed',
    failure_reason = 'Auto-reset: provider webhook timeout (>60 mins in processing)',
    updated_at = now()
  WHERE
    status = 'processing'
    AND updated_at < now() - interval '60 minutes'
    AND order_type IN ('data', 'airtime', 'utility', 'store_wallet_topup');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 3. Trigger auto-refund for any fulfillment_failed orders missing auto_refunded status
  FOR v_stuck_rec IN (
    SELECT id FROM public.orders 
    WHERE status = 'fulfillment_failed' 
      AND auto_refunded = false 
      AND (payment_method IS NULL OR payment_method IN ('wallet', 'balance'))
      AND amount > 0
  ) LOOP
    PERFORM public.refund_failed_order(v_stuck_rec.id);
  END LOOP;

  IF v_count > 0 THEN
    INSERT INTO public.system_logs (level, source, event, message, data)
    VALUES (
      'warn',
      'cron-auto-retry',
      'orders.auto_reset',
      format('Auto-reset %s stuck orders to failed and refunded', v_count),
      jsonb_build_object('count', v_count, 'triggered_at', now())
    );
  END IF;

  RETURN v_count;
END;
$$;
