declare const Deno: any;

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { corsHeaders } from "../_shared/cors.ts";
import {
  normalizePhone,
  getSmsConfig,
  dispatchUnifiedSms,
  dispatchUnifiedBulkSms,
} from "../_shared/sms.ts";

let schemaVerified = false;

async function ensureChallengeSchema(supabaseAdmin: any) {
  if (schemaVerified) return;

  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) {
    schemaVerified = true;
    return;
  }

  const sql = postgres(dbUrl, { max: 1 });
  try {
    await sql.unsafe(`
      -- Ensure additive Challenge Arena tables exist
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
        enabled_games jsonb NOT NULL DEFAULT '{"oware": true, "ludo": true, "dame": true, "pool": true, "slash": true, "candy": true, "buggy": true}'::jsonb,
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
        game_type text NOT NULL CHECK (game_type IN ('oware', 'ludo', 'dame', 'pool', 'slash', 'ampe', 'candy', 'buggy')),
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

      ALTER TABLE public.game_challenges DROP CONSTRAINT IF EXISTS game_challenges_game_type_check;
      ALTER TABLE public.game_challenges ADD CONSTRAINT game_challenges_game_type_check CHECK (game_type IN ('oware', 'ludo', 'dame', 'pool', 'slash', 'ampe', 'candy', 'buggy'));

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

      CREATE TABLE IF NOT EXISTS public.game_community_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        channel text NOT NULL DEFAULT 'global',
        sender_id uuid,
        sender_name text NOT NULL DEFAULT 'Ghana Gamer',
        sender_phone_masked text,
        sender_level integer NOT NULL DEFAULT 1,
        sender_title text NOT NULL DEFAULT 'Rookie',
        favorite_game text NOT NULL DEFAULT 'oware',
        message_type text NOT NULL DEFAULT 'chat' CHECK (message_type IN ('chat', 'challenge_card', 'direct_invite', 'victory_shoutout')),
        message text NOT NULL,
        challenge_id uuid REFERENCES public.game_challenges(id) ON DELETE SET NULL,
        room_code text,
        game_type text,
        stake_amount numeric(10,2) NOT NULL DEFAULT 0.00,
        prize_pool numeric(10,2) NOT NULL DEFAULT 0.00,
        target_user_id uuid,
        target_user_name text,
        reactions jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_game_community_messages_channel ON public.game_community_messages(channel, created_at DESC);

      CREATE TABLE IF NOT EXISTS public.game_community_presence (
        player_key text PRIMARY KEY,
        user_id uuid,
        display_name text NOT NULL,
        masked_phone text,
        raw_phone text,
        player_level integer NOT NULL DEFAULT 1,
        player_title text NOT NULL DEFAULT 'Arena Challenger',
        favorite_game text NOT NULL DEFAULT 'oware',
        status text NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'looking_for_match', 'in_match')),
        active_room_code text,
        last_seen_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_game_community_presence_seen ON public.game_community_presence(last_seen_at DESC);

      ALTER TABLE public.game_community_messages ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.game_community_presence ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS "Anyone can view game community messages" ON public.game_community_messages;
      CREATE POLICY "Anyone can view game community messages"
        ON public.game_community_messages FOR SELECT
        USING (true);

      DROP POLICY IF EXISTS "Anyone can view game community presence" ON public.game_community_presence;
      CREATE POLICY "Anyone can view game community presence"
        ON public.game_community_presence FOR SELECT
        USING (true);

      ALTER TABLE public.game_community_messages ADD COLUMN IF NOT EXISTS avatar_id text DEFAULT 'royal_headband';
      ALTER TABLE public.game_community_messages ADD COLUMN IF NOT EXISTS liked_by jsonb NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE public.game_community_messages ADD COLUMN IF NOT EXISTS comments jsonb NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE public.game_community_presence ADD COLUMN IF NOT EXISTS avatar_id text DEFAULT 'royal_headband';
      ALTER TABLE public.game_community_presence ADD COLUMN IF NOT EXISTS ig_note text;

      CREATE TABLE IF NOT EXISTS public.game_user_stories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid,
        player_key text NOT NULL,
        author_name text NOT NULL DEFAULT 'Ghana Gamer',
        author_phone_masked text,
        author_level integer NOT NULL DEFAULT 1,
        author_title text NOT NULL DEFAULT 'Arena Challenger',
        avatar_id text NOT NULL DEFAULT 'blue_band',
        media_type text NOT NULL DEFAULT 'text' CHECK (media_type IN ('text', 'image', 'video')),
        media_url text,
        caption text,
        bg_gradient text NOT NULL DEFAULT 'from-indigo-600 via-purple-700 to-slate-950',
        attached_room_code text,
        attached_game_type text,
        views_count integer NOT NULL DEFAULT 0,
        reactions jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
      );

      CREATE INDEX IF NOT EXISTS idx_game_user_stories_expires ON public.game_user_stories(expires_at DESC, created_at DESC);

      ALTER TABLE public.game_user_stories ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.game_user_stories ADD COLUMN IF NOT EXISTS liked_by jsonb NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE public.game_user_stories ADD COLUMN IF NOT EXISTS comments jsonb NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE public.game_user_stories ADD COLUMN IF NOT EXISTS favorite_game text DEFAULT 'oware';
      ALTER TABLE public.game_user_stories ADD COLUMN IF NOT EXISTS room_code text;
      ALTER TABLE public.game_user_stories ADD COLUMN IF NOT EXISTS game_type text;

      DROP POLICY IF EXISTS "Anyone can view game user stories" ON public.game_user_stories;
      CREATE POLICY "Anyone can view game user stories"
        ON public.game_user_stories FOR SELECT
        USING (true);

      -- Ensure public storage bucket 'arena-stories' exists for user photo & video stories
      INSERT INTO storage.buckets (id, name, public, file_size_limit)
      VALUES ('arena-stories', 'arena-stories', true, 20971520)
      ON CONFLICT (id) DO UPDATE SET public = true;

      DROP POLICY IF EXISTS "Public read arena stories media" ON storage.objects;
      CREATE POLICY "Public read arena stories media"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'arena-stories');

      DROP POLICY IF EXISTS "Public upload arena stories media" ON storage.objects;
      CREATE POLICY "Public upload arena stories media"
        ON storage.objects FOR INSERT
        WITH CHECK (bucket_id = 'arena-stories');

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND tablename = 'game_challenges'
        ) THEN
          ALTER PUBLICATION supabase_realtime ADD TABLE public.game_challenges;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND tablename = 'game_community_messages'
        ) THEN
          ALTER PUBLICATION supabase_realtime ADD TABLE public.game_community_messages;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND tablename = 'game_community_presence'
        ) THEN
          ALTER PUBLICATION supabase_realtime ADD TABLE public.game_community_presence;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND tablename = 'game_user_stories'
        ) THEN
          ALTER PUBLICATION supabase_realtime ADD TABLE public.game_user_stories;
        END IF;
      END $$;
    `);
    schemaVerified = true;
  } catch (err) {
    console.error("Failed to auto-initialize challenge schema:", err);
  } finally {
    await sql.end();
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatGameLabel(gameType: string): string {
  const g = String(gameType || "oware").toLowerCase();
  if (g === "oware") return "Ghana Oware";
  if (g === "ludo") return "Ghana Ludo";
  if (g === "dame") return "Ghanaian Dame";
  if (g === "pool") return "8-Ball Pool";
  if (g === "slash") return "Market Slash";
  if (g === "candy") return "Candy Crash";
  if (g === "buggy") return "Labadi Buggy GP";
  return g.toUpperCase();
}

/**
 * Collects recent active arena players & registered active profiles with valid Ghana phones
 * (excluding any opted-out profiles and the excluded phone list), capped at `maxCount`
 * so SMS broadcasts execute cleanly within Edge Function wall-clock limits.
 */
async function collectArenaRecipientPhones(
  supabaseAdmin: any,
  excludeRawPhones: Array<string | null | undefined>,
  maxCount = 25
): Promise<string[]> {
  const excludedSet = new Set(
    excludeRawPhones
      .map((p) => normalizePhone(p))
      .filter((p): p is string => Boolean(p))
  );

  const uniquePhones = new Set<string>();

  try {
    // 1. Recent Challenge Arena players first (highest intent!)
    const { data: recentChallenges } = await supabaseAdmin
      .from("game_challenges")
      .select("creator_phone, opponent_phone")
      .order("created_at", { ascending: false })
      .limit(40);

    for (const row of recentChallenges || []) {
      const p1 = normalizePhone(row.creator_phone);
      if (p1 && !excludedSet.has(p1)) uniquePhones.add(p1);
      const p2 = normalizePhone(row.opponent_phone);
      if (p2 && !excludedSet.has(p2)) uniquePhones.add(p2);
      if (uniquePhones.size >= maxCount) break;
    }

    // 2. Supplement with active registered profiles who have not opted out of SMS
    if (uniquePhones.size < maxCount) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("phone, sms_opt_out")
        .not("phone", "is", null)
        .neq("phone", "")
        .order("updated_at", { ascending: false })
        .limit(50);

      for (const prof of profiles || []) {
        if (prof.sms_opt_out) continue;
        const p = normalizePhone(prof.phone);
        if (p && !excludedSet.has(p)) {
          uniquePhones.add(p);
          if (uniquePhones.size >= maxCount) break;
        }
      }
    }
  } catch (err) {
    console.warn("[challenge-arena] Warning collecting arena phones:", err);
  }

  return Array.from(uniquePhones).slice(0, maxCount);
}

/**
 * Fires Web Push notification via send-push-notification Edge Function
 */
async function triggerWebPush(
  supabaseUrl: string,
  serviceRoleKey: string,
  payload: Record<string, unknown>
): Promise<number> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3500),
    });
    const data = await res.json().catch(() => null);
    return Number(data?.sent || 0);
  } catch (err) {
    console.warn("[challenge-arena] Web push trigger warning:", err);
    return 0;
  }
}

/**
 * Multi-channel notification dispatcher when an Open Challenge is created OR when a player is invited.
 * Channels:
 *  1. In-App Notification (`public.notifications` broadcast + specific user invite)
 *  2. Web Push Notification (`send-push-notification` broadcast + targeted push)
 *  3. SMS Notification (`dispatchUnifiedSms` to invited friend + `dispatchUnifiedBulkSms` to arena players)
 */
