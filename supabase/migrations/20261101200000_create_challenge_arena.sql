-- SwiftData Open Challenge & Ghanaian Traditional Games Arena
-- 100% Additive Schema (Does not alter any existing tables)

CREATE TABLE IF NOT EXISTS public.game_arena_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  arena_enabled boolean NOT NULL DEFAULT true,
  free_data_rewards_enabled boolean NOT NULL DEFAULT true,
  daily_free_data_limit integer NOT NULL DEFAULT 15,
  free_data_package_size text NOT NULL DEFAULT '1GB',
  free_data_win_streak_required integer NOT NULL DEFAULT 2,
  house_commission_percent numeric(5,2) NOT NULL DEFAULT 10.00,
  min_stake_ghs numeric(10,2) NOT NULL DEFAULT 2.00,
  max_stake_ghs numeric(10,2) NOT NULL DEFAULT 200.00,
  enabled_games jsonb NOT NULL DEFAULT '{"oware": true, "ludo": true, "dame": true, "ampe": true}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.game_arena_settings (
  id, arena_enabled, free_data_rewards_enabled, daily_free_data_limit,
  free_data_package_size, free_data_win_streak_required, house_commission_percent,
  min_stake_ghs, max_stake_ghs
)
VALUES (1, true, true, 15, '1GB', 2, 10.00, 2.00, 200.00)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.game_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code text NOT NULL UNIQUE DEFAULT upper(substr(md5(random()::text), 1, 6)),
  game_type text NOT NULL CHECK (game_type IN ('oware', 'ludo', 'dame', 'ampe')),
  mode text NOT NULL DEFAULT 'p2p' CHECK (mode IN ('p2p', 'ai', 'free_data')),
  title text,
  creator_id uuid,
  creator_name text NOT NULL DEFAULT 'Challenger',
  creator_phone text,
  creator_payment_source text NOT NULL DEFAULT 'wallet' CHECK (creator_payment_source IN ('wallet', 'momo', 'free')),
  creator_paystack_ref text,
  opponent_id uuid,
  opponent_name text,
  opponent_phone text,
  opponent_payment_source text CHECK (opponent_payment_source IN ('wallet', 'momo', 'free', 'ai')),
  opponent_paystack_ref text,
  stake_amount numeric(10,2) NOT NULL DEFAULT 0.00,
  prize_pool numeric(10,2) NOT NULL DEFAULT 0.00,
  house_fee numeric(10,2) NOT NULL DEFAULT 0.00,
  reward_type text NOT NULL DEFAULT 'wallet_cash' CHECK (reward_type IN ('wallet_cash', 'free_data', 'data_bundle')),
  reward_network text DEFAULT 'MTN',
  reward_data_size text DEFAULT '1GB',
  board_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_turn text NOT NULL DEFAULT 'creator',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  winner_side text CHECK (winner_side IN ('creator', 'opponent', 'draw')),
  winner_id uuid,
  winner_name text,
  winner_phone text,
  reward_claimed boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_game_challenges_status ON public.game_challenges(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_challenges_game_type ON public.game_challenges(game_type, status);
CREATE INDEX IF NOT EXISTS idx_game_challenges_creator ON public.game_challenges(creator_id);

CREATE TABLE IF NOT EXISTS public.game_reward_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid REFERENCES public.game_challenges(id) ON DELETE SET NULL,
  user_id uuid,
  winner_name text NOT NULL,
  winner_phone text NOT NULL,
  network text NOT NULL DEFAULT 'MTN',
  reward_type text NOT NULL CHECK (reward_type IN ('wallet_cash', 'free_data', 'data_bundle')),
  cash_amount numeric(10,2) NOT NULL DEFAULT 0.00,
  data_package_size text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'fulfilled', 'rejected')),
  order_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_game_reward_claims_created ON public.game_reward_claims(created_at DESC);

ALTER TABLE public.game_arena_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_reward_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view game arena settings" ON public.game_arena_settings;
CREATE POLICY "Anyone can view game arena settings"
  ON public.game_arena_settings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can view game challenges" ON public.game_challenges;
CREATE POLICY "Anyone can view game challenges"
  ON public.game_challenges FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can update active game challenges" ON public.game_challenges;
CREATE POLICY "Anyone can update active game challenges"
  ON public.game_challenges FOR UPDATE
  USING (status IN ('open', 'in_progress'));

DROP POLICY IF EXISTS "Anyone can view game reward claims" ON public.game_reward_claims;
CREATE POLICY "Anyone can view game reward claims"
  ON public.game_reward_claims FOR SELECT
  USING (true);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_challenges;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN OTHERS THEN NULL;
END $$;

