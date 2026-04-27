-- FINANCIAL ACCURACY: Track Paystack-verified amounts and fee breakdown per order.
-- paystack_verified_amount: exact GHS Paystack confirmed was paid (set at fulfillment time)
-- paystack_fee:             the Paystack processing fee charged to the customer (set at order creation)

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS paystack_verified_amount DECIMAL(12,2);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS paystack_fee DECIMAL(12,2) DEFAULT 0;

-- Backfill fee for historical fulfilled orders where we can reverse-calculate it.
-- Fee was always min(amount * 0.03 / 1.03, 100) — recovering base from the total.
UPDATE public.orders
SET
  paystack_fee     = ROUND(LEAST(amount * 0.03 / 1.03, 100)::NUMERIC, 2),
  paystack_verified_amount = amount
WHERE status = 'fulfilled'
  AND order_type NOT IN ('wallet_topup', 'agent_activation', 'sub_agent_activation', 'free_data_claim')
  AND paystack_fee IS NULL
  AND amount > 0;

-- wallet_topup: amount = credit given; fee = amount * 0.03 (approx, since we charged credit + fee)
UPDATE public.orders
SET
  paystack_fee     = ROUND(LEAST(amount * 0.03, 100)::NUMERIC, 2),
  paystack_verified_amount = ROUND((amount + LEAST(amount * 0.03, 100))::NUMERIC, 2)
WHERE status = 'fulfilled'
  AND order_type = 'wallet_topup'
  AND paystack_fee IS NULL
  AND amount > 0;

COMMENT ON COLUMN public.orders.paystack_verified_amount IS 'GHS amount Paystack confirmed was paid. Set when webhook or verify-payment confirms the transaction.';
COMMENT ON COLUMN public.orders.paystack_fee IS 'Paystack processing fee charged on top of the base price. Stored at order creation.';
