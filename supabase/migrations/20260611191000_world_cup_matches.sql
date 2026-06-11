-- Migration: World Cup Matches & Predictor Settings
-- Creates world_cup_matches table, adds enabled configuration column to system_settings, and updates public_system_settings view.

-- 1. Create matches table
CREATE TABLE IF NOT EXISTS public.world_cup_matches (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  home_team TEXT NOT NULL,
  home_flag TEXT NOT NULL,
  away_team TEXT NOT NULL,
  away_flag TEXT NOT NULL,
  kickoff TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'settled')),
  result TEXT CHECK (result IN ('home', 'draw', 'away')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.world_cup_matches ENABLE ROW LEVEL SECURITY;

-- 2. Define RLS Policies for matches
DROP POLICY IF EXISTS "Anyone can view matches" ON public.world_cup_matches;
CREATE POLICY "Anyone can view matches" ON public.world_cup_matches
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can manage matches" ON public.world_cup_matches;
CREATE POLICY "Admins can manage matches" ON public.world_cup_matches
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Seed default matches
INSERT INTO public.world_cup_matches (id, home_team, home_flag, away_team, away_flag, kickoff)
VALUES 
  ('wc_match_1', 'Ghana', '🇬🇭', 'Uruguay', '🇺🇾', '2026-06-12T15:00:00Z'),
  ('wc_match_2', 'Brazil', '🇧🇷', 'France', '🇫🇷', '2026-06-12T19:00:00Z'),
  ('wc_match_3', 'England', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'Senegal', '🇸🇳', '2026-06-13T16:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- 4. Alter system_settings to add enabled column
ALTER TABLE public.system_settings 
ADD COLUMN IF NOT EXISTS world_cup_predictor_enabled BOOLEAN DEFAULT TRUE;

-- 5. Recreate public_system_settings view to include the new columns
DROP VIEW IF EXISTS public.public_system_settings CASCADE;

CREATE OR REPLACE VIEW public.public_system_settings WITH (security_invoker = true) AS
SELECT
  id, 
  disable_ordering, 
  dark_mode_enabled, 
  store_visitor_popup_enabled,
  customer_service_number, 
  support_channel_link, 
  holiday_mode_enabled, 
  holiday_message,
  mtn_markup_percentage, 
  telecel_markup_percentage, 
  at_markup_percentage,
  auto_pending_sms_enabled, 
  show_announcement, 
  announcement_title, 
  announcement_message,
  free_data_enabled, 
  free_data_network, 
  free_data_package_size,
  free_data_max_claims, 
  free_data_claims_count,
  home_page_video_url, 
  home_page_video_muted,
  withdrawal_auto_approve_enabled, 
  withdrawal_auto_approve_max_amount,
  withdrawal_auto_approve_min_age_days, 
  withdrawal_auto_approve_require_no_chargebacks,
  min_withdrawal_amount, 
  max_withdrawal_amount, 
  withdrawal_system_enabled,
  paystack_deposit_fee_percent, 
  withdrawal_fee_flat, 
  withdrawal_fee_percent,
  traditional_background_enabled, 
  background_custom_image_url, 
  enable_privacy_shield,
  show_scrolling_ad, 
  scrolling_ad_text, 
  scrolling_ad_image_url,
  agent_activation_fee, 
  sub_agent_base_fee, 
  wassce_price, 
  bece_price,
  maintenance_mode, 
  maintenance_message, 
  whatsapp_bot_prompt,
  auto_api_switch,
  tutorial_buy_video_url, 
  tutorial_agent_video_url, 
  tutorial_subagent_video_url,
  free_agent_promo_enabled,
  free_agent_promo_limit,
  free_agent_promo_claimed,
  notification_tone,
  notification_vibration_enabled,
  notification_vibration_pattern,
  ai_recommender_enabled,
  world_cup_predictor_enabled,
  updated_at
FROM public.system_settings;

-- Grant select permissions
GRANT SELECT ON public.public_system_settings TO anon, authenticated, service_role;
COMMENT ON VIEW public.public_system_settings IS 'Secured subset of system configurations visible to end users and dynamic layout hooks.';

-- 6. Redefine settle_world_cup_match to also settle the match status in world_cup_matches table
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

  -- Update match result/status in world_cup_matches
  UPDATE public.world_cup_matches
  SET status = 'settled', result = p_result, updated_at = now()
  WHERE id = p_match_id;

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
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant table access to authenticated, anon and service_role
GRANT SELECT ON public.world_cup_matches TO authenticated, anon;
GRANT ALL ON public.world_cup_matches TO service_role;
