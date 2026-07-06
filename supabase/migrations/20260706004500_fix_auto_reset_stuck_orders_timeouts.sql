-- 20260706004500_fix_auto_reset_stuck_orders_timeouts.sql
-- Redefines public.auto_reset_stuck_orders to include orders stuck with 'timeout' or 'failed_api_call' provider_order_id.

CREATE OR REPLACE FUNCTION public.auto_reset_stuck_orders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count int;
BEGIN
  -- Update stuck processing orders to 'fulfillment_failed' to trigger auto-refund
  -- Exclude MTN Mash Up orders so they remain in processing until manual admin update
  UPDATE public.orders
  SET
    status        = 'fulfillment_failed',
    failure_reason = 'Auto-reset: stuck in processing without provider submission',
    updated_at    = now()
  WHERE
    status            = 'processing'
    AND (provider_order_id IS NULL OR provider_order_id IN ('timeout', 'failed_api_call'))
    AND updated_at    < now() - interval '15 minutes'
    AND order_type    IN ('data', 'airtime', 'utility', 'store_wallet_topup')
    AND network       IS DISTINCT FROM 'MTN Mash Up';

  GET DIAGNOSTICS v_count = ROW_COUNT;

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
