-- Drop the restrictive public policies and recreate them as permissive
DROP POLICY IF EXISTS "Public can insert orders" ON public.orders;
DROP POLICY IF EXISTS "Public can view order status by id" ON public.orders;

-- Recreate as PERMISSIVE policies (default) so they work with OR logic
CREATE POLICY "Public can insert orders"
ON public.orders
FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "Public can view order status by id"
ON public.orders
FOR SELECT
TO public
USING (true);