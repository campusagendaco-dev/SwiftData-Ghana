-- Harden refund_failed_order.
--
-- Problem: the function is SECURITY DEFINER, executable by anon/authenticated, and had no caller or
-- status check. Anyone holding an order UUID could refund a wallet order that was already FULFILLED
-- or still PROCESSING at a provider (customer gets data AND money back). DashboardOrders also falls
-- back to calling this RPC directly whenever verify-and-refund rejects a refund (non-2xx), which
-- bypassed all of verify-and-refund's provider checks.
--
-- Fix:
--   1. Direct browser callers (anon / authenticated) must be admins. Agents go through the
--      verify-and-refund edge function (service role), which checks provider state first.
--      Trigger (trg_auto_refund) and service_role / pg_cron callers are unaffected.
--   2. Never refund an order whose status is fulfilled/completed.
--   3. Revoke EXECUTE from anon / PUBLIC.
-- All other behaviour (today-only policy, wallet-only, topup exclusion) is unchanged.

CREATE OR REPLACE FUNCTION public.refund_failed_order(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_role  text := COALESCE(auth.role(), '');
BEGIN
  -- 1. Caller check (skip when invoked from the auto-refund trigger)
  IF pg_trigger_depth() = 0
     AND v_role IN ('anon', 'authenticated')
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Refunds must be requested through the refund service.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;
  IF v_order.auto_refunded OR v_order.status = 'refunded' THEN RETURN false; END IF; -- idempotent

  -- 2. Never refund a delivered order
  IF v_order.status IN ('fulfilled', 'completed') THEN RETURN false; END IF;

  -- Strictly require order to be created from 2026-08-01 onwards
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
    jsonb_build_object('order_id', p_order_id, 'amount', v_order.amount, 'caller_role', v_role)
  )
  ON CONFLICT DO NOTHING;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refund_failed_order(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_failed_order(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.refund_failed_order(uuid) TO authenticated, service_role;
