-- Migration: Fix Provider Deletion Foreign Key Constraints (409 Conflict Fix)
-- Description: Alters orders and provider_errors foreign keys to ON DELETE SET NULL / CASCADE and provides a safe deletion RPC.

-- 1. Fix foreign key on public.orders (provider_id)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT tc.constraint_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = 'orders'
      AND kcu.column_name = 'provider_id'
  ) LOOP
    EXECUTE 'ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.orders
  ADD CONSTRAINT fk_orders_provider_id
  FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE SET NULL;

-- 2. Fix foreign key on public.provider_errors (provider_id)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT tc.constraint_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = 'provider_errors'
      AND kcu.column_name = 'provider_id'
  ) LOOP
    EXECUTE 'ALTER TABLE public.provider_errors DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.provider_errors
  ADD CONSTRAINT fk_provider_errors_provider_id
  FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;

-- 3. Create RPC function for safe provider deletion
CREATE OR REPLACE FUNCTION public.delete_provider_safe(p_provider_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  -- Check if provider exists
  SELECT name INTO v_name FROM public.providers WHERE id = p_provider_id;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Provider not found.');
  END IF;

  -- 1. Unlink provider from orders by setting provider_id to NULL
  UPDATE public.orders
  SET provider_id = NULL
  WHERE provider_id = p_provider_id;

  -- 2. Clean up associated provider_packages
  DELETE FROM public.provider_packages
  WHERE provider_id = p_provider_id;

  -- 3. Clean up associated provider errors if table exists
  BEGIN
    DELETE FROM public.provider_errors WHERE provider_id = p_provider_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 4. Delete the provider row
  DELETE FROM public.providers
  WHERE id = p_provider_id;

  RETURN jsonb_build_object('success', true, 'message', 'Provider ' || v_name || ' deleted successfully.');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_provider_safe(UUID) TO authenticated, service_role;
