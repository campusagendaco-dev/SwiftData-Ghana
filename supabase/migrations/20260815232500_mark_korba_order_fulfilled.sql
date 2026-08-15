-- Migration: Manually Fulfill Korba Order Confirmed Delivered
DO $$
DECLARE
  v_order RECORD;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = 'efd12969-6434-4e4a-8464-4030e1e492ed';

  IF FOUND THEN
    UPDATE public.orders
    SET 
      status = 'fulfilled',
      profit_credited = true,
      updated_at = now()
    WHERE id = 'efd12969-6434-4e4a-8464-4030e1e492ed';

    INSERT INTO public.system_logs (level, source, event, message, order_id, agent_id, data)
    VALUES (
      'info', 'admin', 'order.fulfilled',
      'Order marked fulfilled after Korba confirmed delivery',
      'efd12969-6434-4e4a-8464-4030e1e492ed', v_order.agent_id,
      jsonb_build_object('recipient', v_order.customer_phone, 'network', v_order.network, 'package_size', v_order.package_size)
    );

    IF v_order.agent_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users WHERE id = v_order.agent_id) THEN
      INSERT INTO public.user_notifications (user_id, title, message, type, data)
      VALUES (
        v_order.agent_id,
        'Order Completed',
        format('Your order for %s %s to %s has been completed.', v_order.network, v_order.package_size, v_order.customer_phone),
        'success',
        jsonb_build_object('order_id', 'efd12969-6434-4e4a-8464-4030e1e492ed')
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END $$;
