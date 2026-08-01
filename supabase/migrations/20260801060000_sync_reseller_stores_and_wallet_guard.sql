-- Migration: Sync All Reseller Storefronts & Enforce Non-Negative Wallet Balance Constraint

-- 1. Populate missing reseller_stores rows for all active agents with store_name
INSERT INTO public.reseller_stores (user_id, slug, store_name, updated_at)
SELECT 
  p.user_id,
  COALESCE(
    NULLIF(p.slug, ''),
    LOWER(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(p.store_name, p.full_name, 'store'), '[^a-zA-Z0-9]', '-', 'g'), '-+', '-', 'g'))
  ) AS slug,
  COALESCE(p.store_name, p.full_name, 'Swift Reseller') AS store_name,
  NOW() AS updated_at
FROM public.profiles p
WHERE p.is_agent = true
  AND (p.store_name IS NOT NULL AND p.store_name != '')
  AND NOT EXISTS (
    SELECT 1 FROM public.reseller_stores rs WHERE rs.user_id = p.user_id
  );

-- 2. Clean up negative wallet balances and clamp to 0.00
UPDATE public.wallets
SET balance = 0.00
WHERE balance < 0;

-- 3. Enforce CHECK constraint on wallets table so balance CAN NEVER drop below 0.00
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallets_balance_non_negative'
  ) THEN
    ALTER TABLE public.wallets
      ADD CONSTRAINT wallets_balance_non_negative CHECK (balance >= 0);
  END IF;
END $$;
