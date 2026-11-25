-- Supplier keys stay on the server (2026-11-25).
-- Admin pages loaded whole `providers` rows, so every signed-in admin (including one signed in
-- by SMS) received every supplier's api_key / api_secret in the browser. Now:
--   1. Korba keys kept inside `settings` (client_key / secret_key) move to the key columns, and
--      a trigger keeps them out of `settings` from now on.
--   2. Signed-in users (customers and admins) can no longer READ api_key / api_secret. Admins can
--      still set them (write-only). Server functions (service role) are unaffected.
--   3. Admin pages read `providers_public`: every column except the keys, with the same
--      admin-only rules as `providers`.
-- If a column is ever added to providers, run this file again so admins can read it.
-- Apply in the SQL editor (never db push), then run supabase/tests/hide_provider_keys_checks.sql.
-- Safe to run twice.

-- 1. Korba keys out of settings
CREATE OR REPLACE FUNCTION public.keep_provider_keys_out_of_settings()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.settings IS NOT NULL AND jsonb_typeof(NEW.settings) = 'object'
     AND (NEW.settings ? 'client_key' OR NEW.settings ? 'secret_key') THEN
    NEW.api_key := COALESCE(NULLIF(NEW.settings->>'client_key', ''), NEW.api_key);
    NEW.api_secret := COALESCE(NULLIF(NEW.settings->>'secret_key', ''), NEW.api_secret);
    NEW.settings := NEW.settings - 'client_key' - 'secret_key';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_keep_provider_keys_out_of_settings ON public.providers;
CREATE TRIGGER trg_keep_provider_keys_out_of_settings
  BEFORE INSERT OR UPDATE ON public.providers
  FOR EACH ROW EXECUTE FUNCTION public.keep_provider_keys_out_of_settings();

-- existing rows: a key already in the column wins; the settings copy is removed either way
UPDATE public.providers
   SET api_key = COALESCE(NULLIF(api_key, ''), NULLIF(settings->>'client_key', ''), api_key),
       api_secret = COALESCE(NULLIF(api_secret, ''), NULLIF(settings->>'secret_key', ''), api_secret),
       settings = settings - 'client_key' - 'secret_key'
 WHERE jsonb_typeof(settings) = 'object' AND (settings ? 'client_key' OR settings ? 'secret_key');

-- 2 + 3. Keys unreadable for signed-in users; browser-safe view for admin pages
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'providers'
    AND column_name NOT IN ('api_key', 'api_secret');

  EXECUTE 'REVOKE SELECT ON public.providers FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.providers TO authenticated', cols);

  EXECUTE 'DROP VIEW IF EXISTS public.providers_public';
  EXECUTE format('CREATE VIEW public.providers_public WITH (security_invoker = true) AS SELECT %s FROM public.providers', cols);
  EXECUTE 'REVOKE ALL ON public.providers_public FROM anon';
  EXECUTE 'GRANT SELECT ON public.providers_public TO authenticated, service_role';
END $$;
