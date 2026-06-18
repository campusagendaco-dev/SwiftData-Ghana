-- Migration: Fix Prediction Submission Security and Immutability
-- Date: 2026-06-18
-- Adds server-side kickoff checks and makes predictions immutable.

CREATE OR REPLACE FUNCTION public.submit_world_cup_prediction(
  p_match_id TEXT,
  p_prediction TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_kickoff TIMESTAMPTZ;
  v_match_status TEXT;
  v_existing_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated');
  END IF;

  -- 1. Get kickoff time and status of the match
  SELECT kickoff, status INTO v_kickoff, v_match_status
  FROM public.world_cup_matches
  WHERE id = p_match_id;

  IF v_kickoff IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match not found.');
  END IF;

  -- 2. Kickoff time check: reject if match has already started
  IF v_kickoff <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match has already started. Predictions are locked.');
  END IF;

  -- 3. Match status check: reject if match is already settled
  IF v_match_status = 'settled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match has already been settled.');
  END IF;

  -- 4. Immutability check: once submitted, prediction cannot be changed
  SELECT id INTO v_existing_id
  FROM public.world_cup_predictions
  WHERE user_id = v_user_id AND match_id = p_match_id;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Prediction already submitted and cannot be changed.');
  END IF;

  -- 5. Insert new prediction
  INSERT INTO public.world_cup_predictions (user_id, match_id, prediction)
  VALUES (v_user_id, p_match_id, p_prediction);

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.submit_world_cup_prediction(TEXT, TEXT) TO authenticated;
