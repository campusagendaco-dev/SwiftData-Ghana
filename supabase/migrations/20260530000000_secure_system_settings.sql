-- Migration to separate secrets from public system_settings

-- 1. Create system_secrets table
CREATE TABLE IF NOT EXISTS public.system_secrets (
  id INT PRIMARY KEY REFERENCES public.system_settings(id) ON DELETE CASCADE,
  paystack_secret_key TEXT,
  hubtel_client_id TEXT,
  hubtel_client_secret TEXT,
  txtconnect_api_key TEXT,
  txtconnect_sender_id TEXT,
  data_provider_api_key TEXT,
  data_provider_base_url TEXT,
  secondary_data_provider_api_key TEXT,
  secondary_data_provider_base_url TEXT,
  airtime_provider_api_key TEXT,
  airtime_provider_base_url TEXT
);

ALTER TABLE public.system_secrets ENABLE ROW LEVEL SECURITY;
-- No policies granted to anon or authenticated. Only service_role can access.

-- 2. Migrate existing data from system_settings to system_secrets
INSERT INTO public.system_secrets (
  id, 
  paystack_secret_key, 
  hubtel_client_id, 
  hubtel_client_secret, 
  txtconnect_api_key, 
  txtconnect_sender_id,
  data_provider_api_key,
  data_provider_base_url,
  secondary_data_provider_api_key,
  secondary_data_provider_base_url,
  airtime_provider_api_key,
  airtime_provider_base_url
)
SELECT 
  id, 
  paystack_secret_key, 
  hubtel_client_id, 
  hubtel_client_secret, 
  txtconnect_api_key, 
  txtconnect_sender_id,
  data_provider_api_key,
  data_provider_base_url,
  secondary_data_provider_api_key,
  secondary_data_provider_base_url,
  airtime_provider_api_key,
  airtime_provider_base_url
FROM public.system_settings
ON CONFLICT (id) DO UPDATE SET
  paystack_secret_key = EXCLUDED.paystack_secret_key,
  hubtel_client_id = EXCLUDED.hubtel_client_id,
  hubtel_client_secret = EXCLUDED.hubtel_client_secret,
  txtconnect_api_key = EXCLUDED.txtconnect_api_key,
  txtconnect_sender_id = EXCLUDED.txtconnect_sender_id,
  data_provider_api_key = EXCLUDED.data_provider_api_key,
  data_provider_base_url = EXCLUDED.data_provider_base_url,
  secondary_data_provider_api_key = EXCLUDED.secondary_data_provider_api_key,
  secondary_data_provider_base_url = EXCLUDED.secondary_data_provider_base_url,
  airtime_provider_api_key = EXCLUDED.airtime_provider_api_key,
  airtime_provider_base_url = EXCLUDED.airtime_provider_base_url;

-- 3. Drop sensitive columns from system_settings
-- We use IF EXISTS to ensure migration runs safely if run multiple times
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='system_settings' AND column_name='paystack_secret_key') THEN
    ALTER TABLE public.system_settings 
      DROP COLUMN paystack_secret_key,
      DROP COLUMN hubtel_client_id,
      DROP COLUMN hubtel_client_secret,
      DROP COLUMN txtconnect_api_key,
      DROP COLUMN txtconnect_sender_id,
      DROP COLUMN data_provider_api_key,
      DROP COLUMN data_provider_base_url,
      DROP COLUMN secondary_data_provider_api_key,
      DROP COLUMN secondary_data_provider_base_url,
      DROP COLUMN airtime_provider_api_key,
      DROP COLUMN airtime_provider_base_url;
  END IF;
END $$;

-- 4. Create a view for edge functions to use (joins settings and secrets)
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

-- Grant access ONLY to service_role, not anon/authenticated
REVOKE ALL ON public.v_system_settings_with_secrets FROM anon, authenticated;
GRANT SELECT ON public.v_system_settings_with_secrets TO service_role;

