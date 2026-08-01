-- Migration: Today-Only Auto-Refund Policy
-- Enforces that ONLY orders created starting from today (2026-08-01 00:00:00 UTC) can be auto-refunded

CREATE OR REPLACE FUNCTION public.refund_failed_order(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;
  IF v_order.auto_refunded OR v_order.status = 'refunded' THEN RETURN false; END IF; -- idempotent

  -- Strictly require order to be created from today onwards (August 1st, 2026)
  IF v_order.created_at < '2026-08-01 00:00:00+00'::timestamptz THEN
    RETURN false;
  END IF;

  -- Block topups and activation fees from being refunded
  IF v_order.order_type IN ('wallet_topup', 'store_wallet_topup', 'agent_activation', 'sub_agent_activation') THEN 
    RETURN false; 
  END IF;

  -- MUST be paid via wallet balance
  IF v_order.payment_method IS NULL OR v_order.payment_method NOT IN ('wallet', 'balance') THEN 
    RETURN false; 
  END IF;

  IF v_order.amount <= 0 THEN RETURN false; END IF;

  -- Refund wallet
  PERFORM public.credit_wallet(p_agent_id := v_order.agent_id, p_amount := v_order.amount);

  -- Mark order as refunded
  UPDATE public.orders SET
    status         = 'refunded',
    auto_refunded  = true,
    refunded_at    = now(),
    refund_amount  = v_order.amount,
    refund_reason  = 'Auto-refund: order fulfillment failed',
    updated_at     = now()
  WHERE id = p_order_id;

  -- Log it
  INSERT INTO public.system_logs (level, source, event, message, order_id, agent_id, data)
  VALUES (
    'info', 'system', 'order.refunded',
    format('Auto-refund GHS %s for failed order', v_order.amount),
    p_order_id, v_order.agent_id,
    jsonb_build_object('order_id', p_order_id, 'amount', v_order.amount)
  )
  ON CONFLICT DO NOTHING;

  RETURN true;
END;
$$;

-- Also update trigger_auto_refund to check created_at >= 2026-08-01
CREATE OR REPLACE FUNCTION public.trigger_auto_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auto_refund_enabled BOOLEAN;
BEGIN
  SELECT COALESCE(auto_refund_enabled, true) INTO v_auto_refund_enabled 
  FROM public.system_settings 
  WHERE id = 1;

  IF v_auto_refund_enabled 
     AND NEW.status = 'fulfillment_failed'
     AND (OLD.status IS NULL OR OLD.status != 'fulfillment_failed')
     AND NEW.created_at >= '2026-08-01 00:00:00+00'::timestamptz
     AND (NEW.payment_method IS NULL OR NEW.payment_method IN ('wallet', 'balance'))
     AND NEW.agent_id IS NOT NULL 
     AND NEW.agent_id != '00000000-0000-0000-0000-000000000000'
     AND NOT COALESCE(NEW.auto_refunded, false)
  THEN
    PERFORM public.refund_failed_order(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
