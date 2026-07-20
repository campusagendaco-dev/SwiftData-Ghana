-- Migration: Expand auto-refund payment methods and restrict to valid agents

CREATE OR REPLACE FUNCTION public.refund_failed_order(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order  public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;
  IF v_order.auto_refunded THEN RETURN false; END IF;  -- idempotent
  
  -- Exclude dummy agent / guest checkout
  IF v_order.agent_id IS NULL OR v_order.agent_id = '00000000-0000-0000-0000-000000000000' THEN
    RETURN false;
  END IF;

  -- Relax payment method check to allow paystack, momo, card, etc.
  IF COALESCE(v_order.payment_method, 'wallet') NOT IN ('wallet', 'balance', 'paystack', 'momo', 'card') THEN
    RETURN false;
  END IF;
  
  IF v_order.amount <= 0 THEN RETURN false; END IF;

  -- Refund correct wallet
  IF v_order.order_type = 'api' THEN
    PERFORM api.credit_api_wallet(v_order.agent_id, v_order.amount);
  ELSE
    PERFORM public.credit_wallet(p_agent_id := v_order.agent_id, p_amount := v_order.amount);
  END IF;

  -- Mark order as refunded
  UPDATE public.orders SET
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
    format('Auto-refund GHS %s for failed order (%s)', v_order.amount, v_order.payment_method),
    p_order_id, v_order.agent_id,
    jsonb_build_object('amount', v_order.amount, 'network', v_order.network, 'package_size', v_order.package_size, 'payment_method', v_order.payment_method)
  );

  -- Notify agent
  INSERT INTO public.user_notifications (user_id, title, message, type, data)
  VALUES (
    v_order.agent_id,
    'Order Refunded',
    format('GHS %s has been refunded to your wallet. Order for %s %s could not be fulfilled.',
      v_order.amount, v_order.network, v_order.package_size),
    'info',
    jsonb_build_object('order_id', p_order_id, 'amount', v_order.amount)
  )
  ON CONFLICT DO NOTHING;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_auto_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auto_refund_enabled BOOLEAN;
BEGIN
  SELECT COALESCE(auto_refund_enabled, false) INTO v_auto_refund_enabled 
  FROM public.system_settings 
  WHERE id = 1;

  IF v_auto_refund_enabled 
     AND NEW.status = 'fulfillment_failed'
     AND OLD.status != 'fulfillment_failed'
     AND NEW.payment_method IN ('wallet', 'balance', 'paystack', 'momo', 'card')
     AND NEW.agent_id IS NOT NULL 
     AND NEW.agent_id != '00000000-0000-0000-0000-000000000000'
     AND NOT COALESCE(NEW.auto_refunded, false)
  THEN
    PERFORM public.refund_failed_order(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
