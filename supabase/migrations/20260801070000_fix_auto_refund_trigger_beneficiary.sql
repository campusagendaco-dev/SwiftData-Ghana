-- Migration: Guarantee Auto-Refund on Failed & Beneficiary Error Orders
-- Ensures trigger_auto_refund handles both INSERT and UPDATE, including NULL OLD.status and NULL payment_method

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
     AND (NEW.payment_method IS NULL OR NEW.payment_method IN ('wallet', 'balance', 'paystack', 'momo', 'card'))
     AND NEW.agent_id IS NOT NULL 
     AND NEW.agent_id != '00000000-0000-0000-0000-000000000000'
     AND NOT COALESCE(NEW.auto_refunded, false)
  THEN
    PERFORM public.refund_failed_order(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_refund ON public.orders;

CREATE TRIGGER trg_auto_refund
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trigger_auto_refund();
