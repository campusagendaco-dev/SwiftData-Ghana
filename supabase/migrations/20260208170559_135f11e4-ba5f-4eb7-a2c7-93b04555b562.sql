
-- Allow public (unauthenticated) customers to place orders on agent stores
CREATE POLICY "Public can insert orders"
ON public.orders
FOR INSERT
WITH CHECK (true);