async function notifyOpenChallengeOrInvite(
  supabaseAdmin: any,
  supabaseUrl: string,
  serviceRoleKey: string,
  challenge: any,
  opts: {
    invitedPhone?: string | null;
    invitedUserId?: string | null;
    invitedName?: string | null;
    broadcastAll?: boolean;
    isPrivate?: boolean;
    createdByUserId?: string | null;
  } = {}
): Promise<{
  inAppSent: boolean;
  pushSent: number;
  directSmsSent: boolean;
  arenaSmsCount: number;
}> {
  const gameLabel = formatGameLabel(challenge.game_type);
  const stake = Number(challenge.stake_amount || 0);
  const prizePool = Number(challenge.prize_pool || 0);
  const roomCode = String(challenge.room_code || "");
  const creatorName = String(challenge.creator_name || "Ghana Champion");
  const isPrivate = Boolean(opts.isPrivate ?? challenge?.metadata?.is_private);
  const broadcastAll = isPrivate ? Boolean(opts.broadcastAll === true) : opts.broadcastAll !== false;
  const cleanInvitePhone = normalizePhone(opts.invitedPhone);

  let inAppSent = false;
  let pushSent = 0;
  let directSmsSent = false;
  let arenaSmsCount = 0;

  // Resolve invited user ID if phone was given
  let resolvedInvitedUserId = opts.invitedUserId || null;
  if (!resolvedInvitedUserId && cleanInvitePhone) {
    const localSuffix = cleanInvitePhone.slice(-9);
    const { data: matchedProfile } = await supabaseAdmin
      .from("profiles")
      .select("user_id, full_name")
      .ilike("phone", `%${localSuffix}%`)
      .limit(1)
      .maybeSingle();
    if (matchedProfile?.user_id) {
      resolvedInvitedUserId = matchedProfile.user_id;
    }
  }

  // 1. Insert In-App Notifications (`public.notifications` ONLY for direct invited opponent, never global `all` spam)
  try {
    const creatorId = opts.createdByUserId || challenge.creator_id || null;
    if (resolvedInvitedUserId && resolvedInvitedUserId !== creatorId) {
      const stakeLabel =
        stake > 0
          ? `Stake: GH₵ ${stake.toFixed(2)}, Winner Pot: GH₵ ${prizePool.toFixed(2)}`
          : "Free 1v1 Friendly Duel (+35 Arena Pts)";
      await supabaseAdmin.from("notifications").insert([
        {
          title: isPrivate
            ? `🔒 Private ${gameLabel} Challenge from ${creatorName}!`
            : `🎯 ${creatorName} Invited You to a ${gameLabel} Duel!`,
          message: `${creatorName} invited you to play ${gameLabel} in ${
            isPrivate ? "Private " : ""
          }Room #${roomCode} (${stakeLabel}). Tap to accept the challenge now!`,
          target_type: "specific",
          target_user_id: resolvedInvitedUserId,
          created_by: creatorId,
        },
      ]);
      inAppSent = true;
    }
  } catch (err) {
    console.warn("[challenge-arena] In-app notification insert warning:", err);
  }

  // 2. Web Push Notification (Broadcast for Public + Specific Invited User for Private/Direct)
  const pushPromises: Promise<number>[] = [];
  if (broadcastAll && !isPrivate) {
    pushPromises.push(
      triggerWebPush(supabaseUrl, serviceRoleKey, {
        broadcast: true,
        title:
          stake > 0
            ? `⚔️ Public ${gameLabel} Challenge (Win GH₵ ${prizePool.toFixed(2)})!`
            : `⚔️ Public Free ${gameLabel} Challenge (#${roomCode})!`,
        body: `${creatorName} posted Public Room #${roomCode}${
          stake > 0 ? ` (Stake: GH₵ ${stake.toFixed(2)})` : " (Free 1v1)"
        }. Tap to accept & play live!`,
        url: `/challenges?room=${roomCode}`,
        tag: `challenge-open-${roomCode}`,
      })
    );
  }
  if (resolvedInvitedUserId) {
    pushPromises.push(
      triggerWebPush(supabaseUrl, serviceRoleKey, {
        user_id: resolvedInvitedUserId,
        title: isPrivate
          ? `🔒 Private ${gameLabel} Invite from ${creatorName}!`
          : `🎯 ${creatorName} Challenged You to ${gameLabel}!`,
        body: `Room #${roomCode} • ${
          stake > 0
            ? `Stake GH₵ ${stake.toFixed(2)} • Win GH₵ ${prizePool.toFixed(2)}`
            : "Free 1v1 Match"
        }. Tap to accept now!`,
        url: `/challenges?room=${roomCode}`,
        tag: `challenge-invite-${roomCode}`,
      })
    );
  }

  // 3. SMS Notifications (Direct Invite SMS + Arena Players Broadcast SMS for Public Challenges)
  const smsTask = (async () => {
    try {
      const smsConfig = await getSmsConfig(supabaseAdmin);

      // 3a. Direct Personal Invite SMS
      if (cleanInvitePhone) {
        const inviteSmsBody =
          stake > 0
            ? `SwiftData Arena: ${creatorName} sent you a ${
                isPrivate ? "PRIVATE " : ""
              }${gameLabel} Challenge! Stake: GHS ${stake.toFixed(2)} | Win: GHS ${prizePool.toFixed(
                2
              )}. Room #${roomCode}. Accept live: https://swiftdatagh.shop/challenges?room=${roomCode}`
            : `SwiftData Arena: ${creatorName} invited you to a Free 1v1 ${
                isPrivate ? "Private " : ""
              }${gameLabel} Challenge! Room #${roomCode}. Tap to play live: https://swiftdatagh.shop/challenges?room=${roomCode}`;
        await dispatchUnifiedSms(
          smsConfig.gateway,
          smsConfig.apiKey,
          smsConfig.senderId || "SwiftData",
          cleanInvitePhone,
          inviteSmsBody,
          "broadcast"
        );
        directSmsSent = true;
      }

      // 3b. Broadcast SMS to Active Arena Players (ONLY for Public Challenges)
      if (broadcastAll && !isPrivate) {
        const recipients = await collectArenaRecipientPhones(
          supabaseAdmin,
          [challenge.creator_phone, cleanInvitePhone],
          20
        );
        if (recipients.length > 0) {
          const broadcastSmsBody =
            stake > 0
              ? `SwiftData Arena: ${creatorName} posted a Public ${gameLabel} Challenge! Stake: GHS ${stake.toFixed(
                  2
                )} | Win: GHS ${prizePool.toFixed(
                  2
                )} (Room #${roomCode}). Accept now: https://swiftdatagh.shop/challenges?room=${roomCode}`
              : `SwiftData Arena: ${creatorName} opened a Public Free 1v1 ${gameLabel} Room (#${roomCode})! Join live: https://swiftdatagh.shop/challenges?room=${roomCode}`;
          const bulkRes = await dispatchUnifiedBulkSms(
            smsConfig.gateway,
            smsConfig.apiKey,
            smsConfig.senderId || "SwiftData",
            recipients,
            broadcastSmsBody,
            "broadcast"
          );
          arenaSmsCount = Number(bulkRes?.sent || 0);
        }
      }
    } catch (smsErr) {
      console.warn("[challenge-arena] SMS dispatch warning:", smsErr);
    }
  })();

  const [pushCounts] = await Promise.all([Promise.all(pushPromises), smsTask]);
  pushSent = pushCounts.reduce((acc, n) => acc + (n || 0), 0);

  return { inAppSent, pushSent, directSmsSent, arenaSmsCount };
}

/**
 * Multi-channel notification dispatcher when an Open Challenge is ACCEPTED by an opponent.
 * Notifies:
 *  - The challenge creator directly (In-App + Web Push + Direct SMS)
 *  - Other Arena players ONLY if it was a Public Challenge
 */
async function notifyChallengeAccepted(
  supabaseAdmin: any,
  supabaseUrl: string,
  serviceRoleKey: string,
  challenge: any
): Promise<void> {
  const gameLabel = formatGameLabel(challenge.game_type);
  const stake = Number(challenge.stake_amount || 0);
  const prizePool = Number(challenge.prize_pool || 0);
  const roomCode = String(challenge.room_code || "");
  const creatorName = String(challenge.creator_name || "Challenger 1");
  const opponentName = String(challenge.opponent_name || "Challenger 2");
  const isPrivate = Boolean(challenge?.metadata?.is_private);

  // 1. Insert In-App Notification ONLY for the challenge creator (never global `all` spam)
  try {
    if (challenge.creator_id && challenge.creator_id !== challenge.opponent_id) {
      await supabaseAdmin.from("notifications").insert([
        {
          title: `🚨 ${opponentName} Accepted Your ${gameLabel} Challenge (#${roomCode})!`,
          message:
            stake > 0
              ? `${opponentName} accepted your GH₵ ${stake.toFixed(2)} ${gameLabel} Challenge! Open Room #${roomCode} now — the match is LIVE for GH₵ ${prizePool.toFixed(2)}!`
              : `${opponentName} joined your ${gameLabel} Room #${roomCode}! The match is LIVE now!`,
          target_type: "specific",
          target_user_id: challenge.creator_id,
          created_by: challenge.opponent_id || null,
        },
      ]);
    }
  } catch (err) {
    console.warn("[challenge-arena] Accepted in-app notification warning:", err);
  }

  // 2. Web Push (Creator Push + Public Broadcast if not private)
  const pushJobs: Promise<number>[] = [];
  if (!isPrivate) {
    pushJobs.push(
      triggerWebPush(supabaseUrl, serviceRoleKey, {
        broadcast: true,
        title: `🔥 Challenge Accepted: ${creatorName} vs ${opponentName}!`,
        body: `${opponentName} accepted the ${gameLabel} duel${
          prizePool > 0 ? ` for GH₵ ${prizePool.toFixed(2)}` : ""
        } (Room #${roomCode}). Join the Arena now!`,
        url: `/challenges?room=${roomCode}`,
        tag: `challenge-accepted-${roomCode}`,
      })
    );
  }
  if (challenge.creator_id) {
    pushJobs.push(
      triggerWebPush(supabaseUrl, serviceRoleKey, {
        user_id: challenge.creator_id,
        title: `🚨 ${opponentName} Joined Your ${gameLabel} Room (#${roomCode})!`,
        body:
          prizePool > 0
            ? `Room #${roomCode} is LIVE! Play now to win GH₵ ${prizePool.toFixed(2)}!`
            : `Room #${roomCode} is LIVE! Make your move now!`,
        url: `/challenges?room=${roomCode}`,
        tag: `challenge-creator-start-${roomCode}`,
      })
    );
  }

  // 3. SMS to Creator (+ Active Arena Players if public)
  const smsJob = (async () => {
    try {
      const smsConfig = await getSmsConfig(supabaseAdmin);
      const creatorPhone = normalizePhone(challenge.creator_phone);

      // 3a. Direct SMS to Challenge Creator
      if (creatorPhone) {
        const creatorSms =
          prizePool > 0
            ? `SwiftData Arena: ${opponentName} just ACCEPTED your ${gameLabel} Challenge (Room #${roomCode}, Pot: GHS ${prizePool.toFixed(
                2
              )})! Play your turn now: https://swiftdatagh.shop/challenges?room=${roomCode}`
            : `SwiftData Arena: ${opponentName} just JOINED your ${gameLabel} Challenge (Room #${roomCode})! Play live now: https://swiftdatagh.shop/challenges?room=${roomCode}`;
        await dispatchUnifiedSms(
          smsConfig.gateway,
          smsConfig.apiKey,
          smsConfig.senderId || "SwiftData",
          creatorPhone,
          creatorSms,
          "broadcast"
        );
      }

      // 3b. Notify other Arena players via SMS ONLY for public challenges with a cash pot
      if (!isPrivate && prizePool > 0) {
        const otherPlayers = await collectArenaRecipientPhones(
          supabaseAdmin,
          [challenge.creator_phone, challenge.opponent_phone],
          15
        );
        if (otherPlayers.length > 0) {
          const arenaAcceptedSms = `SwiftData Arena: ${opponentName} just accepted ${creatorName}'s ${gameLabel} Challenge for GHS ${prizePool.toFixed(
            2
          )} (Room #${roomCode})! Join or post your challenge: https://swiftdatagh.shop/challenges`;
          await dispatchUnifiedBulkSms(
            smsConfig.gateway,
            smsConfig.apiKey,
            smsConfig.senderId || "SwiftData",
            otherPlayers,
            arenaAcceptedSms,
            "broadcast"
          );
        }
      }
    } catch (err) {
      console.warn("[challenge-arena] Accepted SMS dispatch warning:", err);
    }
  })();

  await Promise.all([Promise.all(pushJobs), smsJob]);
}

