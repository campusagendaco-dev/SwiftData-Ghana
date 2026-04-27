-- Fix public_system_settings view to include missing free_data columns
CREATE OR REPLACE VIEW public.public_system_settings AS
SELECT
  id,
  holiday_mode_enabled,
  holiday_message,
  disable_ordering,
  dark_mode_enabled,
  store_visitor_popup_enabled,
  customer_service_number,
  support_channel_link,
  free_data_enabled,
  free_data_network,
  free_data_package_size,
  free_data_max_claims,
  free_data_claims_count,
  auto_pending_sms_enabled,
  mtn_markup_percentage,
  telecel_markup_percentage,
  at_markup_percentage,
  updated_at
FROM public.system_settings;

GRANT SELECT ON public.public_system_settings TO anon, authenticated;
