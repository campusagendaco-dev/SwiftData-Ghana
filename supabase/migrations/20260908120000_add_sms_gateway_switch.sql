-- Migration: Add active_sms_gateway and multi-gateway secret storage
-- Enables dynamic switching between TxtConnect, mNotify, Korba, Arkesel, and Hubtel.

-- 1. Add active_sms_gateway column to system_settings
ALTER TABLE public.system_settings 
ADD COLUMN IF NOT EXISTS active_sms_gateway TEXT NOT NULL DEFAULT 'txtconnect';

-- 2. Add gateway credentials to system_secrets
ALTER TABLE public.system_secrets 
ADD COLUMN IF NOT EXISTS mnotify_api_key TEXT,
ADD COLUMN IF NOT EXISTS mnotify_sender_id TEXT,
ADD COLUMN IF NOT EXISTS arkesel_api_key TEXT,
ADD COLUMN IF NOT EXISTS arkesel_sender_id TEXT,
ADD COLUMN IF NOT EXISTS hubtel_sms_sender_id TEXT;

-- 3. Recreate v_system_settings_with_secrets view
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
  sec.airtime_provider_base_url,
  sec.mnotify_api_key,
  sec.mnotify_sender_id,
  sec.arkesel_api_key,
  sec.arkesel_sender_id,
  sec.hubtel_sms_sender_id
FROM public.system_settings s
LEFT JOIN public.system_secrets sec ON s.id = sec.id;

REVOKE ALL ON public.v_system_settings_with_secrets FROM anon, authenticated;
GRANT SELECT ON public.v_system_settings_with_secrets TO service_role;
