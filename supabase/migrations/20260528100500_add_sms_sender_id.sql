-- Migration to add SMS Sender ID fields to profiles

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS sms_sender_id TEXT,
ADD COLUMN IF NOT EXISTS sms_sender_status TEXT DEFAULT 'none';

COMMENT ON COLUMN public.profiles.sms_sender_id IS 'The requested custom SMS Sender ID (max 11 chars)';
COMMENT ON COLUMN public.profiles.sms_sender_status IS 'Status of the custom Sender ID: none, pending, approved, rejected';
