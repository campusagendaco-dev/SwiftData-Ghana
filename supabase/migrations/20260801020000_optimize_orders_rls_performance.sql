-- Optimize RLS policies on public.orders for instant query performance.
-- Wrapping admin check in (SELECT public.is_admin()) creates an InitPlan in PostgreSQL,
-- evaluating the admin check ONCE per query instead of 20,000+ times per row search,
-- preventing statement timeouts (HTTP 500) during admin search operations.

-- 1. Ensure public.is_admin() exists and is optimal
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

-- 2. Drop legacy slow RLS policies on orders
DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
DROP POLICY IF EXISTS "Parent agents can view sub agent orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;

-- 3. Create optimizedInitPlan RLS policies on public.orders
CREATE POLICY "Admins can view all orders" ON public.orders
  FOR SELECT TO authenticated 
  USING ((SELECT public.is_admin()));

CREATE POLICY "Admins can update orders" ON public.orders
  FOR UPDATE TO authenticated 
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Users can view own orders" ON public.orders
  FOR SELECT TO authenticated 
  USING (
    agent_id = auth.uid() 
    OR customer_id = auth.uid()
  );

CREATE POLICY "Parent agents can view sub agent orders" ON public.orders
  FOR SELECT TO authenticated
  USING (parent_agent_id = auth.uid());
