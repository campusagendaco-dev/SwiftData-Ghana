-- Migration: Add auto_refund_enabled settings column and update auto-refund trigger

ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS auto_refund_enabled BOOLEAN NOT NULL DEFAULT FALSE;

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
     AND NEW.payment_method IN ('wallet', 'balance')
     AND NOT COALESCE(NEW.auto_refunded, false)
  THEN
    PERFORM public.refund_failed_order(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_refund ON public.orders;
CREATE TRIGGER trg_auto_refund
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trigger_auto_refund();
