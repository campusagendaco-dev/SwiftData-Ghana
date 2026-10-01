-- Migration: Enable Automated "We Missed You" SMS Channel & Edge Function Cron Integration
-- Description: Adds SMS tracking column to profiles, defines safe capped inactive SMS fetch RPC, and updates morning & evening pg_cron jobs to trigger cron-winback-push.

-- 1. Add missed_you_sms_sent_at column to profiles
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS missed_you_sms_sent_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Create RPC to fetch inactive users who have a valid phone number and are eligible for win-back SMS
CREATE OR REPLACE FUNCTION public.get_inactive_winback_sms_users(
  p_inactive_hours INT DEFAULT 24,
  p_limit INT DEFAULT 25,
  p_cooldown_hours INT DEFAULT 48
)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  phone TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    p.user_id,
    p.full_name,
    p.phone
  FROM public.profiles p
  WHERE (p.is_suspended IS FALSE OR p.is_suspended IS NULL)
    AND p.phone IS NOT NULL 
    AND LENGTH(TRIM(p.phone)) >= 9
    AND (p.missed_you_sms_sent_at IS NULL OR p.missed_you_sms_sent_at <= (NOW() - (p_cooldown_hours || ' hours')::INTERVAL))
    AND NOT EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.agent_id = p.user_id
        AND o.created_at >= (NOW() - (p_inactive_hours || ' hours')::INTERVAL)
    )
  ORDER BY p.missed_you_sms_sent_at ASC NULLS FIRST, p.created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_inactive_winback_sms_users(INT, INT, INT) TO service_role, authenticated;

-- 3. Create helper RPC to update missed_you_sms_sent_at after SMS delivery
CREATE OR REPLACE FUNCTION public.mark_missed_you_sms_sent(p_user_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_ids IS NOT NULL AND ARRAY_LENGTH(p_user_ids, 1) > 0 THEN
    UPDATE public.profiles
    SET missed_you_sms_sent_at = NOW()
    WHERE user_id = ANY(p_user_ids);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_missed_you_sms_sent(UUID[]) TO service_role, authenticated;

-- 4. Update pg_cron jobs to invoke cron-winback-push Edge Function twice daily (10:00 AM & 6:00 PM UTC)
SELECT cron.unschedule('cron-missed-you-morning')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-missed-you-morning');

SELECT cron.unschedule('cron-missed-you-evening')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-missed-you-evening');

SELECT cron.schedule(
  'cron-missed-you-morning',
  '0 10 * * *',
  $$
    SELECT net.http_post(
      url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/cron-winback-push',
      headers := json_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'supabase_service_role' LIMIT 1
        )
      )::jsonb,
      body := '{"send_push": true, "send_sms": true, "sms_limit": 25, "inactive_hours": 24}'::jsonb
    );
  $$
);

SELECT cron.schedule(
  'cron-missed-you-evening',
  '0 18 * * *',
  $$
    SELECT net.http_post(
      url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/cron-winback-push',
      headers := json_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'supabase_service_role' LIMIT 1
        )
      )::jsonb,
      body := '{"send_push": true, "send_sms": true, "sms_limit": 25, "inactive_hours": 24}'::jsonb
    );
  $$
);
