-- Fast investigation RPC for system_logs & audit_logs
CREATE OR REPLACE FUNCTION public.admin_investigate_deductions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auto_corrected_count INT;
  v_sentinel_refunded_count INT;
  v_recent_sample JSONB;
BEGIN
  SELECT COUNT(*) INTO v_auto_corrected_count 
  FROM public.system_logs 
  WHERE event = 'wallet.audit_auto_corrected';

  SELECT COUNT(*) INTO v_sentinel_refunded_count 
  FROM public.system_logs 
  WHERE event = 'wallet.sentinel_deduction_refunded';

  SELECT jsonb_agg(sub) INTO v_recent_sample
  FROM (
    SELECT id, event, source, agent_id, data 
    FROM public.system_logs 
    ORDER BY id DESC 
    LIMIT 20
  ) sub;
  
  RETURN jsonb_build_object(
    'auto_corrected_count', v_auto_corrected_count,
    'sentinel_refunded_count', v_sentinel_refunded_count,
    'recent_logs_sample', v_recent_sample
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_investigate_deductions() TO authenticated;
