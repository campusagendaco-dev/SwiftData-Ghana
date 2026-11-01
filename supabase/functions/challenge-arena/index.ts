declare const Deno: any;

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { corsHeaders } from "../_shared/cors.ts";

let schemaVerified = false;

async function ensureChallengeSchema(supabaseAdmin: any) {
  if (schemaVerified) return;
  const { error } = await supabaseAdmin.from("game_arena_settings").select("arena_enabled").limit(1);
  if (!error) {
    schemaVerified = true;
    return;
  }

  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return;

  const sql = postgres(dbUrl, { max: 1 });
  try {
    await sql.unsafe(`
      DROP TABLE IF EXISTS public.game_reward_claims CASCADE;
      DROP TABLE IF EXISTS public.game_challenges CASCADE;
      DROP TABLE IF EXISTS public.game_arena_settings CASCADE;

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
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND tablename = 'game_challenges'
        ) THEN
          ALTER PUBLICATION supabase_realtime ADD TABLE public.game_challenges;
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

  if (!secretKey) {
    return { ok: false, amountGhs: 0, reason: "Payment gateway secret key is not configured" };
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
      enabled_games: { oware: true, ludo: true, dame: true, ampe: true },
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

      return jsonResponse({
        success: true,
        settings,
        challenges: challenges || [],
        recent_claims: recentClaims || [],
        today_free_data_claimed: todayFreeDataCount || 0,
      });
    }

    // ── 2. CREATE CHALLENGE ─────────────────────────────────────────────────────
    if (action === "create_challenge") {
      if (!settings.arena_enabled) {
        return jsonResponse({ success: false, error: "The Challenge Arena is temporarily paused by Admin." }, 400);
      }

      const gameType = String(body.game_type || "oware").toLowerCase();
      if (!["oware", "ludo", "dame", "ampe"].includes(gameType)) {
        return jsonResponse({ success: false, error: "Unsupported game type" }, 400);
      }
      if (settings.enabled_games && settings.enabled_games[gameType] === false) {
        return jsonResponse({ success: false, error: `${gameType.toUpperCase()} is currently disabled by Admin.` }, 400);
      }

      const mode = String(body.mode || "p2p").toLowerCase(); // 'p2p' | 'ai' | 'free_data'
      const paymentSource = mode === "free_data" ? "free" : String(body.payment_source || "wallet").toLowerCase();
      const rawStake = mode === "free_data" ? 0 : Math.max(0, Number(body.stake_amount || 0));
      const creatorName = String(body.creator_name || authUser?.user_metadata?.full_name || "Ghana Champion").trim().slice(0, 40);
      const creatorPhone = String(body.creator_phone || "").trim().slice(0, 15);
      const rewardType = mode === "free_data"
        ? "free_data"
        : String(body.reward_type || "wallet_cash");
      const rewardNetwork = String(body.reward_network || "MTN").toUpperCase();
      const rewardDataSize = mode === "free_data"
        ? String(settings.free_data_package_size || "1GB")
        : String(body.reward_data_size || "1GB");

      if (mode !== "free_data") {
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

      const { data: created, error: insertErr } = await supabaseAdmin
        .from("game_challenges")
        .insert({
          room_code: roomCode,
          game_type: gameType,
          mode,
          title: body.title || `${creatorName}'s ${gameType.toUpperCase()} Challenge`,
          creator_id: authUser?.id || null,
          creator_name: creatorName,
          creator_phone: creatorPhone || null,
          creator_payment_source: paymentSource,
          creator_paystack_ref: verifiedPaystackRef,
          opponent_id: null,
          opponent_name: isImmediateStart ? "Nana Oware AI (Grandmaster)" : null,
          opponent_payment_source: isImmediateStart ? "ai" : null,
          stake_amount: rawStake,
          prize_pool: netPrizePool,
          house_fee: houseFee,
          reward_type: rewardType,
          reward_network: rewardNetwork,
          reward_data_size: rewardDataSize,
          board_state: body.initial_board_state || {},
          current_turn: "creator",
          status: isImmediateStart ? "in_progress" : "open",
        })
        .select("*")
        .single();

      if (insertErr) {
        return jsonResponse({ success: false, error: insertErr.message }, 500);
      }

      return jsonResponse({
        success: true,
        challenge: created,
        message: isImmediateStart
          ? "Match started against Grandmaster AI! Good luck!"
          : `Open Challenge #${roomCode} posted to the live arena!`,
      });
    }

    // ── 3. JOIN OPEN P2P CHALLENGE ──────────────────────────────────────────────
    if (action === "join_challenge") {
      const challengeId = String(body.challenge_id || "").trim();
      const paymentSource = String(body.payment_source || "wallet").toLowerCase();
      const opponentName = String(body.opponent_name || authUser?.user_metadata?.full_name || "Challenger 2").trim().slice(0, 40);
      const opponentPhone = String(body.opponent_phone || "").trim().slice(0, 15);

      const { data: challenge } = await supabaseAdmin
        .from("game_challenges")
        .select("*")
        .eq("id", challengeId)
        .maybeSingle();

      if (!challenge) {
        return jsonResponse({ success: false, error: "Challenge not found" }, 404);
      }
      if (challenge.status !== "open") {
        return jsonResponse({ success: false, error: "This challenge is no longer open" }, 400);
      }
      if (authUser && challenge.creator_id && challenge.creator_id === authUser.id) {
        return jsonResponse({
          success: false,
          error: "You created this challenge! Share the room code with a friend or wait for another player to join.",
        }, 400);
      }

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

      const { data: updated, error: joinErr } = await supabaseAdmin
        .from("game_challenges")
        .update({
          opponent_id: authUser?.id || null,
          opponent_name: opponentName,
          opponent_phone: opponentPhone || null,
          opponent_payment_source: stake > 0 ? paymentSource : "free",
          opponent_paystack_ref: verifiedPaystackRef,
          status: "in_progress",
          updated_at: new Date().toISOString(),
        })
        .eq("id", challengeId)
        .eq("status", "open")
        .select("*")
        .single();

      if (joinErr || !updated) {
        return jsonResponse({ success: false, error: "Could not join challenge (it may have just been taken)" }, 400);
      }

      return jsonResponse({
        success: true,
        challenge: updated,
        message: `Joined ${challenge.creator_name}'s ${challenge.game_type.toUpperCase()} challenge! Match is LIVE!`,
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

    // ── 5. SYNC BOARD STATE (LIVE 1V1 REALTIME MOVES) ───────────────────────────
    if (action === "sync_board") {
      const challengeId = String(body.challenge_id || "").trim();
      const boardState = body.board_state || {};
      const currentTurn = String(body.current_turn || "creator");

      const { data: updated, error: syncErr } = await supabaseAdmin
        .from("game_challenges")
        .update({
          board_state: boardState,
          current_turn: currentTurn,
          updated_at: new Date().toISOString(),
        })
        .eq("id", challengeId)
        .select("*")
        .single();

      if (syncErr) {
        return jsonResponse({ success: false, error: syncErr.message }, 500);
      }

      return jsonResponse({ success: true, challenge: updated });
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
          await supabaseAdmin.from("wallets").update({ balance: Number((Number(w1?.balance || 0) + stake).toFixed(2)) }).eq("agent_id", challenge.creator_id);
        }
        if (challenge.opponent_payment_source === "wallet" && challenge.opponent_id) {
          const { data: w2 } = await supabaseAdmin.from("wallets").select("balance").eq("agent_id", challenge.opponent_id).maybeSingle();
          await supabaseAdmin.from("wallets").update({ balance: Number((Number(w2?.balance || 0) + stake).toFixed(2)) }).eq("agent_id", challenge.opponent_id);
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
          await supabaseAdmin
            .from("wallets")
            .update({ balance: nextBal, updated_at: new Date().toISOString() })
            .eq("agent_id", winnerId);

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
        } else {
          // Winner either played via MoMo as guest or selected Data Bundle prize -> allow claiming phone/network
          settlementMessage = `🎉 ${winnerName} won GH₵ ${prizePool.toFixed(2)}! Enter your phone number below to claim your Data Bundle or MoMo/Wallet prize.`;
        }
      } else if (humanWon && challenge.mode === "free_data") {
        settlementMessage = `🎉 You defeated the Grandmaster AI in ${challenge.game_type.toUpperCase()}! Claim your Free ${challenge.reward_data_size || "1GB"} Data Reward below!`;
      } else if (!humanWon && winnerSide !== "draw") {
        settlementMessage = "Nana Grandmaster AI won this round! Challenge again to claim victory!";
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

      // Check daily free data cap if this was a free_data challenge
      if (challenge.mode === "free_data") {
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const { count: todayClaims } = await supabaseAdmin
          .from("game_reward_claims")
          .select("id", { count: "exact", head: true })
          .eq("reward_type", "free_data")
          .gte("created_at", todayStart.toISOString());

        if ((todayClaims || 0) >= Number(settings.daily_free_data_limit || 15)) {
          return jsonResponse({
            success: false,
            error: "Today's Free Data pool has been fully claimed! Join a Wallet or MoMo challenge, or return tomorrow at midnight.",
          }, 400);
        }
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

    return jsonResponse({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error("[challenge-arena] Error:", err);
    return jsonResponse({ success: false, error: err?.message || "Internal server error" }, 500);
  }
});
