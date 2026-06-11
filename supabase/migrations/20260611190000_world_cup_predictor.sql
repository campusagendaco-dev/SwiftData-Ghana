-- World Cup Predictions Migration
-- Creates world_cup_predictions table, establishes security policies, and defines RPC functions

-- 1. Create predictions table
CREATE TABLE IF NOT EXISTS public.world_cup_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  match_id TEXT NOT NULL,
  prediction TEXT NOT NULL CHECK (prediction IN ('home', 'draw', 'away')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'correct', 'incorrect')),
  points_awarded BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique index to prevent duplicate predictions for a single match per user
CREATE UNIQUE INDEX IF NOT EXISTS world_cup_predictions_user_match_idx ON public.world_cup_predictions(user_id, match_id);

-- Enable RLS
ALTER TABLE public.world_cup_predictions ENABLE ROW LEVEL SECURITY;

-- 2. Define RLS Policies
DROP POLICY IF EXISTS "Users can read own predictions" ON public.world_cup_predictions;
CREATE POLICY "Users can read own predictions" ON public.world_cup_predictions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users can insert own predictions" ON public.world_cup_predictions;
CREATE POLICY "Users can insert own predictions" ON public.world_cup_predictions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can manage all predictions" ON public.world_cup_predictions;
CREATE POLICY "Admins can manage all predictions" ON public.world_cup_predictions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Define RPC: Submit Prediction
CREATE OR REPLACE FUNCTION public.submit_world_cup_prediction(
  p_match_id TEXT,
  p_prediction TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_existing_id UUID;
  v_existing_status TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated');
  END IF;

  -- Check if prediction already exists
  SELECT id, status INTO v_existing_id, v_existing_status
  FROM public.world_cup_predictions
  WHERE user_id = v_user_id AND match_id = p_match_id;

  IF v_existing_id IS NOT NULL THEN
    -- If already settled, do not allow changing prediction
    IF v_existing_status != 'pending' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Match already settled. Cannot change prediction.');
    END IF;

    -- Update existing prediction
    UPDATE public.world_cup_predictions
    SET prediction = p_prediction, updated_at = now()
    WHERE id = v_existing_id;
  ELSE
    -- Insert new prediction
    INSERT INTO public.world_cup_predictions (user_id, match_id, prediction)
    VALUES (v_user_id, p_match_id, p_prediction);
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Define RPC: Settle Match (Admin Only)
CREATE OR REPLACE FUNCTION public.settle_world_cup_match(
  p_match_id TEXT,
  p_result TEXT,
  p_points INTEGER
)
RETURNS JSONB AS $$
DECLARE
  v_admin_id UUID;
  v_pred RECORD;
  v_winners_count INTEGER := 0;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT public.has_role(v_admin_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Admin privileges required.');
  END IF;

  -- 1. Update states for correct predictions
  UPDATE public.world_cup_predictions
  SET status = 'correct', updated_at = now()
  WHERE match_id = p_match_id AND prediction = p_result;

  -- 2. Update states for incorrect predictions
  UPDATE public.world_cup_predictions
  SET status = 'incorrect', updated_at = now()
  WHERE match_id = p_match_id AND prediction != p_result;

  -- 3. Award points to correct predictions
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
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant select/execute permissions to authenticated/anon roles
GRANT SELECT ON public.world_cup_predictions TO authenticated, anon;
GRANT ALL ON public.world_cup_predictions TO service_role;
