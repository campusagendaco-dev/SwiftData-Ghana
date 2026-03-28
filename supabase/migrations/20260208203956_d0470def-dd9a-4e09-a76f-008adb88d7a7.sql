-- Allow anyone to read order status by ID (public lookup)
CREATE POLICY "Public can view order status by id"
ON public.orders
FOR SELECT
USING (true);

-- Drop the old restrictive public insert if it conflicts
-- (the existing "Public can insert orders" policy already allows public inserts)
