-- Migration: Disable Auto-Fulfillment Trigger for API Orders
-- This allows failed API orders to remain in 'fulfillment_failed' status so they are properly refunded.

DROP TRIGGER IF EXISTS tr_auto_fulfill_api_orders ON public.orders;
DROP FUNCTION IF EXISTS public.handle_api_order_auto_fulfillment();
