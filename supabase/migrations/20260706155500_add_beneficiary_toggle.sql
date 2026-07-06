-- Migration: Add beneficiary_verification_enabled to system_settings
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS beneficiary_verification_enabled BOOLEAN NOT NULL DEFAULT true;

-- Drop the view first to avoid column mismatch issues when recreating it
DROP VIEW IF EXISTS public.v_system_settings_with_secrets;

-- Recreate the view to include the new column
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

-- Grant select on the view to service_role
REVOKE ALL ON public.v_system_settings_with_secrets FROM anon, authenticated;
GRANT SELECT ON public.v_system_settings_with_secrets TO service_role;
