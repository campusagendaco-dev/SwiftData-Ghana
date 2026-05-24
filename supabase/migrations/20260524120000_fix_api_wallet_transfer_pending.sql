-- Fix api_wallet_transfer pending issue
-- The tr_force_order_pending trigger was overriding the 'fulfilled' status
-- set by user_transfer_to_api because the RPC runs with the user's auth.role().

CREATE OR REPLACE FUNCTION public.force_order_pending_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Safe bypass: 'failure_reason' is not insertable by authenticated users via PostgREST.
  -- Only the SECURITY DEFINER RPC 'user_transfer_to_api' can set it.
  IF NEW.order_type = 'api_wallet_transfer' AND NEW.failure_reason = 'Funded from Main Wallet' THEN
    RETURN NEW;
  END IF;

  -- Always force status to 'pending' for public inserts.
  NEW.status := 'pending';
  
  -- Reset sensitive financial columns to 0 or NULL to prevent manipulation
  NEW.profit := 0;
  NEW.parent_profit := 0;
  NEW.cost_price := NULL;
  NEW.profit_credited := FALSE;
  NEW.parent_profit_credited := FALSE;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Retrospectively fix any stuck api_wallet_transfers
UPDATE public.orders
SET status = 'fulfilled'
WHERE order_type = 'api_wallet_transfer' AND status = 'pending';
