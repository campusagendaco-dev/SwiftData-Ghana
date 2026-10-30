-- 1. Unify SELECT RLS policies on public.orders using InitPlan ((SELECT ...))
-- Previously, "Users can view own orders" and "Parent agents can view sub agent orders"
-- called auth.uid() directly without (SELECT auth.uid()), causing PostgreSQL to parse
-- current_setting('request.jwt.claims')::jsonb 3 times per row (365,000+ times on 121k rows).
DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
DROP POLICY IF EXISTS "Parent agents can view sub agent orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Unified select orders policy" ON public.orders;

CREATE POLICY "Admins can view all orders" ON public.orders
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR agent_id = (SELECT auth.uid())
    OR customer_id = (SELECT auth.uid())
    OR parent_agent_id = (SELECT auth.uid())
  );

-- 2. Add composite B-tree index on (network, created_at DESC) for instant network-filtered pages
-- (e.g. AdminMashUpOrders, network filters in AdminOrders / AdminStandardOrders)
CREATE INDEX IF NOT EXISTS idx_orders_network_created_at_desc
  ON public.orders (network, created_at DESC);

-- 3. Give authenticated role a 20s statement_timeout headroom for complex multi-column admin searches
ALTER ROLE authenticated SET statement_timeout = '20s';

