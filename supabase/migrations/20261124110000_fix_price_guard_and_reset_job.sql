-- Order jobs, part 2 (owner-approved plan, 2026-11-24). Apply by pasting into the SQL editor,
-- AFTER the heal job (part 1) has checked this week's orders with the providers.
--
-- 1. The price check ran on EVERY order update, so a status change on any order with an odd
--    price failed the whole statement. That has blocked auto-reset-stuck-orders (and the
--    old auto-deliver job) on every run since August. It now checks when an order is created
--    or when its amount, cost, package or type changes, which is when a price can be abused.
-- 2. auto_reset_stuck_orders only touches orders created in the last 7 days, and no longer runs
--    its own refund loop over every failed wallet order ever. Failed orders are still refunded
--    by the trg_auto_refund rule the moment they fail (respecting the auto-refund on/off
--    setting and the refund service's checks). The logged count now includes both resets.
-- 3. The suspicious GH₵0.10 orders stuck in processing are closed as 'cancelled' with no refund.

-- ── 1. Price check ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_order_pricing_exploit_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- A status-only change can't abuse a price that was already checked on insert.
  IF TG_OP = 'UPDATE'
     AND NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.cost_price IS NOT DISTINCT FROM OLD.cost_price
     AND NEW.package_size IS NOT DISTINCT FROM OLD.package_size
     AND NEW.order_type IS NOT DISTINCT FROM OLD.order_type THEN
    RETURN NEW;
  END IF;

  -- Only inspect data or API orders
  IF NEW.order_type IN ('data', 'api') OR NEW.package_size ILIKE '%GB%' THEN
    -- Check if amount is suspiciously low compared to cost price
    IF (NEW.amount > 0 AND NEW.amount < 1.00 AND NEW.package_size ILIKE '%GB%') OR
       (NEW.cost_price > 0 AND NEW.amount < (NEW.cost_price * 0.20)) THEN
      -- Immediately log violation & suspend the offender
      IF NEW.agent_id IS NOT NULL AND NEW.agent_id != '00000000-0000-0000-0000-000000000000' THEN
        PERFORM public.log_security_violation(
          NEW.agent_id,
          format('Pricing bypass attempt detected for %s (GHs %s)', NEW.package_size, NEW.amount),
          jsonb_build_object('package', NEW.package_size, 'amount', NEW.amount, 'cost_price', NEW.cost_price)
        );
      END IF;
      RAISE EXCEPTION 'Security Alert: Order rejected due to price anomaly detection.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Reset job: recent orders only, no blanket refund loop ───────────────
CREATE OR REPLACE FUNCTION public.auto_reset_stuck_orders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_n int := 0;
BEGIN
  -- Never sent to a provider after 15 minutes
  UPDATE public.orders
  SET
    status = 'fulfillment_failed',
    failure_reason = 'Auto-reset: stuck in processing without provider submission (>15 mins)',
    updated_at = now()
  WHERE
    status = 'processing'
    AND provider_order_id IS NULL
    AND updated_at < now() - interval '15 minutes'
    AND created_at > now() - interval '7 days'
    AND order_type IN ('data', 'airtime', 'utility', 'store_wallet_topup');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_count := v_count + v_n;

  -- No provider answer after 60 minutes
  UPDATE public.orders
  SET
    status = 'fulfillment_failed',
    failure_reason = 'Auto-reset: provider webhook timeout (>60 mins in processing)',
    updated_at = now()
  WHERE
    status = 'processing'
    AND updated_at < now() - interval '60 minutes'
    AND created_at > now() - interval '7 days'
    AND order_type IN ('data', 'airtime', 'utility', 'store_wallet_topup');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_count := v_count + v_n;

  IF v_count > 0 THEN
    INSERT INTO public.system_logs (level, source, event, message, data)
    VALUES (
      'warn',
      'cron-auto-retry',
      'orders.auto_reset',
      format('Auto-reset %s stuck orders to failed (refunds follow the auto-refund rule)', v_count),
      jsonb_build_object('count', v_count, 'triggered_at', now())
    );
  END IF;

  RETURN v_count;
END;
$$;

-- ── 3. Close the suspicious GH₵0.10 orders (no refund) ─────────────────────
WITH closed AS (
  UPDATE public.orders
  SET status = 'cancelled',
      failure_reason = 'Closed by admin 2026-11-24: rejected by price check (no refund)',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('closed_price_anomaly_at', now())
  -- only the near-zero paid orders (GH₵0.01-0.99 for a GB bundle); free orders (amount 0, such as
  -- free data claims and Mystery Box prizes) are not touched
  WHERE status = 'processing'
    AND order_type IN ('data', 'api')
    AND amount > 0 AND amount < 1.00
    AND package_size ILIKE '%GB%'
  RETURNING id
)
SELECT count(*) AS suspicious_orders_closed FROM closed;
