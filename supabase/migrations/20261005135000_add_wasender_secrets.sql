-- Add WaSender credentials to system_secrets
ALTER TABLE IF EXISTS public.system_secrets
  ADD COLUMN IF NOT EXISTS wasender_personal_token text,
  ADD COLUMN IF NOT EXISTS wasender_session_id text;
