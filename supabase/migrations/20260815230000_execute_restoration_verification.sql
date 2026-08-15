-- Migration: Execute Sentinel Balance Restoration in Postgres Engine
DO $$
DECLARE
  v_res JSONB;
BEGIN
  v_res := public.admin_restore_sentinel_deductions();
  RAISE NOTICE 'RESTORATION EXECUTION RESULT: %', v_res;
END $$;
