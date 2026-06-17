-- Migration: Live Match Sync RPC and pg_cron Scheduler
-- Creates public.system_settle_world_cup_match_v2 and registers sync-football-matches hourly job.

-- 1. Create secure system settlement RPC function
CREATE OR REPLACE FUNCTION public.system_settle_world_cup_match_v2(
  p_match_id TEXT,
  p_result TEXT,
  p_points INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pred RECORD;
  v_winners_count INTEGER := 0;
BEGIN
  -- Update match status in world_cup_matches
  UPDATE public.world_cup_matches
  SET status = 'settled', result = p_result, updated_at = now()
  WHERE id = p_match_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'message', 'Match already settled or not found');
  END IF;

  -- Update states for correct predictions
  UPDATE public.world_cup_predictions
  SET status = 'correct', updated_at = now()
  WHERE match_id = p_match_id AND prediction = p_result;

  -- Update states for incorrect predictions
  UPDATE public.world_cup_predictions
  SET status = 'incorrect', updated_at = now()
  WHERE match_id = p_match_id AND prediction != p_result;

  -- Award points to correct predictions
  FOR v_pred IN 
    SELECT id, user_id 
    FROM public.world_cup_predictions 
    WHERE match_id = p_match_id AND status = 'correct' AND points_awarded = FALSE
  LOOP
    -- Increment user's loyalty balance in wallets table
    UPDATE public.wallets
    SET loyalty_balance = loyalty_balance + p_points, updated_at = now()
    WHERE agent_id = v_pred.user_id;

    -- Mark points as awarded
    UPDATE public.world_cup_predictions
    SET points_awarded = TRUE
    WHERE id = v_pred.id;

    v_winners_count := v_winners_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true, 
    'winners_rewarded', v_winners_count,
    'points_per_winner', p_points
  );
END;
$$;

-- 2. Restrict execute access
REVOKE EXECUTE ON FUNCTION public.system_settle_world_cup_match_v2(TEXT, TEXT, INTEGER) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_settle_world_cup_match_v2(TEXT, TEXT, INTEGER) TO service_role;

-- 3. Unschedule old sync cron job if it exists
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'sync-football-matches-job';

-- 4. Schedule the sync-football-matches job to run every hour at minute 0
SELECT cron.schedule(
  'sync-football-matches-job',
  '0 * * * *',
  $$
  SELECT net.http_post(
      url:='https://lsocdjpflecduumopijn.supabase.co/functions/v1/sync-football-matches',
      headers:=json_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'supabase_service_role' LIMIT 1
        )
      )::jsonb,
      body:='{}'::jsonb
  );
  $$
);
