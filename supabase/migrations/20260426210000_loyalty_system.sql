-- LOYALTY SYSTEM: Reward users for every transaction.

-- 1. Add loyalty_balance to wallets
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS loyalty_balance DECIMAL(12, 2) DEFAULT 0.00;

-- 2. Create a function to calculate points
-- 1 point per 10 GHS (1%)
CREATE OR REPLACE FUNCTION public.calculate_loyalty_points(amount DECIMAL)
RETURNS DECIMAL AS $$
BEGIN
    RETURN FLOOR(amount / 10);
END;
$$ LANGUAGE plpgsql;

-- 3. Create the trigger function to award points on fulfillment
CREATE OR REPLACE FUNCTION public.award_loyalty_points()
RETURNS TRIGGER AS $$
DECLARE
    points_to_award DECIMAL;
BEGIN
    -- Only award if status changed to fulfilled
    IF (NEW.status = 'fulfilled' AND (OLD.status IS NULL OR OLD.status <> 'fulfilled')) THEN
        -- Calculate points based on order amount
        points_to_award := public.calculate_loyalty_points(NEW.amount);
        
        IF points_to_award > 0 THEN
            UPDATE public.wallets
            SET loyalty_balance = loyalty_balance + points_to_award
            WHERE agent_id = NEW.agent_id;
            
            -- Optional: Log to audit or a loyalty history table
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Attach trigger to orders
DROP TRIGGER IF EXISTS on_order_fulfilled_loyalty ON public.orders;
CREATE TRIGGER on_order_fulfilled_loyalty
AFTER UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.award_loyalty_points();

-- 5. RPC to convert points to wallet balance
-- Rate: 100 points = 1 GHS
-- Drop any overloaded variants before replacing to keep the name unique
DROP FUNCTION IF EXISTS public.convert_loyalty_points(UUID, DECIMAL) CASCADE;
DROP FUNCTION IF EXISTS public.convert_loyalty_points(UUID, NUMERIC) CASCADE;
CREATE OR REPLACE FUNCTION public.convert_loyalty_points(user_id UUID, points_to_convert DECIMAL)
RETURNS JSONB AS $$
DECLARE
    wallet_row RECORD;
    cash_value DECIMAL;
BEGIN
    SELECT * INTO wallet_row FROM public.wallets WHERE agent_id = user_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
    END IF;
    
    IF wallet_row.loyalty_balance < points_to_convert THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient loyalty balance');
    END IF;
    
    -- Calculate cash value (100 points = 1 GHS)
    cash_value := points_to_convert / 100;
    
    -- Perform atomic update
    UPDATE public.wallets
    SET 
        loyalty_balance = loyalty_balance - points_to_convert,
        balance = balance + cash_value
    WHERE agent_id = user_id;
    
    RETURN jsonb_build_object(
        'success', true, 
        'converted_points', points_to_convert, 
        'cash_added', cash_value,
        'new_balance', wallet_row.balance + cash_value,
        'new_loyalty_balance', wallet_row.loyalty_balance - points_to_convert
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Grant access
GRANT EXECUTE ON FUNCTION public.convert_loyalty_points(UUID, DECIMAL) TO authenticated;
