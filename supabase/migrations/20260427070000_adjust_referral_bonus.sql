-- LOYALTY ADJUSTMENT: Lower referral reward for sustainability.

CREATE OR REPLACE FUNCTION public.award_loyalty_points()
RETURNS TRIGGER AS $$
DECLARE
    points_to_award DECIMAL;
    v_referrer_id UUID;
    v_is_claimed BOOLEAN;
    referee_bonus_points DECIMAL := 100; -- GHS 1.00 (Welcome Gift)
    referrer_bonus_points DECIMAL := 200; -- GHS 2.00 (Referral Reward - Adjusted down from 5.00)
BEGIN
    -- Only award if status changed to fulfilled
    IF (NEW.status = 'fulfilled' AND (OLD.status IS NULL OR OLD.status <> 'fulfilled')) THEN
        -- Standard points calculation (1 point per 10 GHS)
        points_to_award := public.calculate_loyalty_points(NEW.amount);
        
        -- Check for First Purchase Referral Bonus
        IF NEW.amount >= 10 THEN
            SELECT referred_by, first_purchase_bonus_claimed INTO v_referrer_id, v_is_claimed 
            FROM public.profiles WHERE id = NEW.agent_id;

            IF v_referrer_id IS NOT NULL AND v_is_claimed = FALSE THEN
                -- Award Referrer
                UPDATE public.wallets 
                SET loyalty_balance = loyalty_balance + referrer_bonus_points
                WHERE agent_id = v_referrer_id;

                -- Award Referee (Current User)
                points_to_award := points_to_award + referee_bonus_points;

                -- Mark as claimed
                UPDATE public.profiles 
                SET first_purchase_bonus_claimed = TRUE 
                WHERE id = NEW.agent_id;
            END IF;
        END IF;

        IF points_to_award > 0 THEN
            UPDATE public.wallets
            SET loyalty_balance = loyalty_balance + points_to_award
            WHERE agent_id = NEW.agent_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
