-- Game Arena safety: pause cash stakes, stop public writes, and hide private match details.
-- Safe to run more than once.

ALTER TABLE public.game_arena_settings
  ADD COLUMN IF NOT EXISTS cash_stakes_enabled boolean NOT NULL DEFAULT false;

-- Invited phone numbers move out of metadata, which stays readable for live match updates.
ALTER TABLE public.game_challenges ADD COLUMN IF NOT EXISTS invited_phone text;

UPDATE public.game_challenges
SET invited_phone = metadata->>'invited_phone',
    metadata = metadata - 'invited_phone'
WHERE metadata ? 'invited_phone';

-- Only the challenge-arena function (service role) may change matches.
DROP POLICY IF EXISTS "Anyone can update active game challenges" ON public.game_challenges;
DROP POLICY IF EXISTS "Anyone can view game reward claims" ON public.game_reward_claims;

REVOKE ALL ON public.game_reward_claims FROM anon, authenticated;
REVOKE ALL ON public.game_challenges FROM anon, authenticated;

-- Column-level read access keeps Realtime working without exposing private columns.
DO $$
DECLARE
  safe_columns text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ')
  INTO safe_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'game_challenges'
    AND column_name NOT IN (
      'creator_phone', 'creator_paystack_ref', 'opponent_phone',
      'opponent_paystack_ref', 'winner_phone', 'invited_phone'
    );

  EXECUTE format('GRANT SELECT (%s) ON public.game_challenges TO anon, authenticated', safe_columns);
END;
$$;

GRANT ALL ON public.game_challenges TO service_role;
GRANT ALL ON public.game_reward_claims TO service_role;
GRANT ALL ON public.game_arena_settings TO service_role;
