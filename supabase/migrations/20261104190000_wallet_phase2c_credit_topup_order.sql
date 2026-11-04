-- ═══════════════════════════════════════════════════════════════════════════
-- Wallet Phase 2c: credit a wallet top-up order exactly once.
--
-- Paystack webhook, verify-payment and Korba webhook used to credit top-ups
-- with separate calls (repay_credit / credit_api_wallet / credit_wallet) and
-- relied only on each caller's own order claim. credit_topup_order() does it
-- atomically: locks the order, credits through wallet_post() with the ledger
-- key 'topup:<order id>' (so a second credit is impossible), and marks the
-- order fulfilled. The credit is the order's stored top-up amount, never more
-- (Korba previously credited the gross amount including the fee).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.credit_topup_order(p_order_id uuid, p_paid_amount numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record;
  v_account text;
  v_amount numeric(14,2);
  v_res jsonb;
BEGIN
  SELECT id, agent_id, amount, order_type, status, metadata
    INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found');
  END IF;
  IF o.order_type <> 'wallet_topup' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a wallet top-up order');
  END IF;
  IF o.agent_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Top-up has no wallet owner');
  END IF;
  IF o.status = 'fulfilled' THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'reason', 'Order already fulfilled');
  END IF;
  IF o.status IN ('refunded', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order is ' || o.status);
  END IF;

  v_account := CASE WHEN o.metadata->>'wallet_type' = 'api' THEN 'api' ELSE 'main' END;
  v_amount := round(CASE WHEN p_paid_amount IS NULL OR p_paid_amount <= 0 THEN o.amount
                         ELSE LEAST(p_paid_amount, o.amount) END, 2);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid top-up amount');
  END IF;

  v_res := public.wallet_post(o.agent_id, v_account, v_amount, 'wallet_topup', 'order', p_order_id::text,
                              'topup:' || p_order_id::text, 'Wallet top-up');

  IF coalesce((v_res->>'success')::boolean, false) THEN
    UPDATE public.orders SET status = 'fulfilled', failure_reason = NULL, updated_at = now()
     WHERE id = p_order_id AND status <> 'fulfilled';
  END IF;

  RETURN v_res || jsonb_build_object('account', v_account, 'amount', v_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.credit_topup_order(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_topup_order(uuid, numeric) TO service_role;
