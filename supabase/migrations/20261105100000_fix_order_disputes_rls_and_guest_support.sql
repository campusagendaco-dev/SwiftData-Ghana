-- Allow both authenticated users and guest customers (on /my-orders) to submit order disputes without 403 RLS / FK errors.

-- 1. Allow user_id to be NULL for guest orders (where 00000000-0000-0000-0000-000000000000 is not in auth.users)
ALTER TABLE public.order_disputes
  ALTER COLUMN user_id DROP NOT NULL;

-- 2. Sanitize user_id on insert: default to auth.uid(), and if user_id is not a real auth.users row (e.g. guest sentinel UUID), set to NULL
CREATE OR REPLACE FUNCTION public.sanitize_order_dispute_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;

  IF NEW.user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.user_id) THEN
      NEW.user_id := auth.uid();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sanitize_order_dispute ON public.order_disputes;
CREATE TRIGGER trg_sanitize_order_dispute
  BEFORE INSERT ON public.order_disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.sanitize_order_dispute_before_insert();

-- 3. Grant table permissions and update RLS policies so neither guest nor authenticated inserts fail with 403
GRANT SELECT, INSERT ON public.order_disputes TO anon, authenticated;

DROP POLICY IF EXISTS "Users can create disputes" ON public.order_disputes;
CREATE POLICY "Users can create disputes"
  ON public.order_disputes
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    order_id IS NOT NULL
    AND reason IS NOT NULL
    AND length(trim(reason)) > 0
    AND (user_id IS NULL OR user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id))
  );

DROP POLICY IF EXISTS "Users can view own disputes" ON public.order_disputes;
CREATE POLICY "Users can view own disputes"
  ON public.order_disputes
  FOR SELECT
  TO anon, authenticated
  USING (
    user_id = auth.uid()
    OR user_id IS NULL
  );
