-- Migration: Global Background Image Filters (Brightness, Contrast, Blueness)
-- Adds background_brightness, background_contrast, and background_blueness columns to system_settings, and updates public_system_settings view.

-- 1. Alter system_settings to add filter configuration columns
ALTER TABLE public.system_settings
ADD COLUMN IF NOT EXISTS background_brightness NUMERIC DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS background_contrast NUMERIC DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS background_blueness NUMERIC DEFAULT 0.0;

-- 2. Recreate public_system_settings view to include the new columns
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
  background_brightness,
  background_contrast,
  background_blueness,
  updated_at
FROM public.system_settings;

-- 3. Grant select permissions
GRANT SELECT ON public.public_system_settings TO anon, authenticated, service_role;
COMMENT ON VIEW public.public_system_settings IS 'Secured subset of system configurations visible to end users and dynamic layout hooks.';
