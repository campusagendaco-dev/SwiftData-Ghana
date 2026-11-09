-- Smoke test for claim_location_sms. Everything runs inside a transaction that is rolled back.
-- Run against a non-production database after the migration 20261109120000 is applied.
BEGIN;

DO $$
DECLARE
  v_user_a uuid;
  v_user_b uuid;
  v_ids uuid[];
  v_result text;
  v_count int;
BEGIN
  SELECT array_agg(id) INTO v_ids FROM (SELECT id FROM auth.users LIMIT 2) u;
  IF v_ids IS NULL OR array_length(v_ids, 1) < 2 THEN
    RAISE EXCEPTION 'smoke test needs at least two rows in auth.users';
  END IF;
  v_user_a := v_ids[1];
  v_user_b := v_ids[2];

  -- Neither user may already have a recent SMS, or the 30-day check would fire early.
  IF EXISTS (
    SELECT 1 FROM public.user_location_towns
    WHERE user_id IN (v_user_a, v_user_b) AND sms_sent_at > now() - interval '30 days'
  ) THEN
    RAISE EXCEPTION 'test users already have a recent location SMS; pick a clean database';
  END IF;

  -- Rows: user A has two towns, user B has one. All unsent.
  INSERT INTO public.user_location_towns (user_id, town_key, town_name)
  VALUES (v_user_a, 'smoke_town_a', 'Smoke Town A'),
         (v_user_a, 'smoke_town_b', 'Smoke Town B'),
         (v_user_b, 'smoke_town_c', 'Smoke Town C');

  -- 1. A claim for a row returns claimed
  v_result := public.claim_location_sms(v_user_a, 'smoke_town_a', 1000000);
  IF v_result IS DISTINCT FROM 'claimed' THEN
    RAISE EXCEPTION 'expected claimed, got %', v_result;
  END IF;

  -- 2. Repeating the same claim (two tabs) returns already_sent and leaves one sms_sent_at
  v_result := public.claim_location_sms(v_user_a, 'smoke_town_a', 1000000);
  IF v_result IS DISTINCT FROM 'already_sent' THEN
    RAISE EXCEPTION 'expected already_sent, got %', v_result;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.user_location_towns
  WHERE user_id = v_user_a AND sms_sent_at IS NOT NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one sms_sent_at for user A, got %', v_count;
  END IF;

  -- 3. A different town for the same user returns limit_30d
  v_result := public.claim_location_sms(v_user_a, 'smoke_town_b', 1000000);
  IF v_result IS DISTINCT FROM 'limit_30d' THEN
    RAISE EXCEPTION 'expected limit_30d, got %', v_result;
  END IF;

  -- 4. With a limit of 0, a different user (no recent SMS) returns daily_limit
  v_result := public.claim_location_sms(v_user_b, 'smoke_town_c', 0);
  IF v_result IS DISTINCT FROM 'daily_limit' THEN
    RAISE EXCEPTION 'expected daily_limit, got %', v_result;
  END IF;

  -- 5. A missing row returns no_row
  v_result := public.claim_location_sms(v_user_b, 'smoke_town_missing', 1000000);
  IF v_result IS DISTINCT FROM 'no_row' THEN
    RAISE EXCEPTION 'expected no_row, got %', v_result;
  END IF;

  -- 6. The public view does not expose the new settings
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'public_system_settings'
      AND column_name IN ('location_sms_mode', 'location_sms_daily_limit')
  ) THEN
    RAISE EXCEPTION 'public_system_settings must not expose location_sms_* columns';
  END IF;

  RAISE NOTICE 'location_welcome_sms smoke test passed';
END;
$$;

ROLLBACK;
