-- Migration: Add dynamic AI model configuration settings
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS active_sentinel_model TEXT DEFAULT 'claude-haiku-4-5-20251001';
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS active_oracle_model TEXT DEFAULT 'claude-3-5-sonnet-latest';

-- Recreate v_system_settings_with_secrets to include the new columns
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
