-- Migration: Auto-Suspension System for Security Violations
-- Description: Adds tracking for exploit attempts/pricing bypasses, implements automatic 12-hour/24-hour/permanent account suspensions, and schedules a background cron job to release expired suspensions.

-- 1. Add columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS security_violation_count INTEGER DEFAULT 0 NOT NULL;

-- 2. Create security_violations table
CREATE TABLE IF NOT EXISTS public.security_violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. Enable RLS on security_violations and grant permissions
ALTER TABLE public.security_violations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view security violations" 
ON public.security_violations 
FOR SELECT 
TO service_role 
USING (true);

GRANT ALL ON public.security_violations TO service_role;

-- 4. Create log_security_violation function
CREATE OR REPLACE FUNCTION public.log_security_violation(
    p_user_id UUID,
    p_reason TEXT,
    p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_new_count INTEGER;
    v_suspended_until TIMESTAMP WITH TIME ZONE;
    v_is_suspended BOOLEAN := FALSE;
    v_email TEXT;
    v_full_name TEXT;
BEGIN
    -- Get user email and name for log
    SELECT email, full_name INTO v_email, v_full_name
    FROM public.profiles WHERE user_id = p_user_id;

    -- 1. Insert violation record
    INSERT INTO public.security_violations (user_id, reason, details)
    VALUES (p_user_id, p_reason, p_details);

    -- 2. Increment count and determine suspension
    UPDATE public.profiles
    SET security_violation_count = security_violation_count + 1
    WHERE user_id = p_user_id
    RETURNING security_violation_count INTO v_new_count;

    IF v_new_count = 1 THEN
        -- 1st Strike: 12-Hour Suspension
        v_suspended_until := now() + interval '12 hours';
        v_is_suspended := TRUE;
    ELSIF v_new_count = 2 THEN
        -- 2nd Strike: 24-Hour Suspension
        v_suspended_until := now() + interval '24 hours';
        v_is_suspended := TRUE;
    ELSE
        -- 3rd Strike+: Permanent Suspension
        v_suspended_until := NULL;
        v_is_suspended := TRUE;
    END IF;

    -- 3. Apply suspension
    UPDATE public.profiles
    SET is_suspended = v_is_suspended,
        suspended_until = v_suspended_until,
        updated_at = now()
    WHERE user_id = p_user_id;

    -- 4. Log to system_logs
    INSERT INTO public.system_logs (ts, level, source, event, agent_id, message, data)
    VALUES (
        now(),
        'warn',
        'security-guard',
        'user.security_violation',
        p_user_id,
        format('Security violation logged for %s (%s). Strike %s. Action: %s.', 
            COALESCE(v_full_name, 'Unknown'), 
            COALESCE(v_email, 'unknown@email.com'), 
            v_new_count,
            CASE 
                WHEN v_suspended_until IS NOT NULL THEN 'Suspended until ' || v_suspended_until::text
                ELSE 'Permanently suspended'
            END
        ),
        jsonb_build_object(
            'violation_reason', p_reason,
            'violation_details', p_details,
            'strike_count', v_new_count,
            'suspended_until', v_suspended_until
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'strike_count', v_new_count,
        'suspended_until', v_suspended_until,
        'is_suspended', v_is_suspended
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_security_violation(UUID, TEXT, JSONB) TO service_role;

-- 5. Create automatic unsuspend logic
CREATE OR REPLACE FUNCTION public.release_expired_suspensions()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_released_count INTEGER;
BEGIN
    UPDATE public.profiles
    SET is_suspended = FALSE,
        suspended_until = NULL,
        updated_at = now()
    WHERE is_suspended = TRUE
      AND suspended_until IS NOT NULL
      AND suspended_until <= now();

    GET DIAGNOSTICS v_released_count = ROW_COUNT;

    IF v_released_count > 0 THEN
        -- Log the auto-release to system logs
        INSERT INTO public.system_logs (ts, level, source, event, message, data)
        VALUES (
            now(),
            'info',
            'security-guard',
            'suspension.auto_released',
            format('Automatically unsuspended %s users whose temporary suspension duration expired.', v_released_count),
            jsonb_build_object('released_count', v_released_count)
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'released_count', v_released_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_expired_suspensions() TO service_role;

-- 6. Schedule pg_cron job to run every 5 minutes
SELECT cron.unschedule('unsuspend-expired-users') FROM cron.job WHERE jobname = 'unsuspend-expired-users';

SELECT cron.schedule(
  'unsuspend-expired-users',
  '*/5 * * * *',
  $$
    SELECT public.release_expired_suspensions();
  $$
);
