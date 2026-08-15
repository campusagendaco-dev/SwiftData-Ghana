-- Migration: Helper RPC to list all agents affected by Sentinel automated deductions

CREATE OR REPLACE FUNCTION public.admin_get_sentinel_affected_agents()
RETURNS TABLE (
  agent_id UUID,
  agent_name TEXT,
  email TEXT,
  phone TEXT,
  current_wallet_balance NUMERIC,
  total_deducted_ghs NUMERIC,
  incident_count BIGINT,
  last_deduction_date TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.agent_id,
    COALESCE(p.full_name, p.store_name, 'Agent ' || LEFT(s.agent_id::text, 8))::text AS agent_name,
    COALESCE(p.email, 'N/A')::text AS email,
    COALESCE(p.whatsapp_number, p.support_number, 'N/A')::text AS phone,
    COALESCE(w.balance, 0)::numeric AS current_wallet_balance,
    SUM((s.data->>'deducted')::numeric)::numeric AS total_deducted_ghs,
    COUNT(*)::bigint AS incident_count,
    MAX(s.created_at) AS last_deduction_date
  FROM public.system_logs s
  LEFT JOIN public.profiles p ON p.user_id = s.agent_id
  LEFT JOIN public.wallets w ON w.agent_id = s.agent_id
  WHERE s.event = 'wallet.audit_auto_corrected'
    AND s.agent_id IS NOT NULL
    AND (s.data->>'deducted')::numeric > 0
  GROUP BY s.agent_id, p.full_name, p.store_name, p.email, p.whatsapp_number, p.support_number, w.balance
  ORDER BY total_deducted_ghs DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_sentinel_affected_agents() TO authenticated;
