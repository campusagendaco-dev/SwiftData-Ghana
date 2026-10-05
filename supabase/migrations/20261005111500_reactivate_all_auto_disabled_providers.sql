-- Reactivate all providers and permanently turn off automatic disabling
-- on low balance or consecutive order failures.

UPDATE public.providers
SET
  is_active = true,
  disabled_reason = null,
  consecutive_failures = 0,
  auto_disable_on_low_balance = false;

ALTER TABLE public.providers 
ALTER COLUMN auto_disable_on_low_balance SET DEFAULT false;
