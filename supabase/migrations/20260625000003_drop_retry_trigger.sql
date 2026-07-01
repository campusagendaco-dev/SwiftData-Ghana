-- Drop the on_order_needs_fulfillment trigger to disable automatic retries
DROP TRIGGER IF EXISTS on_order_needs_fulfillment ON orders;