async function verifyPaystackReference(
  supabaseAdmin: any,
  reference: string,
  expectedAmountGhs: number
): Promise<{ ok: boolean; amountGhs: number; reason?: string }> {
  if (!reference) {
    return { ok: false, amountGhs: 0, reason: "Missing Paystack payment reference" };
  }

  let secretKey = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim() || "";
  if (!secretKey) {
    const { data: settings } = await supabaseAdmin
      .from("v_system_settings_with_secrets")
      .select("paystack_secret_key")
      .eq("id", 1)
      .maybeSingle();
    secretKey = settings?.paystack_secret_key?.trim() || "";
  }

  // Prevent replay of the same Paystack reference across multiple challenges
  const { data: existingCreatorRef } = await supabaseAdmin
    .from("game_challenges")
    .select("id")
    .or(`creator_paystack_ref.eq.${reference},opponent_paystack_ref.eq.${reference}`)
    .limit(1);

  if (existingCreatorRef && existingCreatorRef.length > 0) {
    return { ok: false, amountGhs: 0, reason: "This Mobile Money reference has already been used for a challenge" };
  }

  // 1. Check if reference was already verified via SwiftData's PaystackMomoCheckout (`orders` table)
  try {
    const { data: orderRow } = await supabaseAdmin
      .from("orders")
      .select("id, status, amount, paystack_verified_amount")
      .or(`id.eq.${reference},provider_order_id.eq.${reference}`)
      .maybeSingle();

    if (
      orderRow &&
      ["paid", "processing", "fulfilled"].includes(String(orderRow.status || "").toLowerCase())
    ) {
      const verifiedAmt = Number(orderRow.paystack_verified_amount || orderRow.amount || 0);
      if (verifiedAmt + 0.05 >= expectedAmountGhs) {
        return { ok: true, amountGhs: verifiedAmt };
      }
    }
  } catch (_err) {
    // continue to direct Paystack API check
  }

  if (!secretKey) {
    return { ok: false, amountGhs: 0, reason: "Payment gateway secret key is not configured" };
  }

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: "application/json",
    },
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.status || payload?.data?.status !== "success") {
    return {
      ok: false,
      amountGhs: 0,
      reason: payload?.message || "Mobile Money payment could not be verified as successful",
    };
  }

  const paidGhs = Number(payload.data.amount || 0) / 100;
  if (paidGhs + 0.05 < expectedAmountGhs) {
    return {
      ok: false,
      amountGhs: paidGhs,
      reason: `Verified MoMo amount (GHS ${paidGhs.toFixed(2)}) is less than the required stake (GHS ${expectedAmountGhs.toFixed(2)})`,
    };
  }

  return { ok: true, amountGhs: paidGhs };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ success: false, error: "Server configuration missing" }, 500);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  await ensureChallengeSchema(supabaseAdmin);

  // Extract optional authenticated user
  let authUser: any = null;
  const authHeader = req.headers.get("authorization") || req.headers.get("x-user-access-token") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "").trim();
    if (token && token !== SUPABASE_SERVICE_ROLE_KEY) {
      const { data: userData } = await supabaseAdmin.auth.getUser(token);
      if (userData?.user) authUser = userData.user;
    }
  }

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body.action || "get_lobby");

    // Load arena settings (fallback to sensible defaults if table is being initialized)
    const { data: settingsRow } = await supabaseAdmin
      .from("game_arena_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    const settings = settingsRow || {
      arena_enabled: true,
      free_data_rewards_enabled: true,
      daily_free_data_limit: 15,
      free_data_package_size: "1GB",
      free_data_win_streak_required: 2,
      house_commission_percent: 10,
      min_stake_ghs: 2,
      max_stake_ghs: 200,
      enabled_games: { oware: true, ludo: true, dame: true },
    };

    // ── 1. GET LOBBY DATA ───────────────────────────────────────────────────────
    if (action === "get_lobby") {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const [
        { data: challenges },
        { data: recentClaims },
        { count: todayFreeDataCount },
      ] = await Promise.all([
        supabaseAdmin
          .from("game_challenges")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(60),
        supabaseAdmin
          .from("game_reward_claims")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(25),
        supabaseAdmin
          .from("game_reward_claims")
          .select("id", { count: "exact", head: true })
          .eq("reward_type", "free_data")
          .gte("created_at", todayStart.toISOString()),
      ]);

      const normalizedChallenges = (challenges || []).map((c: any) =>
        c?.metadata?.actual_game_type ? { ...c, game_type: c.metadata.actual_game_type } : c
      );

      return jsonResponse({
        success: true,
        settings,
        challenges: normalizedChallenges,
        recent_claims: recentClaims || [],
        today_free_data_claimed: todayFreeDataCount || 0,
      });
    }

    // ── 1B. SEARCH REGISTERED PLAYERS TO INVITE ─────────────────────────────────
    if (action === "search_players") {
      const q = String(body.query || "").trim();
      let queryBuilder = supabaseAdmin
        .from("profiles")
        .select("user_id, full_name, phone, is_agent")
        .not("full_name", "is", null)
        .order("updated_at", { ascending: false })
        .limit(10);

      if (q.length >= 2) {
        queryBuilder = queryBuilder.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`);
      }

      const { data: rows } = await queryBuilder;
      const players = (rows || [])
        .filter((r: any) => !authUser || r.user_id !== authUser.id)
        .map((r: any) => {
          const rawPhone = String(r.phone || "").trim();
          const maskedPhone =
            rawPhone.length >= 7
              ? `${rawPhone.slice(0, 4)}***${rawPhone.slice(-3)}`
              : rawPhone || "App User";
          return {
            user_id: r.user_id,
            full_name: r.full_name || "SwiftData Player",
            masked_phone: maskedPhone,
            phone: rawPhone,
            is_agent: Boolean(r.is_agent),
          };
        });

      return jsonResponse({ success: true, players });
    }

    // ── 2. CREATE CHALLENGE ─────────────────────────────────────────────────────
    if (action === "create_challenge") {
      if (!settings.arena_enabled) {
        return jsonResponse({ success: false, error: "The Challenge Arena is temporarily paused by Admin." }, 400);
      }

      const gameType = String(body.game_type || "oware").toLowerCase();
      if (!["oware", "ludo", "dame", "pool", "slash", "candy", "buggy"].includes(gameType)) {
        return jsonResponse({ success: false, error: "Unsupported game type" }, 400);
      }
      if (settings.enabled_games && settings.enabled_games[gameType] === false) {
        return jsonResponse({ success: false, error: `${gameType.toUpperCase()} is currently disabled by Admin.` }, 400);
      }

      const mode = String(body.mode || "p2p").toLowerCase(); // 'p2p' | 'ai' | 'free_data'
      const rawStake = mode === "free_data" ? 0 : Math.max(0, Number(body.stake_amount || 0));
      const paymentSource =
        mode === "free_data" || rawStake === 0
          ? "free"
          : String(body.payment_source || "wallet").toLowerCase();
      const creatorName = String(body.creator_name || authUser?.user_metadata?.full_name || "Ghana Champion").trim().slice(0, 40);
      const creatorPhone = String(body.creator_phone || "").trim().slice(0, 15);
      const invitedPhone = String(body.invited_phone || "").trim().slice(0, 15);
      const invitedUserId = body.invited_user_id ? String(body.invited_user_id).trim() : null;
      const invitedName = body.invited_name ? String(body.invited_name).trim() : null;

      const rewardType =
        mode === "free_data" || rawStake === 0
          ? "free_data"
          : String(body.reward_type || "wallet_cash");
      const rewardNetwork = String(body.reward_network || "MTN").toUpperCase();
      const rewardDataSize =
        mode === "free_data" || rawStake === 0
          ? String(settings.free_data_package_size || "1GB")
          : String(body.reward_data_size || "1GB");

      if (mode !== "free_data") {
        // Allow rawStake === 0 in 'p2p' mode for Free 1v1 Friendly Online Rooms!
        if (rawStake > 0 || mode === "ai") {
          if (rawStake < Number(settings.min_stake_ghs || 1)) {
            return jsonResponse({
              success: false,
              error: `Minimum challenge stake is GH₵ ${Number(settings.min_stake_ghs || 1).toFixed(2)}`,
            }, 400);
          }
          if (rawStake > Number(settings.max_stake_ghs || 200)) {
            return jsonResponse({
              success: false,
              error: `Maximum challenge stake is GH₵ ${Number(settings.max_stake_ghs || 200).toFixed(2)}`,
            }, 400);
          }
        }
      } else if (!settings.free_data_rewards_enabled) {
        return jsonResponse({
          success: false,
          error: "Free Data Challenges are currently paused. You can still play Wallet or MoMo stake challenges!",
        }, 400);
      }

      // Handle stake collection
      let verifiedPaystackRef: string | null = null;
      if (rawStake > 0) {
        if (paymentSource === "wallet") {
          if (!authUser) {
            return jsonResponse({
              success: false,
              error: "Please sign in to stake from your Wallet Balance, or switch to Mobile Money (MoMo) stake.",
            }, 401);
          }

          const { data: wallet } = await supabaseAdmin
            .from("wallets")
            .select("balance")
            .eq("agent_id", authUser.id)
            .maybeSingle();

          const currentBal = Number(wallet?.balance || 0);
          if (currentBal < rawStake) {
            return jsonResponse({
              success: false,
              error: `Insufficient wallet balance (GH₵ ${currentBal.toFixed(2)}). Top up your wallet or use Mobile Money (MoMo) to stake.`,
            }, 400);
          }

          const newBal = Number((currentBal - rawStake).toFixed(2));
          const { error: deductErr } = await supabaseAdmin
            .from("wallets")
            .update({ balance: newBal, updated_at: new Date().toISOString() })
            .eq("agent_id", authUser.id);

          if (deductErr) {
            return jsonResponse({ success: false, error: "Failed to lock stake from wallet" }, 500);
          }
        } else if (paymentSource === "momo") {
          const ref = String(body.paystack_reference || "").trim();
          const verified = await verifyPaystackReference(supabaseAdmin, ref, rawStake);
          if (!verified.ok) {
            return jsonResponse({ success: false, error: verified.reason || "MoMo verification failed" }, 400);
          }
          verifiedPaystackRef = ref;
        } else {
          return jsonResponse({ success: false, error: "Invalid payment source for paid challenge" }, 400);
        }
      }

      const housePercent = Number(settings.house_commission_percent || 10);
      const grossPool = mode === "p2p" ? rawStake * 2 : Number((rawStake * 1.8).toFixed(2));
      const houseFee = mode === "p2p"
        ? Number(((grossPool * housePercent) / 100).toFixed(2))
        : Number((rawStake * 0.2).toFixed(2));
      const netPrizePool = mode === "p2p"
        ? Number((grossPool - houseFee).toFixed(2))
        : grossPool;

      const isImmediateStart = mode === "ai" || mode === "free_data";
      const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const humanSenseChallengerMap: Record<string, string> = {
        slash: "Auntie Ama Serwaa (94% Human Sense)",
        candy: "Efua Mensah (93% Human Sense)",
        buggy: "Kwame 'Suame Turbo' Mensah (93% Human Sense)",
        pool: "Yaw Boateng (92% Human Sense)",
        oware: "Nana Kwame Asante (93% Human Sense)",
        ludo: "Abena Osei (91% Human Sense)",
        dame: "Kofi Mensah (94% Human Sense)",
      };
      const challengerPersonaName =
        humanSenseChallengerMap[gameType] || "Kojo Mensah (94% Human Sense)";

      const rematchOfChallengeId = body.rematch_of_challenge_id
        ? String(body.rematch_of_challenge_id).trim()
        : null;
      const isPrivateChallenge =
        body.is_private !== undefined
          ? Boolean(body.is_private)
          : Boolean(invitedPhone || invitedUserId || rematchOfChallengeId);

      const baseChallengePayload = {
        room_code: roomCode,
        game_type: gameType,
        mode,
        title:
          body.title ||
          `${creatorName}'s ${isPrivateChallenge ? "Private " : ""}${gameType.toUpperCase()} Challenge`,
        creator_id: authUser?.id || null,
        creator_name: creatorName,
        creator_phone: creatorPhone || null,
        creator_payment_source: paymentSource,
        creator_paystack_ref: verifiedPaystackRef,
        opponent_id: null,
        opponent_name: isImmediateStart ? challengerPersonaName : null,
        opponent_payment_source: isImmediateStart ? "ai" : null,
        stake_amount: rawStake,
        prize_pool: netPrizePool,
        house_fee: houseFee,
        reward_type: rewardType,
        reward_network: rewardNetwork,
        reward_data_size: rewardDataSize,
        board_state: body.board_state || body.initial_board_state || {},
        current_turn: "creator",
        status: isImmediateStart ? "in_progress" : "open",
        metadata: {
          actual_game_type: gameType,
          is_private: isPrivateChallenge,
          invited_phone: invitedPhone || null,
          invited_user_id: invitedUserId || null,
          invited_name: invitedName || null,
          rematch_of_challenge_id: rematchOfChallengeId,
        },
      };

      let { data: created, error: insertErr } = await supabaseAdmin
        .from("game_challenges")
        .insert(baseChallengePayload)
        .select("*")
        .single();

      // Fallback if DB check constraint hasn't been migrated for a new game_type yet
      if (insertErr && String(insertErr.message || "").includes("game_challenges_game_type_check")) {
        const retryRes = await supabaseAdmin
          .from("game_challenges")
          .insert({
            ...baseChallengePayload,
            game_type: "oware",
          })
          .select("*")
          .single();
        created = retryRes.data ? { ...retryRes.data, game_type: gameType } : null;
        insertErr = retryRes.error;
      }

      if (insertErr) {
        return jsonResponse({ success: false, error: insertErr.message }, 500);
      }
      if (created && created.metadata?.actual_game_type) {
        created.game_type = created.metadata.actual_game_type;
      }

      // If this challenge is a rematch of a completed match, link the new room code back onto the completed challenge so the opponent's Winner Popup updates in real time!
      if (rematchOfChallengeId && created) {
        try {
          const { data: prevFinished } = await supabaseAdmin
            .from("game_challenges")
            .select("metadata, board_state")
            .eq("id", rematchOfChallengeId)
            .maybeSingle();

          const prevMeta =
            prevFinished?.metadata && typeof prevFinished.metadata === "object"
              ? prevFinished.metadata
              : {};
          const prevBoard =
            prevFinished?.board_state && typeof prevFinished.board_state === "object"
              ? prevFinished.board_state
              : {};

          await supabaseAdmin
            .from("game_challenges")
            .update({
              metadata: {
                ...prevMeta,
                next_rematch_room_code: created.room_code,
                next_rematch_challenge_id: created.id,
                rematch_requested_by: creatorName,
              },
              board_state: {
                ...prevBoard,
                nextRematchRoomCode: created.room_code,
                nextRematchChallengeId: created.id,
                rematchRequestedBy: creatorName,
              },
              updated_at: new Date().toISOString(),
            })
            .eq("id", rematchOfChallengeId);
        } catch (rematchLinkErr) {
          console.warn("[challenge-arena] Rematch link update warning:", rematchLinkErr);
        }
      }

      // When an Open 1v1 Challenge is posted:
      //  - Private Challenge: Notify ONLY the invited friend (In-App + Web Push + Direct SMS)
      //  - Public Challenge: Notify all online & subscribed Arena players + post Challenge Card to Global Chat
      let notifyStats = { inAppSent: false, pushSent: 0, directSmsSent: false, arenaSmsCount: 0 };
      if (!isImmediateStart && created) {
        notifyStats = await notifyOpenChallengeOrInvite(
          supabaseAdmin,
          SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY,
          created,
          {
            invitedPhone: invitedPhone || null,
            invitedUserId: invitedUserId || null,
            invitedName: invitedName || null,
            broadcastAll: !isPrivateChallenge,
            isPrivate: isPrivateChallenge,
            createdByUserId: authUser?.id || null,
          }
        );

        // Drop an interactive Challenge Card into Global Gamer Chat for Public Challenges (or targeted invite)
        if (!isPrivateChallenge || invitedUserId || invitedName) {
          try {
            const gameLabel = formatGameLabel(gameType);
            const maskedCreatorPhone =
              creatorPhone.length >= 7
                ? `${creatorPhone.slice(0, 4)}***${creatorPhone.slice(-3)}`
                : null;
            const cardText = isPrivateChallenge
              ? `🔒 Sent a Private ${gameLabel} Challenge invite to @${
                  invitedName || "Friend"
                }! (${
                  rawStake > 0
                    ? `Stake GH₵ ${rawStake.toFixed(2)} • Win GH₵ ${netPrizePool.toFixed(2)}`
                    : "Free 1v1 Duel"
                })`
              : invitedName
              ? `🎯 Challenged @${invitedName} to a live ${gameLabel} duel! Room #${roomCode} (${
                  rawStake > 0
                    ? `Stake GH₵ ${rawStake.toFixed(2)} • Win GH₵ ${netPrizePool.toFixed(2)}`
                    : "Free Skill Duel"
                }).`
              : `⚔️ Open Public ${gameLabel} Challenge in Room #${roomCode}! ${
                  rawStake > 0
                    ? `Stake GH₵ ${rawStake.toFixed(2)} to win GH₵ ${netPrizePool.toFixed(2)}!`
                    : "Free entry — play to earn Free Data!"
                } Who is stepping up?`;

            await supabaseAdmin.from("game_community_messages").insert({
              channel: "global",
              sender_id: authUser?.id || null,
              sender_name: creatorName,
              sender_phone_masked: maskedCreatorPhone,
              sender_level: Math.max(1, Number(body.player_level || 1)),
              sender_title: String(body.player_title || "Arena Challenger"),
              favorite_game: gameType,
              message_type:
                isPrivateChallenge || invitedName || invitedUserId
                  ? "direct_invite"
                  : "challenge_card",
              message: cardText,
              challenge_id: created.id,
              room_code: isPrivateChallenge ? null : roomCode,
              game_type: gameType,
              stake_amount: rawStake,
              prize_pool: netPrizePool,
              target_user_id: invitedUserId || null,
              target_user_name: invitedName || null,
            });
          } catch (chatErr) {
            console.warn("[challenge-arena] Auto community challenge card insert warning:", chatErr);
          }
        }
      }

      return jsonResponse({
        success: true,
        challenge: created,
        notifications: notifyStats,
        message: isImmediateStart
          ? `Match started against ${challengerPersonaName} (Medium Difficulty)! Earn points & win!`
          : isPrivateChallenge
          ? invitedPhone || invitedName
            ? `Private Challenge #${roomCode} created! Direct invite sent to ${invitedName || invitedPhone}!`
            : `Private Room #${roomCode} created! Share your Room Code with your friend to start!`
          : invitedPhone || invitedName
          ? `Public Challenge #${roomCode} posted to Arena Lobby + direct invite sent to ${invitedName || invitedPhone}!`
          : `Public Challenge #${roomCode} posted to the Live Arena Lobby! Online players notified!`,
      });
    }

    // ── 2A. GET SINGLE CHALLENGE ROOM BY CODE OR ID ─────────────────────────────
    if (action === "get_room") {
      const challengeId = String(body.challenge_id || "").trim();
      const roomCode = String(body.room_code || "")
        .trim()
        .toUpperCase()
        .replace(/^#/, "");

      if (!challengeId && !roomCode) {
        return jsonResponse({ success: false, error: "Provide a room_code or challenge_id" }, 400);
      }

      let query = supabaseAdmin.from("game_challenges").select("*");
      query = challengeId ? query.eq("id", challengeId) : query.eq("room_code", roomCode);
      const { data: roomRow } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();

      if (!roomRow) {
        return jsonResponse({ success: false, error: `No room found with code #${roomCode || challengeId}` }, 404);
      }

      if (roomRow.metadata?.actual_game_type) {
        roomRow.game_type = roomRow.metadata.actual_game_type;
      }

      return jsonResponse({
        success: true,
        challenge: roomRow,
      });
    }

    // ── 2B. INVITE SPECIFIC PLAYER OR RE-BROADCAST OPEN CHALLENGE ───────────────
    if (action === "invite_player") {
      const challengeId = String(body.challenge_id || "").trim();
      const invitedPhone = String(body.invited_phone || "").trim();
      const invitedUserId = body.invited_user_id ? String(body.invited_user_id).trim() : null;
      const invitedName = body.invited_name ? String(body.invited_name).trim() : null;
      const broadcastAll = Boolean(body.broadcast_all);

      if (!invitedPhone && !invitedUserId && !broadcastAll) {
        return jsonResponse(
          { success: false, error: "Enter a player phone number, select a user, or choose Broadcast to All." },
          400
        );
      }

      const { data: challenge } = await supabaseAdmin
        .from("game_challenges")
        .select("*")
        .eq("id", challengeId)
        .maybeSingle();

      if (!challenge || challenge.status !== "open") {
        return jsonResponse({ success: false, error: "Open challenge not found or already started." }, 404);
      }

      if (challenge.metadata?.actual_game_type) {
        challenge.game_type = challenge.metadata.actual_game_type;
      }

      // If user explicitly clicks "Notify Online Players" (broadcast_all), also make the challenge public in metadata so others can see and join it
      if (broadcastAll && challenge.metadata?.is_private) {
        const updatedMeta = { ...(challenge.metadata || {}), is_private: false };
        await supabaseAdmin
          .from("game_challenges")
          .update({ metadata: updatedMeta, updated_at: new Date().toISOString() })
          .eq("id", challengeId);
        challenge.metadata = updatedMeta;
      }

      const stats = await notifyOpenChallengeOrInvite(
        supabaseAdmin,
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        challenge,
        {
          invitedPhone: invitedPhone || null,
          invitedUserId,
          invitedName,
          broadcastAll,
          isPrivate: broadcastAll ? false : Boolean(challenge.metadata?.is_private),
          createdByUserId: authUser?.id || challenge.creator_id || null,
        }
      );

      return jsonResponse({
        success: true,
        stats,
        challenge,
        message: invitedPhone || invitedName
          ? `Challenge invite sent to ${invitedName || invitedPhone} via SMS, Web Push & In-App alert!`
          : `Challenge #${challenge.room_code} broadcasted to all online & subscribed users!`,
      });
    }

    // ── 3. JOIN OPEN P2P CHALLENGE (PUBLIC OR PRIVATE BY ROOM CODE) ─────────────
    if (action === "join_challenge") {
      const challengeId = String(body.challenge_id || "").trim();
      const roomCodeInput = String(body.room_code || "")
        .trim()
        .toUpperCase()
        .replace(/^#/, "");
      const joinedByRoomCode = Boolean(body.by_room_code || roomCodeInput);
      const paymentSource = String(body.payment_source || "wallet").toLowerCase();
      const opponentName = String(
        body.opponent_name || authUser?.user_metadata?.full_name || "Challenger 2"
      )
        .trim()
        .slice(0, 40);
      const opponentPhone = String(body.opponent_phone || "").trim().slice(0, 15);

      let lookupQuery = supabaseAdmin.from("game_challenges").select("*");
      lookupQuery = challengeId
        ? lookupQuery.eq("id", challengeId)
        : lookupQuery.eq("room_code", roomCodeInput);
      const { data: challenge } = await lookupQuery
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!challenge) {
        return jsonResponse({ success: false, error: "Challenge room not found" }, 404);
      }
      if (challenge.status !== "open") {
        return jsonResponse({ success: false, error: "This challenge is no longer open" }, 400);
      }
      if (authUser && challenge.creator_id && challenge.creator_id === authUser.id) {
        return jsonResponse({
          success: false,
          error:
            "You created this challenge! Share the room code with your friend or wait for them to join.",
        }, 400);
      }

      // If this is a Private Challenge with a specific invited user/phone, verify access unless joining with the Room Code
      if (challenge.metadata?.is_private && !joinedByRoomCode) {
        const invitedUid = challenge.metadata?.invited_user_id;
        const invitedPh = String(challenge.metadata?.invited_phone || "")
          .replace(/\D/g, "")
          .slice(-9);
        const myPh = opponentPhone.replace(/\D/g, "").slice(-9);
        const matchesUser = Boolean(invitedUid && authUser?.id && invitedUid === authUser.id);
        const matchesPhone = Boolean(invitedPh && myPh && invitedPh.length >= 9 && invitedPh === myPh);

        if ((invitedUid || invitedPh) && !matchesUser && !matchesPhone) {
          return jsonResponse(
            {
              success: false,
              error:
                "This is a Private Challenge reserved for the invited player. Enter the Room Code to join if you were invited.",
            },
            403
          );
        }
      }

      const targetChallengeId = challenge.id;
      const stake = Number(challenge.stake_amount || 0);
      let verifiedPaystackRef: string | null = null;

      if (stake > 0) {
        if (paymentSource === "wallet") {
          if (!authUser) {
            return jsonResponse({
              success: false,
              error: "Please sign in to join using your Wallet Balance, or choose Mobile Money (MoMo).",
            }, 401);
          }

          const { data: wallet } = await supabaseAdmin
            .from("wallets")
            .select("balance")
            .eq("agent_id", authUser.id)
            .maybeSingle();

          const currentBal = Number(wallet?.balance || 0);
          if (currentBal < stake) {
            return jsonResponse({
              success: false,
              error: `Insufficient wallet balance (GH₵ ${currentBal.toFixed(2)}). Required stake: GH₵ ${stake.toFixed(2)}`,
            }, 400);
          }

          const newBal = Number((currentBal - stake).toFixed(2));
          const { error: deductErr } = await supabaseAdmin
            .from("wallets")
            .update({ balance: newBal, updated_at: new Date().toISOString() })
            .eq("agent_id", authUser.id);

          if (deductErr) {
            return jsonResponse({ success: false, error: "Could not deduct stake from wallet" }, 500);
          }
        } else if (paymentSource === "momo") {
          const ref = String(body.paystack_reference || "").trim();
          const verified = await verifyPaystackReference(supabaseAdmin, ref, stake);
          if (!verified.ok) {
            return jsonResponse({ success: false, error: verified.reason || "MoMo verification failed" }, 400);
          }
          verifiedPaystackRef = ref;
        } else {
          return jsonResponse({ success: false, error: "Invalid payment source" }, 400);
        }
      }

      // Give the accepting challenger (who is actively in the room right now) the immediate opening turn if no moves have been made yet
      const prevBoard =
        challenge.board_state && typeof challenge.board_state === "object"
          ? { ...challenge.board_state }
          : {};
      const hasMovesAlready =
        Number(prevBoard.moveCount || 0) > 0 ||
        Number(prevBoard.shotCount || 0) > 0 ||
        Number(prevBoard.engine?.moveCount || 0) > 0;

      const nextTurnOnJoin = hasMovesAlready
        ? String(challenge.current_turn || "creator")
        : "opponent";

      if (!hasMovesAlready) {
        prevBoard.turn = "opponent";
        if (prevBoard.engine && typeof prevBoard.engine === "object") {
          const eng = { ...prevBoard.engine };
          const playersArr = Array.isArray(eng.players) ? eng.players : ["RED", "YELLOW"];
          const yellowIdx = Math.max(0, playersArr.indexOf("YELLOW"));
          eng.currentPlayer = "YELLOW";
          eng.currentPlayerIndex = yellowIdx;
          if (eng.playerMeta && typeof eng.playerMeta === "object") {
            eng.playerMeta = {
              ...eng.playerMeta,
              YELLOW: {
                ...(eng.playerMeta.YELLOW || {}),
                name: opponentName,
                isAI: false,
              },
            };
          }
          prevBoard.engine = eng;
        }
      }

      const { data: updated, error: joinErr } = await supabaseAdmin
        .from("game_challenges")
        .update({
          opponent_id: authUser?.id || (body.opponent_id ? String(body.opponent_id) : null),
          opponent_name: opponentName,
          opponent_phone: opponentPhone || null,
          opponent_payment_source: stake > 0 ? paymentSource : "free",
          opponent_paystack_ref: verifiedPaystackRef,
          current_turn: nextTurnOnJoin,
          board_state: prevBoard,
          status: "in_progress",
          updated_at: new Date().toISOString(),
        })
        .eq("id", targetChallengeId)
        .eq("status", "open")
        .select("*")
        .single();

      if (joinErr || !updated) {
        return jsonResponse({ success: false, error: "Could not join challenge (it may have just been taken)" }, 400);
      }

      if (updated.metadata?.actual_game_type) {
        updated.game_type = updated.metadata.actual_game_type;
      }

      // Notify the challenge creator (+ Arena players if public) via Web Push, SMS & In-App notifications!
      await notifyChallengeAccepted(
        supabaseAdmin,
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        updated
      );

      return jsonResponse({
        success: true,
        challenge: updated,
        message: `Joined ${challenge.creator_name}'s ${String(
          updated.game_type || challenge.game_type
        ).toUpperCase()} challenge! Match is LIVE!`,
      });
    }

    // ── 4. CANCEL OPEN CHALLENGE (WITH AUTOMATIC REFUND) ────────────────────────
    if (action === "cancel_challenge") {
      const challengeId = String(body.challenge_id || "").trim();
      const { data: challenge } = await supabaseAdmin
        .from("game_challenges")
        .select("*")
        .eq("id", challengeId)
        .maybeSingle();

      if (!challenge || challenge.status !== "open") {
        return jsonResponse({ success: false, error: "Only open challenges waiting for an opponent can be cancelled" }, 400);
      }

      const stake = Number(challenge.stake_amount || 0);
      if (stake > 0 && challenge.creator_payment_source === "wallet" && challenge.creator_id) {
        const { data: wallet } = await supabaseAdmin
          .from("wallets")
          .select("balance")
          .eq("agent_id", challenge.creator_id)
          .maybeSingle();

        const restoredBal = Number((Number(wallet?.balance || 0) + stake).toFixed(2));
        await supabaseAdmin
          .from("wallets")
          .update({ balance: restoredBal, updated_at: new Date().toISOString() })
          .eq("agent_id", challenge.creator_id);
      }

      const { data: cancelled } = await supabaseAdmin
        .from("game_challenges")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", challengeId)
        .select("*")
        .single();

      return jsonResponse({
        success: true,
        challenge: cancelled,
        message: stake > 0 && challenge.creator_payment_source === "wallet"
          ? `Challenge cancelled and GH₵ ${stake.toFixed(2)} refunded to your wallet.`
          : "Challenge cancelled.",
      });
    }

    // ── 5. SYNC BOARD STATE & NEXT PLAYER TURN NOTIFICATION (LIVE REALTIME MOVES) ──
    if (action === "sync_board") {
      const challengeId = String(body.challenge_id || "").trim();
      const boardState = body.board_state || {};
      const currentTurn = String(body.current_turn || "creator");
      const forceNotifyTurn = Boolean(body.notify_turn);

      const { data: prevChallenge } = await supabaseAdmin
        .from("game_challenges")
        .select("*")
        .eq("id", challengeId)
        .maybeSingle();

      const prevMeta =
        prevChallenge?.metadata && typeof prevChallenge.metadata === "object"
          ? prevChallenge.metadata
          : {};

      const turnChanged =
        Boolean(prevChallenge) && String(prevChallenge.current_turn || "creator") !== currentTurn;

      const nowMs = Date.now();
      const lastTurnSmsAt = Number(prevMeta.last_turn_sms_at || 0);
      const shouldSendTurnSms =
        forceNotifyTurn || (turnChanged && nowMs - lastTurnSmsAt > 90_000);

      const nextMeta = shouldSendTurnSms
        ? { ...prevMeta, last_turn_sms_at: nowMs, last_turn_notified_side: currentTurn }
        : prevMeta;

      const { data: updated, error: syncErr } = await supabaseAdmin
        .from("game_challenges")
        .update({
          board_state: boardState,
          current_turn: currentTurn,
          metadata: nextMeta,
          updated_at: new Date().toISOString(),
        })
        .eq("id", challengeId)
        .select("*")
        .single();

      if (syncErr) {
        return jsonResponse({ success: false, error: syncErr.message }, 500);
      }

      // Notify the next player when the turn flips in a live P2P match (or on explicit Nudge)
      let turnNotificationSent = false;
      if (
        prevChallenge &&
        prevChallenge.status === "in_progress" &&
        (prevChallenge.mode === "p2p" || forceNotifyTurn) &&
        (turnChanged || forceNotifyTurn) &&
        !boardState?.winner
      ) {
        const gameLabel = formatGameLabel(prevChallenge.game_type);
        const roomCode = String(prevChallenge.room_code || "");
        const isCreatorNext = currentTurn === "creator";
        const nextUserId = isCreatorNext ? prevChallenge.creator_id : prevChallenge.opponent_id;
        const nextPlayerName = isCreatorNext
          ? String(prevChallenge.creator_name || "Player 1")
          : String(prevChallenge.opponent_name || "Challenger");
        const prevPlayerName = isCreatorNext
          ? String(prevChallenge.opponent_name || "Opponent")
          : String(prevChallenge.creator_name || "Creator");

        // Also check if a 3-4 player Ludo seat has a custom invited phone/name for the active color
        const activeLudoColor = boardState?.currentPlayerColor;
        const activeLudoSeat =
          activeLudoColor && boardState?.players?.[activeLudoColor]
            ? boardState.players[activeLudoColor]
            : null;

        const rawNextPhone =
          activeLudoSeat?.invitedPhone ||
          (isCreatorNext ? prevChallenge.creator_phone : prevChallenge.opponent_phone);
        const cleanNextPhone = normalizePhone(rawNextPhone);
        const displayNextName = activeLudoSeat?.name || nextPlayerName;

        // 1. In-App Notification (`public.notifications`)
        if (nextUserId) {
          try {
            await supabaseAdmin.from("notifications").insert({
              title: `🟢 Your Turn in ${gameLabel} (Room #${roomCode})!`,
              message: `${prevPlayerName} just completed their move! It is now ${displayNextName}'s turn to play in Room #${roomCode}. Tap to make your move!`,
              target_type: "specific",
              target_user_id: nextUserId,
              created_by: isCreatorNext ? prevChallenge.opponent_id : prevChallenge.creator_id,
            });
            turnNotificationSent = true;
          } catch (notifErr) {
            console.warn("[challenge-arena] Turn in-app notification warning:", notifErr);
          }

          // 2. Web Push Notification (`send-push-notification`)
          await triggerWebPush(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            user_id: nextUserId,
            title: `🟢 Your Turn in ${gameLabel} (#${roomCode})!`,
            body: `${prevPlayerName} just played — step up and make your move now!`,
            url: `/challenges?room=${roomCode}`,
            tag: `challenge-turn-${roomCode}`,
          });
        }

        // 3. SMS Turn Alert (when explicitly nudged or throttled every 90s so players who tabbed away return)
        if (cleanNextPhone && shouldSendTurnSms) {
          try {
            const smsConfig = await getSmsConfig(supabaseAdmin);
            const turnSmsBody = `SwiftData Arena: YOUR TURN in ${gameLabel} (Room #${roomCode})! ${prevPlayerName} just played. Make your move live: https://swiftdatagh.shop/challenges?room=${roomCode}`;
            await dispatchUnifiedSms(
              smsConfig.gateway,
              smsConfig.apiKey,
              smsConfig.senderId || "SwiftData",
              cleanNextPhone,
              turnSmsBody,
              "broadcast"
            );
            turnNotificationSent = true;
          } catch (smsErr) {
            console.warn("[challenge-arena] Turn SMS warning:", smsErr);
          }
        }
      }

      return jsonResponse({
        success: true,
        challenge: updated,
        turn_notified: turnNotificationSent,
      });
    }

    // ── 6. COMPLETE MATCH & SETTLE PRIZE / FREE DATA REWARD ─────────────────────
    if (action === "complete_match") {
      const challengeId = String(body.challenge_id || "").trim();
      const winnerSide = String(body.winner_side || "creator"); // 'creator' | 'opponent' | 'draw'
      const finalBoardState = body.board_state || {};

      const { data: challenge } = await supabaseAdmin
        .from("game_challenges")
        .select("*")
        .eq("id", challengeId)
        .maybeSingle();

      if (!challenge) {
        return jsonResponse({ success: false, error: "Challenge not found" }, 404);
      }

      // Idempotency guard: if already completed, return existing record
      if (challenge.status === "completed") {
        return jsonResponse({
          success: true,
          challenge,
          already_completed: true,
        });
      }

      const isCreatorWin = winnerSide === "creator";
      const isOpponentWin = winnerSide === "opponent";
      const winnerId = isCreatorWin ? challenge.creator_id : (isOpponentWin ? challenge.opponent_id : null);
      const winnerName = isCreatorWin
        ? challenge.creator_name
        : isOpponentWin
        ? (challenge.opponent_name || "Grandmaster AI")
        : "Draw";
      const winnerPhone = isCreatorWin
        ? (body.winner_phone || challenge.creator_phone)
        : isOpponentWin
        ? (body.winner_phone || challenge.opponent_phone)
        : null;

      let rewardClaimed = false;
      let settlementMessage = "Match completed!";
      let rewardClaimRow: any = null;

      const stake = Number(challenge.stake_amount || 0);
      const prizePool = Number(challenge.prize_pool || 0);

      // Case A: Draw in a paid match -> Refund wallet stakes
      if (winnerSide === "draw" && stake > 0) {
        if (challenge.creator_payment_source === "wallet" && challenge.creator_id) {
          const { data: w1 } = await supabaseAdmin.from("wallets").select("balance").eq("agent_id", challenge.creator_id).maybeSingle();
          const nextBal1 = Number((Number(w1?.balance || 0) + stake).toFixed(2));
          if (w1) {
            await supabaseAdmin.from("wallets").update({ balance: nextBal1, updated_at: new Date().toISOString() }).eq("agent_id", challenge.creator_id);
          } else {
            await supabaseAdmin.from("wallets").insert({ agent_id: challenge.creator_id, balance: nextBal1, updated_at: new Date().toISOString() });
          }
        }
        if (challenge.opponent_payment_source === "wallet" && challenge.opponent_id) {
          const { data: w2 } = await supabaseAdmin.from("wallets").select("balance").eq("agent_id", challenge.opponent_id).maybeSingle();
          const nextBal2 = Number((Number(w2?.balance || 0) + stake).toFixed(2));
          if (w2) {
            await supabaseAdmin.from("wallets").update({ balance: nextBal2, updated_at: new Date().toISOString() }).eq("agent_id", challenge.opponent_id);
          } else {
            await supabaseAdmin.from("wallets").insert({ agent_id: challenge.opponent_id, balance: nextBal2, updated_at: new Date().toISOString() });
          }
        }
        rewardClaimed = true;
        settlementMessage = "Match ended in a draw! Wallet stakes have been returned.";
      }

      // Case B: Human player won a paid stake match
      const humanWon =
        (isCreatorWin) ||
        (isOpponentWin && challenge.mode === "p2p");

      if (humanWon && stake > 0 && prizePool > 0) {
        if (challenge.reward_type === "wallet_cash" && winnerId) {
          const { data: winnerWallet } = await supabaseAdmin
            .from("wallets")
            .select("balance")
            .eq("agent_id", winnerId)
            .maybeSingle();

          const nextBal = Number((Number(winnerWallet?.balance || 0) + prizePool).toFixed(2));
          if (winnerWallet) {
            await supabaseAdmin
              .from("wallets")
              .update({ balance: nextBal, updated_at: new Date().toISOString() })
              .eq("agent_id", winnerId);
          } else {
            await supabaseAdmin
              .from("wallets")
              .insert({
                agent_id: winnerId,
                balance: nextBal,
                updated_at: new Date().toISOString(),
              });
          }

          rewardClaimed = true;
          settlementMessage = `🎉 Victory! GH₵ ${prizePool.toFixed(2)} has been credited to ${winnerName}'s Wallet!`;

          const { data: claim } = await supabaseAdmin
            .from("game_reward_claims")
            .insert({
              challenge_id: challenge.id,
              user_id: winnerId,
              winner_name: winnerName,
              winner_phone: winnerPhone || "Wallet Account",
              network: challenge.reward_network || "MTN",
              reward_type: "wallet_cash",
              cash_amount: prizePool,
              status: "credited",
              notes: `Won ${challenge.game_type.toUpperCase()} Challenge (#${challenge.room_code})`,
              processed_at: new Date().toISOString(),
            })
            .select("*")
            .single();
          rewardClaimRow = claim;

          try {
            await supabaseAdmin.from("notifications").insert({
              user_id: winnerId,
              title: `🏆 +GH₵ ${prizePool.toFixed(2)} Match Prize Credited!`,
              message: `Congratulations ${winnerName}! You won the ${formatGameLabel(challenge.game_type)} duel (Room #${challenge.room_code}) and GH₵ ${prizePool.toFixed(2)} has been added to your Wallet.`,
              type: "promo",
              is_read: false,
            });
          } catch (notifErr) {
            console.warn("[challenge-arena] Winner wallet notification warning:", notifErr);
          }
        } else {
          // Winner either played via MoMo as guest or selected Data Bundle prize -> allow claiming phone/network
          settlementMessage = `🎉 ${winnerName} won GH₵ ${prizePool.toFixed(2)}! Enter your phone number in the Victory Popup to claim your Data Bundle or MoMo/Wallet prize.`;
        }
      } else if (humanWon && challenge.mode === "free_data") {
        settlementMessage = `🎉 You defeated the Grandmaster AI in ${challenge.game_type.toUpperCase()}! +35 Arena Points credited toward your Free ${challenge.reward_data_size || "1GB"} Data Reward!`;
      } else if (humanWon && stake === 0) {
        settlementMessage = `🎉 ${winnerName} won the 1v1 ${formatGameLabel(challenge.game_type)} duel! +35 Arena Points credited!`;
      } else if (!humanWon && winnerSide !== "draw") {
        settlementMessage = `${winnerName} won this round! Tap Rematch to win the next match!`;
      }

      const { data: updatedChallenge } = await supabaseAdmin
        .from("game_challenges")
        .update({
          status: "completed",
          winner_side: winnerSide,
          winner_id: winnerId,
          winner_name: winnerName,
          winner_phone: winnerPhone,
          board_state: finalBoardState,
          reward_claimed: rewardClaimed,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", challengeId)
        .select("*")
        .single();

      if (humanWon && updatedChallenge) {
        try {
          const gameLabel = formatGameLabel(challenge.game_type);
          const loserName = isCreatorWin
            ? challenge.opponent_name || "Challenger"
            : challenge.creator_name || "Challenger";
          const shoutMsg =
            prizePool > 0
              ? `🏆 ${winnerName} just defeated ${loserName} in ${gameLabel} (Room #${challenge.room_code}) and won GH₵ ${prizePool.toFixed(2)}!`
              : `🏆 ${winnerName} just won a ${gameLabel} match against ${loserName} (Room #${challenge.room_code})!`;
          await supabaseAdmin.from("game_community_messages").insert({
            channel: "global",
            sender_id: winnerId || null,
            sender_name: winnerName,
            sender_level: Math.max(1, Number(body.player_level || 2)),
            sender_title: "Arena Winner",
            favorite_game: challenge.game_type,
            message_type: "victory_shoutout",
            message: shoutMsg,
            challenge_id: challenge.id,
            room_code: challenge.room_code,
            game_type: challenge.game_type,
            stake_amount: stake,
            prize_pool: prizePool,
          });
        } catch (shoutErr) {
          console.warn("[challenge-arena] Victory shoutout insert warning:", shoutErr);
        }
      }

      return jsonResponse({
        success: true,
        challenge: updatedChallenge,
        reward_claim: rewardClaimRow,
        message: settlementMessage,
      });
    }

    // ── 7. CLAIM FREE DATA OR MOMO WINNER BUNDLE REWARD ─────────────────────────
    if (action === "claim_reward") {
      const challengeId = String(body.challenge_id || "").trim();
      const phone = String(body.phone || "").replace(/\D+/g, "");
      const network = String(body.network || "MTN").toUpperCase();

      if (!phone || phone.length < 9) {
        return jsonResponse({ success: false, error: "Please enter a valid 10-digit Ghana phone number (e.g. 0241234567)" }, 400);
      }

      const { data: challenge } = await supabaseAdmin
        .from("game_challenges")
        .select("*")
        .eq("id", challengeId)
        .maybeSingle();

      if (!challenge || challenge.status !== "completed") {
        return jsonResponse({ success: false, error: "Completed challenge not found" }, 404);
      }
      if (challenge.reward_claimed) {
        return jsonResponse({ success: false, error: "Reward for this challenge has already been claimed!" }, 400);
      }

      const isHumanVictory =
        challenge.winner_side === "creator" ||
        (challenge.winner_side === "opponent" && challenge.mode === "p2p");
      if (!isHumanVictory) {
        return jsonResponse({ success: false, error: "Only winning challenges are eligible for rewards" }, 400);
      }

      // Check daily free data cap & profit guardrails if this was a free_data challenge
      if (challenge.mode === "free_data") {
        return jsonResponse({
          success: false,
          error: "Free Data matches award Arena Points toward the 5,000 Pt (1GB) Data Vault! Keep winning timed matches to unlock your Free Data Bundle.",
        }, 400);
      }

      const dataSize = challenge.reward_data_size || settings.free_data_package_size || "1GB";
      const rewardType = challenge.mode === "free_data" ? "free_data" : "data_bundle";

      const { data: claim, error: claimErr } = await supabaseAdmin
        .from("game_reward_claims")
        .insert({
          challenge_id: challenge.id,
          user_id: authUser?.id || challenge.winner_id || null,
          winner_name: challenge.winner_name || "Champion",
          winner_phone: phone,
          network,
          reward_type: rewardType,
          cash_amount: Number(challenge.prize_pool || 0),
          data_package_size: dataSize,
          status: "pending",
          notes: `Won ${challenge.game_type.toUpperCase()} (${challenge.mode.toUpperCase()}) — Room #${challenge.room_code}`,
        })
        .select("*")
        .single();

      if (claimErr) {
        return jsonResponse({ success: false, error: claimErr.message }, 500);
      }

      await supabaseAdmin
        .from("game_challenges")
        .update({
          reward_claimed: true,
          winner_phone: phone,
          reward_network: network,
          updated_at: new Date().toISOString(),
        })
        .eq("id", challenge.id);

      return jsonResponse({
        success: true,
        claim,
        message: `🎁 Your ${network} ${dataSize} reward claim for ${phone} has been submitted!`,
      });
    }

    // ── 7B. CLAIM ACCUMULATED LEVEL & TARGET POINTS DATA BUNDLE REWARD ──────────
    if (action === "claim_points_reward" || action === "redeem_points_bundle") {
      if (!authUser?.id) {
        return jsonResponse(
          {
            success: false,
            error: "Please sign in to your verified SwiftData account before redeeming Arena Points for Free Data.",
          },
          401
        );
      }

      const phone = String(body.phone || "").replace(/\D+/g, "");
      const network = String(body.network || "MTN").toUpperCase();
      const targetSize = String(body.target_data_size || body.data_size || "1GB").toUpperCase();
      const pointsSpent = Math.max(0, Number(body.points_spent || 0));
      const playerLevel = Math.max(1, Number(body.player_level || 7));
      const winnerName = String(
        body.winner_name || body.player_name || authUser?.user_metadata?.full_name || "Arena Champion"
      )
        .trim()
        .slice(0, 40);

      if (!phone || phone.length < 9) {
        return jsonResponse(
          {
            success: false,
            error: "Please enter a valid 10-digit Ghana phone number (e.g. 0241234567)",
          },
          400
        );
      }

      const requiredMap: Record<string, number> = {
        "1GB": 5000,
        "2GB": 9500,
        "5GB": 20000,
      };
      const requiredPts = requiredMap[targetSize] || 5000;
      if (pointsSpent < requiredPts) {
        return jsonResponse(
          {
            success: false,
            error: `You need at least ${requiredPts.toLocaleString()} Arena Points to redeem the ${targetSize} Free Data Bundle.`,
          },
          400
        );
      }

      // 1. Verify at least 10 legitimate timed completed wins in database (duration >= 45s)
      const { data: completedWins } = await supabaseAdmin
        .from("game_challenges")
        .select("id, created_at, completed_at, updated_at")
        .eq("status", "completed")
        .or(`winner_id.eq.${authUser.id},creator_id.eq.${authUser.id}`)
        .limit(30);

      const validTimedWins = (completedWins || []).filter((row: any) => {
        const startMs = new Date(row.created_at || 0).getTime();
        const endMs = new Date(row.completed_at || row.updated_at || 0).getTime();
        return endMs - startMs >= 45000;
      });

      if (validTimedWins.length < 10) {
        return jsonResponse(
          {
            success: false,
            error: `Anti-Abuse Verification: You have ${validTimedWins.length}/10 verified timed Arena victories (minimum 45s play time per match). Win ${10 - validTimedWins.length} more full timed matches to unlock Free Data redemption!`,
          },
          400
        );
      }

      // 2. Enforce 7-day per-user / per-phone cooldown
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count: recentUserClaims } = await supabaseAdmin
        .from("game_reward_claims")
        .select("id", { count: "exact", head: true })
        .eq("reward_type", "free_data")
        .or(`user_id.eq.${authUser.id},winner_phone.eq.${phone}`)
        .gte("created_at", sevenDaysAgo);

      if ((recentUserClaims || 0) > 0) {
        return jsonResponse(
          {
            success: false,
            error: "Weekly Limit Reached: Each account/phone can redeem 1 Free Data Bundle every 7 days. Keep stacking points for next week!",
          },
          400
        );
      }

      // 3. Tightened Global Company Daily Cap (max 3 free_data bundles/day unless overridden lower)
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const { count: todayClaims } = await supabaseAdmin
        .from("game_reward_claims")
        .select("id", { count: "exact", head: true })
        .eq("reward_type", "free_data")
        .gte("created_at", todayStart.toISOString());

      const companySafeDailyLimit = Math.min(3, Number(settings.daily_free_data_limit || 3));
      if ((todayClaims || 0) >= companySafeDailyLimit) {
        return jsonResponse(
          {
            success: false,
            error:
              "Today's company Free Data pool (3 bundles/day) has been fully claimed! Your points are safe — redeem tomorrow at midnight or play a P2P cash/data match.",
          },
          400
        );
      }

      const { data: claim, error: claimErr } = await supabaseAdmin
        .from("game_reward_claims")
        .insert({
          challenge_id: null,
          user_id: authUser.id,
          winner_name: winnerName,
          winner_phone: phone,
          network,
          reward_type: "free_data",
          cash_amount: 0,
          data_package_size: targetSize,
          status: "pending",
          notes: `Verified ${validTimedWins.length} timed wins • Redeemed ${requiredPts.toLocaleString()} Arena Points (Level ${playerLevel}) for ${targetSize} Free Data`,
        })
        .select("*")
        .single();

      if (claimErr) {
        return jsonResponse({ success: false, error: claimErr.message }, 500);
      }

      return jsonResponse({
        success: true,
        claim,
        points_deducted: requiredPts,
        message: `🎁 Congratulations! Redeemed ${requiredPts.toLocaleString()} Points for ${network} ${targetSize} Free Data to ${phone}!`,
      });
    }

    // ── 8. ADMIN: UPDATE ARENA SETTINGS & MANAGE CLAIMS ─────────────────────────
    if (action === "admin_update_settings") {
      const updates = {
        arena_enabled: body.arena_enabled ?? settings.arena_enabled,
        free_data_rewards_enabled: body.free_data_rewards_enabled ?? settings.free_data_rewards_enabled,
        daily_free_data_limit: Number(body.daily_free_data_limit ?? settings.daily_free_data_limit),
        free_data_package_size: String(body.free_data_package_size ?? settings.free_data_package_size),
        free_data_win_streak_required: Number(body.free_data_win_streak_required ?? settings.free_data_win_streak_required),
        house_commission_percent: Number(body.house_commission_percent ?? settings.house_commission_percent),
        min_stake_ghs: Number(body.min_stake_ghs ?? settings.min_stake_ghs),
        max_stake_ghs: Number(body.max_stake_ghs ?? settings.max_stake_ghs),
        enabled_games: body.enabled_games ?? settings.enabled_games,
        updated_at: new Date().toISOString(),
      };

      const { data: saved, error: saveErr } = await supabaseAdmin
        .from("game_arena_settings")
        .upsert({ id: 1, ...updates })
        .select("*")
        .single();

      if (saveErr) {
        return jsonResponse({ success: false, error: saveErr.message }, 500);
      }

      return jsonResponse({
        success: true,
        settings: saved,
        message: "Challenge Arena settings updated!",
      });
    }

    if (action === "admin_update_claim") {
      const claimId = String(body.claim_id || "").trim();
      const nextStatus = String(body.status || "fulfilled");
      const { data: updatedClaim, error: updErr } = await supabaseAdmin
        .from("game_reward_claims")
        .update({
          status: nextStatus,
          processed_at: new Date().toISOString(),
        })
        .eq("id", claimId)
        .select("*")
        .single();

      if (updErr) {
        return jsonResponse({ success: false, error: updErr.message }, 500);
      }

      return jsonResponse({
        success: true,
        claim: updatedClaim,
        message: `Reward claim marked as ${nextStatus.toUpperCase()}`,
      });
    }

    // ── 9. GAMER COMMUNITY HUB & LIVE CHAT ROOM + IG DIRECT MESSAGES (DMs) ──────
    if (action === "get_community_hub") {
      const roomCode = String(body.room_code || "").trim().toUpperCase();
      const channels = roomCode ? ["global", `room:${roomCode}`] : ["global"];

      const [
        { data: globalAndRoomMessages },
        { data: dmMessages },
        { data: presenceRows },
        { data: profileRows },
      ] = await Promise.all([
        supabaseAdmin
          .from("game_community_messages")
          .select("*")
          .in("channel", channels)
          .order("created_at", { ascending: false })
          .limit(70),
        supabaseAdmin
          .from("game_community_messages")
          .select("*")
          .like("channel", "dm:%")
          .order("created_at", { ascending: false })
          .limit(100),
        supabaseAdmin
          .from("game_community_presence")
          .select("*")
          .order("last_seen_at", { ascending: false })
          .limit(40),
        supabaseAdmin
          .from("profiles")
          .select("user_id, full_name, phone, is_agent, updated_at")
          .not("full_name", "is", null)
          .order("updated_at", { ascending: false })
          .limit(25),
      ]);

      const combinedMessages = [
        ...(globalAndRoomMessages || []),
        ...(dmMessages || []),
      ].sort(
        (a: any, b: any) =>
          new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
      );

      // Merge live presence with registered profiles so the Meet Gamers & IG DM directory is always rich
      const seenKeys = new Set<string>();
      const gamers: any[] = [];
      const nowMs = Date.now();

      const avatarCatalogIds = [
        "royal_headband",
        "teal_calm",
        "orange_beam",
        "red_wink",
        "purple_joy",
        "emerald_zen",
        "sky_bun",
        "crimson_smile",
        "magenta_cool",
        "cobalt_band",
        "jade_grin",
        "violet_laugh",
        "indigo_bun",
        "ocean_band",
        "amethyst_zen",
        "cerulean_bun",
      ];

      const defaultNotes = [
        "🏎️ Who fits beat my Labadi Buggy time?",
        "🪨 Oware duel ready — text me!",
        "🎱 8-Ball Pool table open 🔥",
        "🍬 Crushing Alewa & Kube combos!",
        "🎲 Ludo 4-player squad — DM me!",
        "♟️ Dame Grandmaster online 🇬🇭",
        "🍉 Slicing Makola fruits fast!",
        "💬 DM me for a friendly 1v1 code!",
      ];

      for (let i = 0; i < (presenceRows || []).length; i++) {
        const p = presenceRows![i];
        const key = String(p.user_id || p.player_key);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const ageMs = nowMs - new Date(p.last_seen_at || 0).getTime();
        const isOnlineNow = ageMs < 15 * 60 * 1000;
        gamers.push({
          player_key: p.player_key,
          user_id: p.user_id || null,
          display_name: p.display_name || "Ghana Gamer",
          masked_phone: p.masked_phone || "Arena Player",
          raw_phone: p.raw_phone || "",
          avatar_id: p.avatar_id || avatarCatalogIds[i % avatarCatalogIds.length],
          player_level: Number(p.player_level || 1),
          player_title: p.player_title || "Arena Challenger",
          favorite_game: p.favorite_game || "oware",
          status: isOnlineNow ? p.status || "online" : "online",
          is_online_now: isOnlineNow,
          active_room_code: p.active_room_code || null,
          ig_note: p.ig_note || null,
          last_seen_at: p.last_seen_at,
        });
      }

      const defaultGames = ["buggy", "oware", "pool", "ludo", "dame", "slash", "candy"];
      let idx = 0;
      for (const prof of profileRows || []) {
        const key = String(prof.user_id);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const rawPhone = String(prof.phone || "").trim();
        const maskedPhone =
          rawPhone.length >= 7
            ? `${rawPhone.slice(0, 4)}***${rawPhone.slice(-3)}`
            : "Verified Member";
        const ageMs = nowMs - new Date(prof.updated_at || 0).getTime();
        const isRecentlyActive = ageMs < 30 * 60 * 1000;
        gamers.push({
          player_key: key,
          user_id: prof.user_id,
          display_name: prof.full_name || "SwiftData User",
          masked_phone: maskedPhone,
          raw_phone: rawPhone,
          avatar_id: avatarCatalogIds[idx % avatarCatalogIds.length],
          player_level: 1,
          player_title: prof.is_agent ? "Verified Agent" : "Registered Member",
          favorite_game: defaultGames[idx % defaultGames.length],
          status: isRecentlyActive ? "online" : "online",
          is_online_now: isRecentlyActive,
          active_room_code: null,
          ig_note: null,
          last_seen_at: prof.updated_at || new Date().toISOString(),
        });
        idx++;
      }

      return jsonResponse({
        success: true,
        messages: combinedMessages,
        gamers: gamers.slice(0, 50),
      });
    }

    if (action === "heartbeat_presence") {
      const rawPhone = String(body.phone || "").trim();
      const displayName = String(
        body.display_name || authUser?.user_metadata?.full_name || "Ghana Gamer"
      )
        .trim()
        .slice(0, 40);
      const playerKey = String(
        authUser?.id || body.player_key || normalizePhone(rawPhone) || displayName
      ).slice(0, 80);
      const maskedPhone =
        rawPhone.length >= 7
          ? `${rawPhone.slice(0, 4)}***${rawPhone.slice(-3)}`
          : "Arena Gamer";
      const status = ["online", "looking_for_match", "in_match"].includes(
        String(body.status || "")
      )
        ? String(body.status)
        : "online";
      const avatarId = String(body.avatar_id || "royal_headband").trim().slice(0, 120);
      const igNote = body.ig_note !== undefined ? String(body.ig_note || "").trim().slice(0, 60) : undefined;

      const upsertPayload: Record<string, any> = {
        player_key: playerKey,
        user_id: authUser?.id || null,
        display_name: displayName,
        masked_phone: maskedPhone,
        raw_phone: rawPhone || null,
        avatar_id: avatarId,
        player_level: Math.max(1, Number(body.player_level || 1)),
        player_title: String(body.player_title || "Arena Challenger").slice(0, 40),
        favorite_game: String(body.favorite_game || "oware").toLowerCase(),
        status,
        active_room_code: body.active_room_code ? String(body.active_room_code) : null,
        last_seen_at: new Date().toISOString(),
      };
      if (igNote !== undefined) {
        upsertPayload.ig_note = igNote || null;
      }

      const { data: upserted } = await supabaseAdmin
        .from("game_community_presence")
        .upsert(upsertPayload)
        .select("*")
        .single();

      return jsonResponse({
        success: true,
        presence: upserted,
      });
    }

    if (action === "send_community_message") {
      const text = String(body.message || "").trim().slice(0, 360);
      if (!text) {
        return jsonResponse({ success: false, error: "Message cannot be empty" }, 400);
      }

      const channel = String(body.channel || "global").trim().slice(0, 120);
      const senderName = String(
        body.sender_name || authUser?.user_metadata?.full_name || "Ghana Gamer"
      )
        .trim()
        .slice(0, 40);
      const rawPhone = String(body.sender_phone || "").trim();
      const maskedPhone =
        rawPhone.length >= 7
          ? `${rawPhone.slice(0, 4)}***${rawPhone.slice(-3)}`
          : null;
      const avatarId = String(body.avatar_id || "royal_headband").trim().slice(0, 120);
      const messageType = [
        "chat",
        "challenge_card",
        "direct_invite",
        "victory_shoutout",
      ].includes(String(body.message_type || ""))
        ? String(body.message_type)
        : "chat";

      const insertPayload = {
        channel,
        sender_id: authUser?.id || null,
        sender_name: senderName,
        sender_phone_masked: maskedPhone,
        avatar_id: avatarId,
        sender_level: Math.max(1, Number(body.sender_level || 1)),
        sender_title: String(body.sender_title || "Arena Challenger").slice(0, 40),
        favorite_game: String(body.favorite_game || "oware").toLowerCase(),
        message_type: messageType,
        message: text,
        challenge_id: body.challenge_id || null,
        room_code: body.room_code ? String(body.room_code).toUpperCase() : null,
        game_type: body.game_type ? String(body.game_type).toLowerCase() : null,
        stake_amount: Math.max(0, Number(body.stake_amount || 0)),
        prize_pool: Math.max(0, Number(body.prize_pool || 0)),
        target_user_id: body.target_user_id || null,
        target_user_name: body.target_user_name ? String(body.target_user_name).slice(0, 40) : null,
      };

      const { data: createdMsg, error: msgErr } = await supabaseAdmin
        .from("game_community_messages")
        .insert(insertPayload)
        .select("*")
        .single();

      if (msgErr) {
        return jsonResponse({ success: false, error: msgErr.message }, 500);
      }

      // Also update sender's presence timestamp
      const playerKey = String(
        authUser?.id || normalizePhone(rawPhone) || senderName
      ).slice(0, 80);
      await supabaseAdmin.from("game_community_presence").upsert({
        player_key: playerKey,
        user_id: authUser?.id || null,
        display_name: senderName,
        masked_phone: maskedPhone || "Arena Gamer",
        raw_phone: rawPhone || null,
        avatar_id: avatarId,
        player_level: insertPayload.sender_level,
        player_title: insertPayload.sender_title,
        favorite_game: insertPayload.favorite_game,
        status: insertPayload.room_code ? "looking_for_match" : "online",
        active_room_code: insertPayload.room_code,
        last_seen_at: new Date().toISOString(),
      });

      // Notify target user when they receive a Direct Message (dm:*) or Direct Challenge Invite!
      if (insertPayload.target_user_id) {
        try {
          const isDirectDm = channel.startsWith("dm:");
          const gameLabel = formatGameLabel(insertPayload.game_type || "oware");
          const notifTitle = insertPayload.room_code
            ? `💬 ${senderName} Challenged You in SwiftGram Chat!`
            : isDirectDm
            ? `✈️ New Message from ${senderName}`
            : `💬 ${senderName} mentioned you in SwiftGram`;
          const notifBody = insertPayload.room_code
            ? `${text} (Room #${insertPayload.room_code} • ${gameLabel})`
            : text;

          await supabaseAdmin.from("notifications").insert({
            title: notifTitle,
            message: notifBody,
            target_type: "specific",
            target_user_id: insertPayload.target_user_id,
            created_by: authUser?.id || null,
          });
          await triggerWebPush(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            user_id: insertPayload.target_user_id,
            title: notifTitle,
            body: notifBody,
            url: insertPayload.room_code
              ? `/challenges?room=${insertPayload.room_code}`
              : `/challenges`,
            tag: `swiftgram-dm-${channel}`,
          });
        } catch (inviteErr) {
          console.warn("[challenge-arena] DM / invite push warning:", inviteErr);
        }
      }

      return jsonResponse({
        success: true,
        message_row: createdMsg,
      });
    }

    if (action === "react_community_message") {
      const messageId = String(body.message_id || "").trim();
      const emoji = String(body.emoji || "❤️").trim().slice(0, 8);
      const likerName = String(
        body.liker_name || authUser?.user_metadata?.full_name || "Ghana Gamer"
      )
        .trim()
        .slice(0, 40);
      const likerAvatar = String(body.liker_avatar || "royal_headband").trim().slice(0, 120);
      const likerKey = String(authUser?.id || body.liker_key || likerName.toLowerCase()).trim();

      if (!messageId) {
        return jsonResponse({ success: false, error: "Missing message_id" }, 400);
      }

      const { data: existing } = await supabaseAdmin
        .from("game_community_messages")
        .select("id, sender_id, sender_name, message, reactions, liked_by")
        .eq("id", messageId)
        .maybeSingle();

      if (!existing) {
        return jsonResponse({ success: false, error: "Message not found" }, 404);
      }

      const prevReactions =
        existing.reactions && typeof existing.reactions === "object"
          ? { ...existing.reactions }
          : {};
      const prevLikedBy: any[] = Array.isArray(existing.liked_by) ? [...existing.liked_by] : [];

      let nextLikedBy = prevLikedBy;
      let likedNow = true;

      if (emoji === "❤️") {
        const alreadyIdx = prevLikedBy.findIndex(
          (u: any) =>
            (authUser?.id && u.user_id === authUser.id) ||
            (u.key && u.key === likerKey) ||
            String(u.name || "").toLowerCase() === likerName.toLowerCase()
        );
        if (alreadyIdx >= 0) {
          // Unlike!
          likedNow = false;
          nextLikedBy = prevLikedBy.filter((_, idx) => idx !== alreadyIdx);
          prevReactions["❤️"] = Math.max(0, Number(prevReactions["❤️"] || 1) - 1);
        } else {
          // Like!
          likedNow = true;
          nextLikedBy = [
            ...prevLikedBy,
            {
              user_id: authUser?.id || null,
              key: likerKey,
              name: likerName,
              avatar_id: likerAvatar,
              liked_at: new Date().toISOString(),
            },
          ];
          prevReactions["❤️"] = Math.max(nextLikedBy.length, Number(prevReactions["❤️"] || 0) + 1);
        }
      } else {
        prevReactions[emoji] = Number(prevReactions[emoji] || 0) + 1;
      }

      const { data: updatedMsg } = await supabaseAdmin
        .from("game_community_messages")
        .update({
          reactions: prevReactions,
          liked_by: nextLikedBy,
        })
        .eq("id", messageId)
        .select("*")
        .single();

      // Notify post author when their post is liked!
      if (
        emoji === "❤️" &&
        likedNow &&
        existing.sender_id &&
        existing.sender_id !== authUser?.id
      ) {
        try {
          const snippet = String(existing.message || "your post").slice(0, 60);
          await supabaseAdmin.from("notifications").insert({
            title: `❤️ ${likerName} liked your post in SwiftGram!`,
            message: `${likerName} liked "${snippet}"`,
            target_type: "specific",
            target_user_id: existing.sender_id,
            created_by: authUser?.id || null,
          });
          await triggerWebPush(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            user_id: existing.sender_id,
            title: `❤️ ${likerName} liked your SwiftGram post!`,
            body: `"${snippet}"`,
            url: `/challenges`,
            tag: `swiftgram-like-${messageId}`,
          });
        } catch {
          // ignore notification error
        }
      }

      return jsonResponse({
        success: true,
        liked: likedNow,
        message_row: updatedMsg,
      });
    }

    if (action === "add_post_comment") {
      const postId = String(body.post_id || "").trim();
      const isStoryPost = Boolean(body.is_story_post);
      const commentText = String(body.comment || "").trim().slice(0, 280);
      const authorName = String(
        body.author_name || authUser?.user_metadata?.full_name || "Ghana Gamer"
      )
        .trim()
        .slice(0, 40);
      const avatarId = String(body.avatar_id || "royal_headband").trim().slice(0, 120);
      const authorLevel = Math.max(1, Number(body.author_level || 1));

      if (!postId || !commentText) {
        return jsonResponse({ success: false, error: "Post ID and comment text required" }, 400);
      }

      const newComment = {
        id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        user_id: authUser?.id || null,
        author_name: authorName,
        avatar_id: avatarId,
        author_level: authorLevel,
        text: commentText,
        created_at: new Date().toISOString(),
      };

      if (isStoryPost) {
        const rawStoryId = postId.replace(/^story-feed-/, "");
        const { data: existingStory } = await supabaseAdmin
          .from("game_user_stories")
          .select("id, user_id, author_name, caption, comments")
          .eq("id", rawStoryId)
          .maybeSingle();

        if (!existingStory) {
          return jsonResponse({ success: false, error: "Story post not found" }, 404);
        }

        const nextComments = [
          ...(Array.isArray(existingStory.comments) ? existingStory.comments : []),
          newComment,
        ];

        const { data: updatedStory } = await supabaseAdmin
          .from("game_user_stories")
          .update({ comments: nextComments })
          .eq("id", rawStoryId)
          .select("*")
          .single();

        if (existingStory.user_id && existingStory.user_id !== authUser?.id) {
          try {
            await supabaseAdmin.from("notifications").insert({
              title: `💬 ${authorName} commented on your SwiftGram post!`,
              message: `${authorName}: "${commentText}"`,
              target_type: "specific",
              target_user_id: existingStory.user_id,
              created_by: authUser?.id || null,
            });
            await triggerWebPush(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
              user_id: existingStory.user_id,
              title: `💬 ${authorName} commented on your post!`,
              body: commentText,
              url: `/challenges`,
              tag: `swiftgram-cmt-${rawStoryId}`,
            });
          } catch {
            // ignore
          }
        }

        return jsonResponse({
          success: true,
          comment: newComment,
          comments: nextComments,
          story: updatedStory,
        });
      }

      const { data: existingMsg } = await supabaseAdmin
        .from("game_community_messages")
        .select("id, sender_id, sender_name, message, comments")
        .eq("id", postId)
        .maybeSingle();

      if (!existingMsg) {
        return jsonResponse({ success: false, error: "Post not found" }, 404);
      }

      const nextComments = [
        ...(Array.isArray(existingMsg.comments) ? existingMsg.comments : []),
        newComment,
      ];

      const { data: updatedMsg } = await supabaseAdmin
        .from("game_community_messages")
        .update({ comments: nextComments })
        .eq("id", postId)
        .select("*")
        .single();

      if (existingMsg.sender_id && existingMsg.sender_id !== authUser?.id) {
        try {
          await supabaseAdmin.from("notifications").insert({
            title: `💬 ${authorName} commented on your SwiftGram post!`,
            message: `${authorName}: "${commentText}"`,
            target_type: "specific",
            target_user_id: existingMsg.sender_id,
            created_by: authUser?.id || null,
          });
          await triggerWebPush(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            user_id: existingMsg.sender_id,
            title: `💬 ${authorName} commented on your post!`,
            body: commentText,
            url: `/challenges`,
            tag: `swiftgram-cmt-${postId}`,
          });
        } catch {
          // ignore
        }
      }

      return jsonResponse({
        success: true,
        comment: newComment,
        comments: nextComments,
        message_row: updatedMsg,
      });
    }

    // ── 10. DAILY LIFE STORIES (IMAGES, VIDEOS & TEXT) ─────────────────────────
    if (action === "get_stories") {
      const nowIso = new Date().toISOString();
      const { data: stories } = await supabaseAdmin
        .from("game_user_stories")
        .select("*")
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: false })
        .limit(40);

      return jsonResponse({
        success: true,
        stories: stories || [],
      });
    }

    if (action === "create_story" || action === "post_story") {
      const authorName = String(
        body.author_name || authUser?.user_metadata?.full_name || "Ghana Gamer"
      )
        .trim()
        .slice(0, 40);
      const rawPhone = String(body.author_phone || "").trim();
      const playerKey = String(
        authUser?.id || body.player_key || normalizePhone(rawPhone) || authorName
      ).slice(0, 80);
      const maskedPhone =
        rawPhone.length >= 7
          ? `${rawPhone.slice(0, 4)}***${rawPhone.slice(-3)}`
          : "Verified Gamer";
      const avatarId = String(body.avatar_id || "royal_headband").trim().slice(0, 120);
      const mediaType = ["image", "video", "text"].includes(String(body.media_type || ""))
        ? String(body.media_type)
        : "text";
      const mediaUrl = body.media_url ? String(body.media_url).trim() : null;
      const caption = String(body.caption || "").trim().slice(0, 280);
      const bgGradient = String(
        body.bg_gradient || "from-indigo-600 via-purple-600 to-pink-600"
      )
        .trim()
        .slice(0, 100);
      const roomCode = (body.room_code || body.attached_room_code)
        ? String(body.room_code || body.attached_room_code).trim().toUpperCase().slice(0, 12)
        : null;
      const gameType = (body.game_type || body.attached_game_type)
        ? String(body.game_type || body.attached_game_type).trim().toLowerCase().slice(0, 20)
        : null;

      if (mediaType !== "text" && !mediaUrl) {
        return jsonResponse({ success: false, error: "Please attach an image or video for this story." }, 400);
      }
      if (mediaType === "text" && !caption) {
        return jsonResponse({ success: false, error: "Please write a message for your status story." }, 400);
      }

      const { data: createdStory, error: storyErr } = await supabaseAdmin
        .from("game_user_stories")
        .insert({
          user_id: authUser?.id || null,
          player_key: playerKey,
          author_name: authorName,
          author_phone_masked: maskedPhone,
          avatar_id: avatarId,
          author_level: Math.max(1, Number(body.author_level || 1)),
          author_title: String(body.author_title || "Arena Challenger").slice(0, 40),
          favorite_game: String(body.favorite_game || "oware").toLowerCase(),
          media_type: mediaType,
          media_url: mediaUrl,
          caption: caption || null,
          bg_gradient: bgGradient,
          attached_room_code: roomCode,
          attached_game_type: gameType,
          room_code: roomCode,
          game_type: gameType,
        })
        .select("*")
        .single();

      if (storyErr) {
        return jsonResponse({ success: false, error: storyErr.message }, 500);
      }

      return jsonResponse({
        success: true,
        story: createdStory,
      });
    }

    if (action === "react_story") {
      const storyId = String(body.story_id || "").trim();
      const emoji = body.emoji ? String(body.emoji).trim().slice(0, 8) : null;
      const incrementView = Boolean(body.increment_view);
      const likerName = String(
        body.liker_name || authUser?.user_metadata?.full_name || "Ghana Gamer"
      )
        .trim()
        .slice(0, 40);
      const likerAvatar = String(body.liker_avatar || "royal_headband").trim().slice(0, 120);
      const likerKey = String(authUser?.id || body.liker_key || likerName.toLowerCase()).trim();

      if (!storyId) {
        return jsonResponse({ success: false, error: "Missing story_id" }, 400);
      }

      const { data: existing } = await supabaseAdmin
        .from("game_user_stories")
        .select("id, user_id, author_name, caption, views_count, reactions, liked_by")
        .eq("id", storyId)
        .maybeSingle();

      if (!existing) {
        return jsonResponse({ success: false, error: "Story not found" }, 404);
      }

      const nextViews = incrementView
        ? Number(existing.views_count || 0) + 1
        : Number(existing.views_count || 0);
      const prevReactions =
        existing.reactions && typeof existing.reactions === "object"
          ? { ...existing.reactions }
          : {};
      const prevLikedBy: any[] = Array.isArray(existing.liked_by) ? [...existing.liked_by] : [];
      let nextLikedBy = prevLikedBy;
      let likedNow = true;

      if (emoji === "❤️") {
        const alreadyIdx = prevLikedBy.findIndex(
          (u: any) =>
            (authUser?.id && u.user_id === authUser.id) ||
            (u.key && u.key === likerKey) ||
            String(u.name || "").toLowerCase() === likerName.toLowerCase()
        );
        if (alreadyIdx >= 0) {
          likedNow = false;
          nextLikedBy = prevLikedBy.filter((_, idx) => idx !== alreadyIdx);
          prevReactions["❤️"] = Math.max(0, Number(prevReactions["❤️"] || 1) - 1);
        } else {
          likedNow = true;
          nextLikedBy = [
            ...prevLikedBy,
            {
              user_id: authUser?.id || null,
              key: likerKey,
              name: likerName,
              avatar_id: likerAvatar,
              liked_at: new Date().toISOString(),
            },
          ];
          prevReactions["❤️"] = Math.max(nextLikedBy.length, Number(prevReactions["❤️"] || 0) + 1);
        }
      } else if (emoji) {
        prevReactions[emoji] = Number(prevReactions[emoji] || 0) + 1;
      }

      const { data: updatedStory } = await supabaseAdmin
        .from("game_user_stories")
        .update({
          views_count: nextViews,
          reactions: prevReactions,
          liked_by: nextLikedBy,
        })
        .eq("id", storyId)
        .select("*")
        .single();

      if (
        emoji === "❤️" &&
        likedNow &&
        existing.user_id &&
        existing.user_id !== authUser?.id
      ) {
        try {
          const snippet = String(existing.caption || "your story post").slice(0, 60);
          await supabaseAdmin.from("notifications").insert({
            title: `❤️ ${likerName} liked your SwiftGram story!`,
            message: `${likerName} liked "${snippet}"`,
            target_type: "specific",
            target_user_id: existing.user_id,
            created_by: authUser?.id || null,
          });
          await triggerWebPush(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            user_id: existing.user_id,
            title: `❤️ ${likerName} liked your SwiftGram story!`,
            body: `"${snippet}"`,
            url: `/challenges`,
            tag: `swiftgram-story-like-${storyId}`,
          });
        } catch {
          // ignore
        }
      }

      return jsonResponse({
        success: true,
        liked: likedNow,
        story: updatedStory,
      });
    }

    if (action === "delete_story") {
      const storyId = String(body.story_id || "").trim();
      if (!storyId) {
        return jsonResponse({ success: false, error: "Missing story_id" }, 400);
      }

      await supabaseAdmin.from("game_user_stories").delete().eq("id", storyId);
      return jsonResponse({ success: true });
    }

    return jsonResponse({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error("[challenge-arena] Error:", err);
    return jsonResponse({ success: false, error: err?.message || "Internal server error" }, 500);
  }
});
