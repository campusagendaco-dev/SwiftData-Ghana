-- Migration: Restoration RPC & Auto-Refund for Sentinel Deductions
-- Reverses all incorrect deductions logged by sentinel in system_logs and restores balances to affected agents.

CREATE OR REPLACE FUNCTION public.admin_restore_sentinel_deductions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec RECORD;
  v_agent_id UUID;
  v_deducted NUMERIC;
  v_total_restored NUMERIC := 0;
  v_agents_restored INT := 0;
BEGIN
  -- Loop through system_logs entries where sentinel auto-corrected balances
  FOR v_rec IN 
    SELECT 
      agent_id, 
      SUM((data->>'deducted')::numeric) as total_deducted,
      COUNT(*) as incident_count
    FROM public.system_logs
    WHERE event = 'wallet.audit_auto_corrected'
      AND agent_id IS NOT NULL
      AND (data->>'deducted')::numeric > 0
    GROUP BY agent_id
  LOOP
    v_agent_id := v_rec.agent_id;
    v_deducted := v_rec.total_deducted;

    IF v_deducted > 0 THEN
      -- 1. Credit back the exact deducted amount to the wallet
      UPDATE public.wallets
      SET balance = balance + v_deducted,
          updated_at = now()
      WHERE agent_id = v_agent_id;

      v_total_restored := v_total_restored + v_deducted;
      v_agents_restored := v_agents_restored + 1;

      -- 2. Log the restoration in system_logs
      INSERT INTO public.system_logs (level, source, event, message, agent_id, data)
      VALUES (
        'info', 'sentinel_restoration', 'wallet.sentinel_deduction_refunded',
        format('Restored GHS %s to wallet following Sentinel audit fix (%s sentinel deduction(s) reversed)', v_deducted, v_rec.incident_count),
        v_agent_id,
        jsonb_build_object('restored_amount', v_deducted, 'incident_count', v_rec.incident_count)
      );

      -- 3. Safely send in-app notification if user exists in auth.users
      BEGIN
        IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_agent_id) THEN
          INSERT INTO public.user_notifications (user_id, title, message, type, data)
          VALUES (
            v_agent_id,
            'Wallet Balance Restored',
            format('GH₵ %s has been restored to your wallet following our automated audit correction.', TRIM(TO_CHAR(v_deducted, '999990.00'))),
            'info',
            jsonb_build_object('amount', v_deducted, 'type', 'sentinel_restoration')
          )
          ON CONFLICT DO NOTHING;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- Ignore notification failure so balance restoration is never blocked
        NULL;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'agents_restored', v_agents_restored,
    'total_amount_restored', v_total_restored,
    'message', format('Restoration complete: GH₵ %s restored across %s agents.', v_total_restored, v_agents_restored)
  );
END;
$$;

-- Grant execution to authenticated role
GRANT EXECUTE ON FUNCTION public.admin_restore_sentinel_deductions() TO authenticated;
