-- ═══════════════════════════════════════════════════════════════════════════
-- Wallet Phase 2b: block direct balance edits from applications.
--
-- Apps (anon / authenticated / service_role via the API) may no longer change
-- wallets.balance or wallets.api_balance with a plain UPDATE/INSERT. Money must
-- move through wallet_post() or the existing database money functions, which
-- run as the database owner and are recorded in wallet_ledger.
-- Creating an empty wallet (balance 0) is still allowed.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.wallet_block_direct_balance_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Deliberately NOT security definer: current_user is the real caller here.
  IF current_user IN ('anon', 'authenticated', 'service_role', 'authenticator') THEN
    IF TG_OP = 'INSERT' THEN
      IF coalesce(NEW.balance, 0) <> 0 OR coalesce(NEW.api_balance, 0) <> 0 THEN
        RAISE EXCEPTION 'Wallets must be created empty. Use wallet_post() to add money.' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.balance IS DISTINCT FROM OLD.balance OR NEW.api_balance IS DISTINCT FROM OLD.api_balance THEN
      RAISE EXCEPTION 'Direct wallet balance changes are not allowed. Use wallet_post().' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_block_direct_writes ON public.wallets;
CREATE TRIGGER trg_wallet_block_direct_writes
  BEFORE INSERT OR UPDATE OF balance, api_balance ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.wallet_block_direct_balance_writes();
