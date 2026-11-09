-- Location welcome SMS (phase 1): consent, town tracking, settings, template and atomic SMS claim.
-- Both new tables are reachable only through the backend (service_role). No client policies.

-- 1. Consent per user
CREATE TABLE IF NOT EXISTS public.location_alert_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'unset' CHECK (status IN ('unset', 'granted', 'declined')),
  prompted_at timestamptz,
  consent_at timestamptz,
  consent_version text,
  last_check_on date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Towns seen per user (no GPS coordinates are stored)
CREATE TABLE IF NOT EXISTS public.user_location_towns (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  town_key text NOT NULL,
  town_name text NOT NULL,
  first_seen_on date NOT NULL DEFAULT current_date,
  last_seen_on date NOT NULL DEFAULT current_date,
  days_seen integer NOT NULL DEFAULT 1,
  is_home boolean NOT NULL DEFAULT false,
  established_at timestamptz,
  sms_sent_at timestamptz,
  PRIMARY KEY (user_id, town_key)
);

CREATE INDEX IF NOT EXISTS idx_user_location_towns_sms_sent_at
  ON public.user_location_towns (sms_sent_at)
  WHERE sms_sent_at IS NOT NULL;

ALTER TABLE public.location_alert_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_location_towns ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.location_alert_preferences FROM anon, authenticated;
REVOKE ALL ON public.user_location_towns FROM anon, authenticated;

-- 3. Settings (system_settings is a single row; public_system_settings has an explicit column list,
--    so these columns are not exposed to the public view)
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS location_sms_mode text NOT NULL DEFAULT 'off'
    CHECK (location_sms_mode IN ('off', 'consent')),
  ADD COLUMN IF NOT EXISTS location_sms_daily_limit integer NOT NULL DEFAULT 200
    CHECK (location_sms_daily_limit >= 0);

-- 4. SMS template (editable on the SMS Templates admin page)
INSERT INTO public.sms_templates (key, label, body, is_active)
VALUES (
  'location_welcome',
  'Location welcome',
  'SwiftData GH works in {town} too! Buy cheap non-expiry data anytime: https://swiftdatagh.shop',
  true
)
ON CONFLICT (key) DO NOTHING;

-- 5. Atomic claim: once per town, one SMS per user per 30 days, global daily cap.
CREATE OR REPLACE FUNCTION public.claim_location_sms(
  p_user_id uuid,
  p_town_key text,
  p_daily_limit int
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sent_today int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('location_sms_claim'));

  IF EXISTS (
    SELECT 1 FROM public.user_location_towns
    WHERE user_id = p_user_id AND town_key = p_town_key AND sms_sent_at IS NOT NULL
  ) THEN
    RETURN 'already_sent';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_location_towns
    WHERE user_id = p_user_id AND sms_sent_at > now() - interval '30 days'
  ) THEN
    RETURN 'limit_30d';
  END IF;

  SELECT count(*) INTO v_sent_today
  FROM public.user_location_towns
  WHERE sms_sent_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  IF v_sent_today >= p_daily_limit THEN
    RETURN 'daily_limit';
  END IF;

  UPDATE public.user_location_towns
  SET sms_sent_at = now(), established_at = now()
  WHERE user_id = p_user_id AND town_key = p_town_key AND sms_sent_at IS NULL;

  IF NOT FOUND THEN
    RETURN 'no_row';
  END IF;

  RETURN 'claimed';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_location_sms(uuid, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_location_sms(uuid, text, int) TO service_role;
