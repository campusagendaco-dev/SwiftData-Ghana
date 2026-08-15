-- RPC to inspect order details and logs for a phone number
CREATE OR REPLACE FUNCTION public.admin_inspect_order_by_phone(p_phone TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order RECORD;
  v_logs JSONB;
BEGIN
  SELECT * INTO v_order 
  FROM public.orders 
  WHERE recipient LIKE '%' || p_phone || '%'
  ORDER BY created_at DESC 
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'message', 'No order found for recipient ' || p_phone);
  END IF;

  SELECT jsonb_agg(l) INTO v_logs
  FROM (
    SELECT id, event, message, source, data
    FROM public.system_logs
    WHERE order_id = v_order.id
  ) l;

  RETURN jsonb_build_object(
    'found', true,
    'order', to_jsonb(v_order),
    'logs', COALESCE(v_logs, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_inspect_order_by_phone(text) TO authenticated, anon;
