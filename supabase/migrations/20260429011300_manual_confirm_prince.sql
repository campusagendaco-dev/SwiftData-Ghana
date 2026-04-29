-- Manually confirm withdrawal for Prince Kwofie (as requested by user)
DO $$
DECLARE
    v_withdrawal_id UUID;
BEGIN
    -- Find the specific pending withdrawal
    SELECT w.id INTO v_withdrawal_id
    FROM public.withdrawals w
    JOIN public.profiles p ON w.agent_id = p.user_id
    WHERE p.email = 'princekwofie91@gmail.com'
      AND w.status = 'pending'
      AND w.amount = 47.50
    ORDER BY w.created_at DESC
    LIMIT 1;

    IF v_withdrawal_id IS NOT NULL THEN
        -- Use the finalize_withdrawal function to ensure wallet balance is updated correctly
        PERFORM public.finalize_withdrawal(v_withdrawal_id);
        RAISE NOTICE 'Confirmed withdrawal ID: %', v_withdrawal_id;
    ELSE
        RAISE NOTICE 'No matching pending withdrawal found for princekwofie91@gmail.com with amount 47.50';
    END IF;
END $$;
