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
  --    An explicit refund of a delivered order is still allowed.
  IF OLD.status IN ('fulfilled', 'completed')
     AND NEW.status NOT IN ('fulfilled', 'completed', 'refunded') THEN
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
