-- Migration: Strict payment_method guard for refunds to prevent crediting unpaid checkouts
-- Ensures ONLY wallet-paid purchases can ever be refunded

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
