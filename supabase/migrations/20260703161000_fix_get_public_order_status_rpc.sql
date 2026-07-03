-- Fix get_public_order_status RPC by removing the non-existent payment_reference column
CREATE OR REPLACE FUNCTION public.get_public_order_status(p_reference TEXT)
RETURNS TABLE (
  id UUID,
  created_at TIMESTAMP WITH TIME ZONE,
  status TEXT,
  network TEXT,
  package_size TEXT,
  customer_phone TEXT,
  order_type TEXT,
  failure_reason TEXT
)
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Perform check using UUID regex to differentiate UUID match vs metadata match
  IF p_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN QUERY
    SELECT 
      o.id, 
      o.created_at, 
      o.status::TEXT, 
      o.network, 
      o.package_size, 
      o.customer_phone, 
      o.order_type, 
      o.failure_reason
    FROM public.orders o
    WHERE o.id = p_reference::UUID 
       OR o.metadata->>'client_reference' = p_reference
    LIMIT 1;
  ELSE
    RETURN QUERY
    SELECT 
      o.id, 
      o.created_at, 
      o.status::TEXT, 
      o.network, 
      o.package_size, 
      o.customer_phone, 
      o.order_type, 
      o.failure_reason
    FROM public.orders o
    WHERE o.metadata->>'client_reference' = p_reference
    LIMIT 1;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions to anon and authenticated roles
GRANT EXECUTE ON FUNCTION public.get_public_order_status(TEXT) TO anon, authenticated;
