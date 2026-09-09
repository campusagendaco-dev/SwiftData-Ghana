-- Migration: Add txtconnect_cooldown_until for intelligent rate-limit circuit breaking
-- When TxtConnect returns 999 ("Too many request"), the system records the cooldown expiry here
-- and transparently diverts all SMS to mNotify/Korba until the lockout expires.

ALTER TABLE public.system_settings 
ADD COLUMN IF NOT EXISTS txtconnect_cooldown_until TIMESTAMP WITH TIME ZONE DEFAULT NULL;
