-- ============================================================================
-- Guard order status transitions (stops refund / re-dispatch loops)
--
-- Problems this closes (found in the 2026-11-03 backend audit):
--   * datahub-webhook / datamart-webhook accept late or duplicate callbacks and
--     move FULFILLED orders back to fulfillment_failed. trg_auto_refund then
--     refunds an order the customer already received.
--   * cron-auto-retry / admin-retry-autorouter / route-to-datamart pick up
--     orders that were already auto-refunded and dispatch them again, and
--     route-to-datamart resets auto_refunded=false without reversing the
--     refund, so a later failure refunds the same order a second time.
--   * Loyalty / profit / SMS / notification triggers re-fire every time an
--     order re-enters fulfilled or fulfillment_failed.
--
-- 65 edge functions write to public.orders, so the rule lives here, in one
-- BEFORE UPDATE trigger, instead of in each writer. It never raises (a raised
-- error inside a provider webhook would make the provider retry forever); it
-- keeps the old value and logs the attempt to system_logs.
--
-- Escape hatch for a deliberate manual correction in SQL:
--   SET LOCAL app.allow_order_regression = 'on';
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_order_status_transitions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_blocked text := NULL;
BEGIN
  IF COALESCE(current_setting('app.allow_order_regression', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  -- Sanctioned refund reversal: verify-payment's admin retry re-debits the
  -- wallet first, then clears the refund columns with this reason prefix.
  IF OLD.auto_refunded IS TRUE AND NEW.auto_refunded IS FALSE
     AND COALESCE(NEW.refund_amount, 0) = 0
     AND COALESCE(NEW.refund_reason, '') LIKE 'Refund reversed:%' THEN
    RETURN NEW;
  END IF;

  -- 1. A refund is never silently undone.
  IF OLD.auto_refunded IS TRUE AND NEW.auto_refunded IS DISTINCT FROM TRUE THEN
    NEW.auto_refunded := TRUE;
    NEW.refund_amount := OLD.refund_amount;
    NEW.refunded_at   := OLD.refunded_at;
    v_blocked := 'auto_refunded reset';
  END IF;

  -- 2. An order whose refund still stands cannot be re-dispatched or be
  --    marked delivered (which would also pay profit/loyalty on it).
  IF (OLD.auto_refunded IS TRUE OR (OLD.status = 'refunded' AND COALESCE(OLD.refund_amount, 0) > 0))
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('paid', 'pending', 'processing', 'dispatching', 'queued',
                        'awaiting_provider_confirmation', 'fulfilled', 'completed') THEN
    v_blocked := concat_ws(', ', v_blocked, format('%s -> %s on refunded order', OLD.status, NEW.status));
    NEW.status := OLD.status;
  END IF;

  -- 3. Refunded stays refunded while the refund stands.
  IF OLD.status = 'refunded' AND NEW.status IS DISTINCT FROM 'refunded'
     AND (OLD.auto_refunded IS TRUE OR COALESCE(OLD.refund_amount, 0) > 0) THEN
    v_blocked := concat_ws(', ', v_blocked, format('refunded -> %s', NEW.status));
    NEW.status := OLD.status;
  END IF;

  -- 4. Delivered orders never regress (late/duplicate provider callbacks).
  --    An explicit refund of a delivered order is still allowed. Orders that
  --    auto_deliver_mashup_orders() only ASSUMED delivered (metadata
  --    auto_delivered=true) may still be corrected to failed by the provider,
  --    so the customer gets refunded for a real failure.
  IF OLD.status IN ('fulfilled', 'completed')
     AND NEW.status NOT IN ('fulfilled', 'completed', 'refunded')
     AND COALESCE(OLD.metadata->>'auto_delivered', 'false') <> 'true' THEN
    v_blocked := concat_ws(', ', v_blocked, format('%s -> %s regression', OLD.status, NEW.status));
    NEW.status := OLD.status;
  END IF;

  IF v_blocked IS NOT NULL THEN
    BEGIN
      INSERT INTO public.system_logs (level, source, event, message, order_id, agent_id, data)
      VALUES ('warn', 'db', 'order.transition_blocked',
              format('Blocked order transition: %s', v_blocked),
              OLD.id, OLD.agent_id,
              jsonb_build_object('old_status', OLD.status, 'attempted', v_blocked));
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'guard_order_status_transitions: % (order %)', v_blocked, OLD.id;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- "a_" prefix: BEFORE triggers fire in name order; this must run first.
DROP TRIGGER IF EXISTS a_guard_order_status_transitions ON public.orders;
CREATE TRIGGER a_guard_order_status_transitions
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.auto_refunded IS DISTINCT FROM NEW.auto_refunded)
  EXECUTE FUNCTION public.guard_order_status_transitions();

-- auto_deliver_mashup_orders() (cron, every minute) marks processing orders as
-- fulfilled after a delay WITHOUT provider confirmation. Same behaviour, but it
-- now tags those rows so the guard above still lets a later provider failure
-- through (and a confirmed delivery is not confused with an assumed one).
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
  SELECT COALESCE(mashup_delivery_delay_mins, 15) INTO v_delay_mins
  FROM public.system_settings
  WHERE id = 1;

  UPDATE public.orders
  SET
    status = 'fulfilled',
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('auto_delivered', true, 'auto_delivered_at', now()),
    updated_at = now()
  WHERE
    status = 'processing'
    AND COALESCE(auto_refunded, false) = false
    AND order_type NOT IN ('agent_activation', 'sub_agent_activation', 'wallet_topup')
    AND updated_at <= (now() - (v_delay_mins * interval '1 minute'));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    RAISE NOTICE 'Auto-delivered % processing orders.', v_count;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_deliver_mashup_orders() FROM PUBLIC, anon, authenticated;
