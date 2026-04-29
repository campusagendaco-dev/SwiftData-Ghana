-- Manual agent approval for onegig365@gmail.com
DO $$
DECLARE
    v_user_id UUID;
BEGIN
    SELECT user_id INTO v_user_id
    FROM public.profiles
    WHERE email ILIKE 'onegig365@gmail.com'
    LIMIT 1;

    IF v_user_id IS NULL THEN
        SELECT id INTO v_user_id
        FROM auth.users
        WHERE email ILIKE 'onegig365@gmail.com'
        LIMIT 1;
    END IF;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User onegig365@gmail.com not found';
    END IF;

    UPDATE public.profiles
    SET
        is_agent        = true,
        agent_approved  = true,
        sub_agent_approved = false,
        onboarding_complete = true,
        is_sub_agent    = false,
        parent_agent_id = NULL
    WHERE user_id = v_user_id;

    UPDATE public.orders
    SET status = 'fulfilled', failure_reason = NULL
    WHERE agent_id = v_user_id
      AND order_type IN ('agent_activation', 'sub_agent_activation')
      AND status IN ('paid', 'pending', 'processing');

    RAISE NOTICE 'onegig365@gmail.com approved as agent (user_id: %)', v_user_id;
END $$;
