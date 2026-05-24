-- Fix RLS for Storefront Customers so they can view their own orders 
-- specifically for deposits where they are marked as the customer in metadata.

DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;

CREATE POLICY "Users can view own orders" ON public.orders
  FOR SELECT TO authenticated 
  USING (
    auth.uid()::text = agent_id::text 
    OR 
    auth.uid()::text = (metadata->>'customer_id')::text
  );
