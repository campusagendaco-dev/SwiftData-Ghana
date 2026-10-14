-- Migration: Add AFARegistration.com provider (AFA registrations + Airtime)
-- AFA routing:     AFARegistration (primary) -> Spendless (fallback)  [resolveProvidersForOrder]
-- Airtime routing: Korba (primary) -> AFARegistration (fallback, by priority)
-- Credentials come from Supabase secrets AFA_API_KEY / AFA_WEBHOOK_SECRET (env takes priority over DB).
-- Webhook URL to configure on afaregistration.com: https://<project>.supabase.co/functions/v1/provider-webhook

INSERT INTO public.providers (name, provider_type, handler_type, base_url, is_active, priority, settings)
VALUES (
  'AFARegistration',
  'airtime',
  'afaregistration',
  'https://afaregistration.com/api',
  true,
  5,
  '{"supports": ["afa", "airtime"]}'::jsonb
)
ON CONFLICT (name) DO UPDATE
  SET handler_type = EXCLUDED.handler_type,
      base_url     = EXCLUDED.base_url,
      provider_type = EXCLUDED.provider_type,
      updated_at   = now();

-- AFARegistration charges GH₵15 per registration: reprice AFA so every tier is profitable.
-- AFA stays unavailable (is_unavailable = true) until the AFARegistration wallet is funded.
UPDATE public.global_package_settings
SET public_price    = 18.00,
    agent_price     = 17.00,
    sub_agent_price = 17.00,
    api_price       = 16.50,
    cost_price      = 15.00,
    is_unavailable  = true,
    updated_at      = now()
WHERE network = 'AFA' AND package_size = 'BUNDLE';
