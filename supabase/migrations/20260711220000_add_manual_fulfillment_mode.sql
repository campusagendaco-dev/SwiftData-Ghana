-- Migration: Add manual_fulfillment_mode to system_settings
-- Description: Adds a toggle to system_settings to route all orders to the manual processing queue (status = 'processing') instead of hitting the live APIs.

ALTER TABLE public.system_settings 
ADD COLUMN IF NOT EXISTS manual_fulfillment_mode BOOLEAN NOT NULL DEFAULT false;

-- 1. Recreate public_system_settings view
DROP VIEW IF EXISTS public.public_system_settings CASCADE;
CREATE OR REPLACE VIEW public.public_system_settings AS
SELECT 
  id,
  auto_api_switch,
  holiday_mode_enabled,
  holiday_message,
  disable_ordering,
  dark_mode_enabled,
  store_visitor_popup_enabled,
  customer_service_number,
  support_channel_link,
  mtn_markup_percentage,
  telecel_markup_percentage,
  at_markup_percentage,
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
  agent_activation_fee,
  sub_agent_base_fee,
  wassce_price,
  bece_price,
  show_scrolling_ad,
  scrolling_ad_text,
  scrolling_ad_image_url,
  traditional_background_enabled,
  background_custom_image_url,
  enable_privacy_shield,
  maintenance_mode,
  maintenance_message,
  maintenance_started_at,
  maintenance_eta,
  withdrawal_auto_approve_enabled,
  withdrawal_auto_approve_max_amount,
  withdrawal_auto_approve_min_age_days,
  withdrawal_auto_approve_require_no_chargebacks,
  free_agent_promo_enabled,
  free_agent_promo_limit,
  free_agent_promo_claimed,
  tutorial_buy_video_url,
  tutorial_agent_video_url,
  tutorial_subagent_video_url,
  manual_fulfillment_mode,
  updated_at
FROM public.system_settings;

GRANT SELECT ON public.public_system_settings TO anon, authenticated, service_role;
COMMENT ON VIEW public.public_system_settings IS 'Unified public system settings view including manual fulfillment mode.';

-- 2. Recreate v_system_settings_with_secrets view
DROP VIEW IF EXISTS public.v_system_settings_with_secrets CASCADE;
CREATE OR REPLACE VIEW public.v_system_settings_with_secrets AS
SELECT 
  s.*,
  sec.paystack_secret_key,
  sec.hubtel_client_id,
  sec.hubtel_client_secret,
  sec.txtconnect_api_key,
  sec.txtconnect_sender_id,
  sec.data_provider_api_key,
  sec.data_provider_base_url,
  sec.secondary_data_provider_api_key,
  sec.secondary_data_provider_base_url,
  sec.airtime_provider_api_key,
  sec.airtime_provider_base_url
FROM public.system_settings s
LEFT JOIN public.system_secrets sec ON s.id = sec.id;

REVOKE ALL ON public.v_system_settings_with_secrets FROM anon, authenticated;
GRANT SELECT ON public.v_system_settings_with_secrets TO service_role;
