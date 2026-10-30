-- =============================================================================
-- Migration: 20261030123000_fix_award_loyalty_points_security_definer.sql
-- Purpose: Fix 403 Forbidden (42501 permission denied for table wallets) when
--          authenticated admins update an order's status to 'fulfilled' via
--          PATCH /rest/v1/orders.
-- =============================================================================

ALTER FUNCTION public.award_loyalty_points() SECURITY DEFINER SET search_path = public;

