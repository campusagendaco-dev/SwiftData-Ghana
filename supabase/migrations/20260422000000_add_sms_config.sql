-- Add Twilio SMS configuration columns to system_settings
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS twilio_account_sid  text DEFAULT '' NOT NULL,
  ADD COLUMN IF NOT EXISTS twilio_auth_token   text DEFAULT '' NOT NULL,
  ADD COLUMN IF NOT EXISTS twilio_from_number  text DEFAULT '' NOT NULL;
