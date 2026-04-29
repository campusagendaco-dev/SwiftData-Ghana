-- Security: Null out the Paystack Secret Key in the database
-- This key has been moved to Supabase Secrets (Environment Variables) for better security.
UPDATE public.system_settings SET paystack_secret_key = NULL WHERE id = 1;
