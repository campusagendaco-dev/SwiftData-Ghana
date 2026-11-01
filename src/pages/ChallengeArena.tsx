import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Trophy,
  Gamepad2,
  Wallet,
  Smartphone,
  Gift,
  Sparkles,
  Users,
  Bot,
  PlusCircle,
  RefreshCw,
  Copy,
  Check,
  XCircle,
  Share2,
  Loader2,
  Crown,
  ArrowLeft,
} from "lucide-react";
import { OwareGameBoard, INITIAL_OWARE_STATE } from "@/components/games/OwareGameBoard";
import { GhanaLudoBoard, INITIAL_LUDO_STATE } from "@/components/games/GhanaLudoBoard";
import { DameCheckersBoard, INITIAL_DAME_STATE } from "@/components/games/DameCheckersBoard";
import { playSuccessSound } from "@/lib/sound";

declare global {
  interface Window {
    PaystackPop?: any;
  }
}

type GameType = "oware" | "ludo" | "dame";
type ChallengeMode = "p2p" | "ai" | "free_data";
type PaymentSource = "wallet" | "momo" | "free";

const GAME_CATALOG: {
  id: GameType;
  name: string;
  subtitle: string;
  badge: string;
  emoji: string;
  gradient: string;
}[] = [
  {
    id: "oware",
    name: "Oware (Abapa)",
    subtitle: "Traditional Akan 12-pit Mancala strategy game. First to capture 25 seeds wins!",
    badge: "Most Popular",
    emoji: "🪨",
    gradient: "from-amber-600/30 via-amber-900/20 to-slate-950 border-amber-500/40",
  },
  {
    id: "ludo",
    name: "Ghana Ludo (Kick)",
    subtitle: "Roll 6 to deploy, kick opponent tokens back to yard & race 2 tokens home!",
    badge: "Fast Action",
    emoji: "🎲",
    gradient: "from-rose-600/30 via-amber-900/20 to-slate-950 border-rose-500/40",
  },
  {
    id: "dame",
    name: "Ghanaian Dame",
    subtitle: "8×8 Ghanaian Draughts with mandatory jump combos and Crowned Kings.",
    badge: "Pure Skill",
    emoji: "♟️",
    gradient: "from-emerald-600/30 via-teal-900/20 to-slate-950 border-emerald-500/40",
  },
];

const QUICK_STAKES = [2, 5, 10, 20, 50];

function getInitialBoardForGame(gameType: GameType) {
  if (gameType === "oware") return INITIAL_OWARE_STATE;
  if (gameType === "ludo") return INITIAL_LUDO_STATE;
  if (gameType === "dame") return INITIAL_DAME_STATE;
  return INITIAL_DAME_STATE;
}

export default function ChallengeArena() {
  const { user, profile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [paystackPublicKey, setPaystackPublicKey] = useState<string>("");

  // Arena lobby state
  const [settings, setSettings] = useState<any>({
    arena_enabled: true,
    free_data_rewards_enabled: true,
    daily_free_data_limit: 15,
    free_data_package_size: "1GB",
    house_commission_percent: 10,
    min_stake_ghs: 2,
    max_stake_ghs: 200,
    enabled_games: { oware: true, ludo: true, dame: true },
  });
  const [challenges, setChallenges] = useState<any[]>([]);
  const [recentClaims, setRecentClaims] = useState<any[]>([]);
  const [todayFreeDataCount, setTodayFreeDataCount] = useState<number>(0);

  // Create challenge form state
  const [selectedGame, setSelectedGame] = useState<GameType>("oware");
  const [selectedMode, setSelectedMode] = useState<ChallengeMode>("p2p");
  const [paymentSource, setPaymentSource] = useState<PaymentSource>("wallet");
  const [stakeAmount, setStakeAmount] = useState<string>("5");
  const [playerName, setPlayerName] = useState<string>("");
  const [playerPhone, setPlayerPhone] = useState<string>("");
  const [rewardType, setRewardType] = useState<"wallet_cash" | "data_bundle">("wallet_cash");
  const [rewardNetwork, setRewardNetwork] = useState<string>("MTN");

  // Active match state
  const [activeChallenge, setActiveChallenge] = useState<any | null>(null);
  const [mySide, setMySide] = useState<"creator" | "opponent">("creator");
  const [copiedCode, setCopiedCode] = useState(false);

  // Claim Free Data / Bundle Modal state
  const [claimPhone, setClaimPhone] = useState("");
  const [claimNetwork, setClaimNetwork] = useState("MTN");
  const [claimingReward, setClaimingReward] = useState(false);

  // Join challenge modal state for MoMo / Guest
  const [joiningChallengeId, setJoiningChallengeId] = useState<string | null>(null);
  const [filterGame, setFilterGame] = useState<string>("all");

  useEffect(() => {
    if (profile?.full_name && !playerName) {
      setPlayerName(profile.full_name);
    }
    if (profile?.phone && !playerPhone) {
      setPlayerPhone(profile.phone);
      setClaimPhone(profile.phone);
    }
  }, [profile, playerName, playerPhone]);

  useEffect(() => {
    if (!user) {
      setPaymentSource("momo");
    } else {
      setPaymentSource("wallet");
    }
  }, [user]);

  const fetchWalletAndPaystackKey = useCallback(async () => {
    if (user) {
      const { data: w } = await supabase
        .from("wallets")
        .select("balance")
        .eq("agent_id", user.id)
        .maybeSingle();
      if (w) setWalletBalance(Number((w as any).balance || 0));
    }
    const { data: sys } = await supabase
      .from("system_settings")
      .select("paystack_public_key")
      .eq("id", 1)
      .maybeSingle();
    if ((sys as any)?.paystack_public_key) {
      setPaystackPublicKey((sys as any).paystack_public_key);
    }
  }, [user]);

  const fetchLobby = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("challenge-arena", {
        body: { action: "get_lobby" },
      });
      if (!error && data?.success) {
        if (data.settings) setSettings(data.settings);
        if (Array.isArray(data.challenges)) setChallenges(data.challenges);
        if (Array.isArray(data.recent_claims)) setRecentClaims(data.recent_claims);
        if (typeof data.today_free_data_claimed === "number") {
          setTodayFreeDataCount(data.today_free_data_claimed);
        }
      }
    } catch (err) {
      console.warn("[ChallengeArena] Lobby fetch warning:", err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWalletAndPaystackKey();
    fetchLobby();
  }, [fetchWalletAndPaystackKey, fetchLobby]);

  // Realtime subscription to game_challenges for live 1v1 moves & open challenge board
  useEffect(() => {
    const channel = supabase
      .channel("challenge_arena_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_challenges" },
        (payload: any) => {
          const updated = payload.new;
          if (!updated) return;

          setChallenges((prev) => {
            const exists = prev.some((c) => c.id === updated.id);
            if (!exists) return [updated, ...prev];
            return prev.map((c) => (c.id === updated.id ? updated : c));
          });

          setActiveChallenge((curr: any) => {
            if (curr && curr.id === updated.id) {
              return updated;
            }
            return curr;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Load Paystack inline script if not already loaded
  const ensurePaystackLoaded = (): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (window.PaystackPop) return resolve(window.PaystackPop);
      const script = document.createElement("script");
      script.src = "https://js.paystack.co/v1/inline.js";
      script.async = true;
      script.onload = () => resolve(window.PaystackPop);
      script.onerror = () => reject(new Error("Could not load Paystack Mobile Money checkout"));
      document.body.appendChild(script);
    });
  };

  const triggerMoMoStakeCheckout = async (amountGhs: number): Promise<string> => {
    const PaystackPop = await ensurePaystackLoaded();
    const pubKey =
      paystackPublicKey ||
      import.meta.env.VITE_PAYSTACK_PUBLIC_KEY ||
      "pk_live_7ab0f41f5fb9bb80aa1fd90a17fa1be99b2a10bf";

    return new Promise((resolve, reject) => {
      const ref = `CHAL_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      const handler = PaystackPop.setup({
        key: pubKey,
        email: user?.email || `${(playerPhone || "guest").replace(/\D/g, "") || "player"}@swiftdatagh.com`,
        amount: Math.round(amountGhs * 100),
        currency: "GHS",
        ref,
        channels: ["mobile_money", "card"],
        metadata: {
          custom_fields: [
            { display_name: "Challenge Game", variable_name: "game_type", value: selectedGame },
            { display_name: "Player Phone", variable_name: "player_phone", value: playerPhone },
          ],
        },
        callback: (response: any) => {
          resolve(response.reference || ref);
        },
        onClose: () => {
          reject(new Error("Mobile Money payment window was closed before completion."));
        },
      });
      handler.openIframe();
    });
  };

  const handleCreateChallenge = async () => {
    const cleanName = (playerName || profile?.full_name || "Ghana Champion").trim();
    const numStake = selectedMode === "free_data" ? 0 : Number(stakeAmount || 0);

    if (selectedMode !== "free_data" && (!numStake || numStake < Number(settings.min_stake_ghs || 2))) {
      toast({
        title: "Invalid Stake Amount",
        description: `Minimum stake is GH₵ ${Number(settings.min_stake_ghs || 2).toFixed(2)}.`,
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      let paystackRef: string | undefined;
      const effectivePaySource: PaymentSource =
        selectedMode === "free_data" ? "free" : paymentSource;

      if (effectivePaySource === "momo" && numStake > 0) {
        if (!playerPhone || playerPhone.replace(/\D/g, "").length < 9) {
          toast({
            title: "Phone Number Required",
            description: "Enter your Ghana phone number so we can send your MoMo / Data prize when you win!",
            variant: "destructive",
          });
          setSubmitting(false);
          return;
        }
        paystackRef = await triggerMoMoStakeCheckout(numStake);
      }

      const initialBoard = getInitialBoardForGame(selectedGame);
      const { data, error } = await supabase.functions.invoke("challenge-arena", {
        body: {
          action: "create_challenge",
          game_type: selectedGame,
          mode: selectedMode,
          payment_source: effectivePaySource,
          paystack_reference: paystackRef,
          stake_amount: numStake,
          creator_name: cleanName,
          creator_phone: playerPhone,
          reward_type: selectedMode === "free_data" ? "free_data" : rewardType,
          reward_network: rewardNetwork,
          reward_data_size:
            selectedMode === "free_data"
              ? settings.free_data_package_size || "1GB"
              : numStake >= 15
              ? "5GB"
              : numStake >= 8
              ? "2GB"
              : "1GB",
          initial_board_state: initialBoard,
        },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Could not create challenge");
      }

      toast({
        title: "🎮 Challenge Created!",
        description: data.message,
      });

      setMySide("creator");
      setActiveChallenge(data.challenge);
      fetchWalletAndPaystackKey();
      fetchLobby(true);
    } catch (err: any) {
      toast({
        title: "Challenge Creation Failed",
        description: err.message || "Could not start challenge",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoinChallenge = async (challenge: any, source: "wallet" | "momo") => {
    setJoiningChallengeId(challenge.id);
    try {
      const stake = Number(challenge.stake_amount || 0);
      let paystackRef: string | undefined;

      if (source === "momo" && stake > 0) {
        paystackRef = await triggerMoMoStakeCheckout(stake);
      }

      const { data, error } = await supabase.functions.invoke("challenge-arena", {
        body: {
          action: "join_challenge",
          challenge_id: challenge.id,
          payment_source: stake === 0 ? "free" : source,
          paystack_reference: paystackRef,
          opponent_name: (playerName || profile?.full_name || "Challenger 2").trim(),
          opponent_phone: playerPhone || profile?.phone || "",
        },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Failed to join challenge");
      }

      playSuccessSound();
      toast({
        title: "🔥 Match Started!",
        description: data.message,
      });

      setMySide("opponent");
      setActiveChallenge(data.challenge);
      fetchWalletAndPaystackKey();
      fetchLobby(true);
    } catch (err: any) {
      toast({
        title: "Could Not Join Challenge",
        description: err.message || "Error joining challenge",
        variant: "destructive",
      });
    } finally {
      setJoiningChallengeId(null);
    }
  };

  const handleCancelOpenChallenge = async (challengeId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("challenge-arena", {
        body: { action: "cancel_challenge", challenge_id: challengeId },
      });
      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Could not cancel challenge");
      }
      toast({ title: "Challenge Cancelled", description: data.message });
      if (activeChallenge?.id === challengeId) {
        setActiveChallenge(null);
      }
      fetchWalletAndPaystackKey();
      fetchLobby(true);
    } catch (err: any) {
      toast({ title: "Cancel Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleBoardStateChange = useCallback(
    async (nextState: any) => {
      if (!activeChallenge) return;
      // Optimistically update local activeChallenge
      setActiveChallenge((prev: any) =>
        prev ? { ...prev, board_state: nextState, current_turn: nextState.turn || "creator" } : prev
      );
      if (activeChallenge.mode === "p2p") {
        await supabase.functions.invoke("challenge-arena", {
          body: {
            action: "sync_board",
            challenge_id: activeChallenge.id,
            board_state: nextState,
            current_turn: nextState.turn || "creator",
          },
        });
      }
    },
    [activeChallenge]
  );

  const handleMatchComplete = useCallback(
    async (winnerSide: "creator" | "opponent" | "draw", finalState: any) => {
      if (!activeChallenge) return;
      try {
        const { data, error } = await supabase.functions.invoke("challenge-arena", {
          body: {
            action: "complete_match",
            challenge_id: activeChallenge.id,
            winner_side: winnerSide,
            board_state: finalState,
            winner_phone: playerPhone || profile?.phone || "",
          },
        });

        if (!error && data?.challenge) {
          setActiveChallenge(data.challenge);
          if (winnerSide === mySide) {
            playSuccessSound();
          }
          toast({
            title: winnerSide === mySide ? "🏆 VICTORY!" : "Match Finished",
            description: data.message,
          });
          fetchWalletAndPaystackKey();
          fetchLobby(true);
        }
      } catch (err) {
        console.error("Failed to settle match:", err);
      }
    },
    [activeChallenge, mySide, playerPhone, profile, toast, fetchWalletAndPaystackKey, fetchLobby]
  );

  const handleClaimDataReward = async () => {
    if (!activeChallenge) return;
    if (!claimPhone || claimPhone.replace(/\D/g, "").length < 9) {
      toast({
        title: "Valid Phone Number Required",
        description: "Enter a 10-digit Ghana number (e.g. 0241234567) to receive your Data Bundle.",
        variant: "destructive",
      });
      return;
    }

    setClaimingReward(true);
    try {
      const { data, error } = await supabase.functions.invoke("challenge-arena", {
        body: {
          action: "claim_reward",
          challenge_id: activeChallenge.id,
          phone: claimPhone,
          network: claimNetwork,
        },
      });
      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Could not claim reward");
      }

      playSuccessSound();
      toast({
        title: "🎁 Data Bundle Claimed!",
        description: data.message,
      });
      setActiveChallenge((prev: any) => (prev ? { ...prev, reward_claimed: true } : prev));
      fetchLobby(true);
    } catch (err: any) {
      toast({
        title: "Claim Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setClaimingReward(false);
    }
  };

  const openChallenges = challenges.filter(
    (c) => c.status === "open" && (filterGame === "all" || c.game_type === filterGame)
  );
  const liveMatches = challenges.filter((c) => c.status === "in_progress");
  const remainingFreeDataToday = Math.max(
    0,
    Number(settings.daily_free_data_limit || 15) - todayFreeDataCount
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6 pb-16">
      {/* ── Hero Banner ── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-amber-950/40 to-emerald-950/40 border border-amber-500/30 p-6 sm:p-8 shadow-2xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2.5 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-amber-500 text-slate-950 font-black text-xs px-3 py-1 gap-1">
                <Trophy className="w-3.5 h-3.5" /> GHANA TRADITIONAL GAMES ARENA
              </Badge>
              <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-bold text-xs">
                🎁 {remainingFreeDataToday} Free Data Rewards Available Today
              </Badge>
            </div>
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white">
              Play Oware, Ghana Ludo &amp; Dame — Win Cash or Free Data!
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Create an <strong>Open Challenge</strong> using your <strong>Wallet Balance</strong> or{" "}
              <strong>Mobile Money (MoMo)</strong>, challenge another player live, or defeat the{" "}
              <strong>Grandmaster AI</strong> to win instant Wallet Prizes and <strong>Free Data Bundles</strong>!
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {user && (
              <div className="px-4 py-3 rounded-2xl bg-slate-950/80 border border-emerald-500/30 flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                  <Wallet className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Your Wallet Balance
                  </p>
                  <p className="text-lg font-black text-emerald-400 font-mono">
                    GH₵ {walletBalance.toFixed(2)}
                  </p>
                </div>
              </div>
            )}
            <Button
              variant="outline"
              onClick={() => fetchLobby()}
              className="h-11 rounded-2xl border-white/15 bg-white/5 hover:bg-white/10 text-white font-bold text-xs gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Refresh Arena
            </Button>
          </div>
        </div>
      </div>

      {/* ── Active Game Stage (When Playing or Waiting in Room) ── */}
      {activeChallenge ? (
        <Card className="border-2 border-amber-500/40 bg-slate-950/90 shadow-2xl overflow-hidden">
          <CardHeader className="border-b border-white/10 bg-slate-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActiveChallenge(null)}
                  className="h-8 px-2.5 text-xs text-slate-300 hover:text-white gap-1"
                >
                  <ArrowLeft className="w-4 h-4" /> Back to Lobby
                </Button>
                <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                  Room #{activeChallenge.room_code}
                </Badge>
                <Badge
                  className={
                    activeChallenge.status === "in_progress"
                      ? "bg-emerald-500 text-slate-950 font-black"
                      : activeChallenge.status === "open"
                      ? "bg-amber-500 text-slate-950 font-black animate-pulse"
                      : "bg-purple-500 text-white font-black"
                  }
                >
                  {activeChallenge.status === "open"
                    ? "⏳ WAITING FOR OPPONENT"
                    : activeChallenge.status === "in_progress"
                    ? "🟢 MATCH LIVE"
                    : "🏁 MATCH COMPLETED"}
                </Badge>
              </div>
              <CardTitle className="text-lg sm:text-xl font-black text-white">
                {activeChallenge.creator_name} vs.{" "}
                {activeChallenge.opponent_name || "Waiting for Challenger..."}
              </CardTitle>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="px-3.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-right">
                <p className="text-[10px] uppercase font-bold text-emerald-300">
                  {activeChallenge.mode === "free_data" ? "Free Data Prize" : "Winner Prize Pool"}
                </p>
                <p className="text-sm sm:text-base font-black text-emerald-400 font-mono">
                  {activeChallenge.mode === "free_data"
                    ? `🎁 Free ${activeChallenge.reward_data_size || "1GB"} Data`
                    : `GH₵ ${Number(activeChallenge.prize_pool || 0).toFixed(2)}`}
                </p>
              </div>

              {activeChallenge.status === "open" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const shareUrl = `${window.location.origin}/challenges?room=${activeChallenge.room_code}`;
                      navigator.clipboard.writeText(shareUrl);
                      setCopiedCode(true);
                      toast({
                        title: "Challenge Link Copied! 📋",
                        description: `Room #${activeChallenge.room_code} link copied. Send to a friend on WhatsApp!`,
                      });
                      setTimeout(() => setCopiedCode(false), 2000);
                    }}
                    className="h-9 rounded-xl border-amber-500/40 bg-amber-500/10 text-amber-300 font-bold text-xs gap-1.5"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                    Share Challenge Link
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleCancelOpenChallenge(activeChallenge.id)}
                    className="h-9 rounded-xl text-xs font-bold gap-1"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Cancel &amp; Refund
                  </Button>
                </>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-4 sm:p-6 space-y-6">
            {/* Waiting for Opponent Banner (Open P2P Challenge) */}
            {activeChallenge.status === "open" && (
              <div className="p-6 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-center space-y-3">
                <Loader2 className="w-8 h-8 text-amber-400 animate-spin mx-auto" />
                <h3 className="text-base font-black text-white">
                  Your Open Challenge (#{activeChallenge.room_code}) is Live on the Arena Board!
                </h3>
                <p className="text-xs text-slate-300 max-w-md mx-auto">
                  As soon as another player clicks <strong>Accept Challenge</strong> in the lobby (or opens your shared link), the board will unlock automatically!
                </p>
              </div>
            )}

            {/* Winner Reward Claim Banner (for Free Data or MoMo Data Bundle Winners) */}
            {activeChallenge.status === "completed" &&
              activeChallenge.winner_side === mySide &&
              !activeChallenge.reward_claimed && (
                <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-950/90 via-teal-950/80 to-slate-900 border-2 border-emerald-400/60 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-2xl bg-emerald-500 text-slate-950">
                      <Gift className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-base sm:text-lg font-black text-white">
                        🎉 Congratulations! Claim Your{" "}
                        {activeChallenge.mode === "free_data"
                          ? `Free ${activeChallenge.reward_data_size || "1GB"} Data Bundle`
                          : `GH₵ ${Number(activeChallenge.prize_pool || 0).toFixed(2)} Winner Prize`}
                      </h3>
                      <p className="text-xs text-emerald-200">
                        Enter the Ghana phone number and network where we should send your reward:
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <select
                      value={claimNetwork}
                      onChange={(e) => setClaimNetwork(e.target.value)}
                      className="h-11 rounded-xl bg-slate-950 border border-emerald-500/40 px-3 text-xs font-bold text-white"
                    >
                      <option value="MTN">MTN Data</option>
                      <option value="TELECEL">Telecel Data</option>
                      <option value="AT">AirtelTigo Data</option>
                    </select>
                    <Input
                      placeholder="Recipient Phone (e.g. 0241234567)"
                      value={claimPhone}
                      onChange={(e) => setClaimPhone(e.target.value)}
                      className="h-11 rounded-xl bg-slate-950 border-emerald-500/40 text-white font-mono"
                    />
                    <Button
                      onClick={handleClaimDataReward}
                      disabled={claimingReward}
                      className="h-11 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs gap-2"
                    >
                      {claimingReward ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
                      Claim Data Bundle Now
                    </Button>
                  </div>
                </div>
              )}

            {/* Render the Active Ghanaian Traditional Game Engine */}
            {activeChallenge.status !== "open" && (
              <>
                {activeChallenge.game_type === "oware" && (
                  <OwareGameBoard
                    mode={activeChallenge.mode}
                    mySide={mySide}
                    creatorName={activeChallenge.creator_name}
                    opponentName={activeChallenge.opponent_name || "Nana Oware AI"}
                    initialState={activeChallenge.board_state}
                    onStateChange={handleBoardStateChange}
                    onMatchComplete={handleMatchComplete}
                  />
                )}
                {activeChallenge.game_type === "ludo" && (
                  <GhanaLudoBoard
                    mode={activeChallenge.mode}
                    mySide={mySide}
                    creatorName={activeChallenge.creator_name}
                    opponentName={activeChallenge.opponent_name || "Grandmaster Ludo AI"}
                    initialState={activeChallenge.board_state}
                    onStateChange={handleBoardStateChange}
                    onMatchComplete={handleMatchComplete}
                  />
                )}
                {activeChallenge.game_type === "dame" && (
                  <DameCheckersBoard
                    mode={activeChallenge.mode}
                    mySide={mySide}
                    creatorName={activeChallenge.creator_name}
                    opponentName={activeChallenge.opponent_name || "Grandmaster Dame AI"}
                    initialState={activeChallenge.board_state}
                    onStateChange={handleBoardStateChange}
                    onMatchComplete={handleMatchComplete}
                  />
                )}
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        /* ── Create Challenge & Open Challenge Lobby Grid ── */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Create Challenge Setup (5 cols) */}
          <Card className="lg:col-span-5 border-amber-500/30 bg-slate-900/80 backdrop-blur-xl shadow-xl">
            <CardHeader>
              <CardTitle className="text-lg font-black flex items-center gap-2 text-white">
                <Gamepad2 className="w-5 h-5 text-amber-400" />
                Start a New Game Challenge
              </CardTitle>
              <CardDescription>
                Choose a traditional Ghanaian game, pick your stake mode (Wallet, MoMo, or Free Data), and play!
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 1. Choose Game */}
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  1. Choose Ghanaian Traditional Game
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {GAME_CATALOG.map((g) => {
                    const active = selectedGame === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setSelectedGame(g.id)}
                        className={`p-3 rounded-2xl border text-left transition-all ${
                          active
                            ? `bg-gradient-to-br ${g.gradient} ring-2 ring-amber-400`
                            : "bg-slate-950/60 border-white/10 hover:border-white/25"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          {g.id === "ludo" ? (
                            <img src="/ludo-challenge-icon.png" alt="Ghana Ludo" className="w-8 h-8 rounded-lg object-cover shadow-md border border-white/20" />
                          ) : g.id === "oware" ? (
                            <img src="/oware-challenge-icon.jpg" alt="Oware Abapa" className="w-8 h-8 rounded-lg object-cover shadow-md border border-amber-500/40" />
                          ) : (
                            <span className="text-xl">{g.emoji}</span>
                          )}
                          <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-300">
                            {g.badge}
                          </Badge>
                        </div>
                        <p className="text-xs font-black text-white">{g.name}</p>
                        <p className="text-[10px] text-slate-400 line-clamp-2 mt-0.5">{g.subtitle}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Choose Challenge Mode */}
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  2. Choose Challenge Mode
                </Label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedMode("p2p")}
                    className={`p-2.5 rounded-xl border text-center transition-all ${
                      selectedMode === "p2p"
                        ? "bg-amber-500/20 border-amber-400 text-amber-300 font-black"
                        : "bg-slate-950/60 border-white/10 text-slate-400"
                    }`}
                  >
                    <Users className="w-4 h-4 mx-auto mb-1" />
                    <span className="text-[11px] block">Open 1v1</span>
                    <span className="text-[9px] opacity-75">vs Any Player</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedMode("ai")}
                    className={`p-2.5 rounded-xl border text-center transition-all ${
                      selectedMode === "ai"
                        ? "bg-emerald-500/20 border-emerald-400 text-emerald-300 font-black"
                        : "bg-slate-950/60 border-white/10 text-slate-400"
                    }`}
                  >
                    <Bot className="w-4 h-4 mx-auto mb-1" />
                    <span className="text-[11px] block">Instant AI</span>
                    <span className="text-[9px] opacity-75">1.8× Payout</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedMode("free_data")}
                    className={`p-2.5 rounded-xl border text-center transition-all ${
                      selectedMode === "free_data"
                        ? "bg-purple-500/20 border-purple-400 text-purple-300 font-black"
                        : "bg-slate-950/60 border-white/10 text-slate-400"
                    }`}
                  >
                    <Gift className="w-4 h-4 mx-auto mb-1" />
                    <span className="text-[11px] block">Free Data</span>
                    <span className="text-[9px] opacity-75">Win {settings.free_data_package_size || "1GB"}</span>
                  </button>
                </div>
              </div>

              {/* 3. Payment Source & Stake Amount (When not Free Data mode) */}
              {selectedMode !== "free_data" ? (
                <div className="space-y-3 pt-1">
                  <Label className="text-xs font-bold uppercase tracking-wider text-amber-400">
                    3. Stake Source (Wallet Balance or Mobile Money)
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setPaymentSource("wallet")}
                      className={`p-3 rounded-xl border flex items-center gap-2.5 text-left transition-all ${
                        paymentSource === "wallet"
                          ? "bg-emerald-500/15 border-emerald-400 text-emerald-300"
                          : "bg-slate-950/60 border-white/10 text-slate-400"
                      }`}
                    >
                      <Wallet className="w-4 h-4 shrink-0" />
                      <div>
                        <p className="text-xs font-black">Wallet Balance</p>
                        <p className="text-[10px] opacity-80">GH₵ {walletBalance.toFixed(2)}</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPaymentSource("momo")}
                      className={`p-3 rounded-xl border flex items-center gap-2.5 text-left transition-all ${
                        paymentSource === "momo"
                          ? "bg-amber-500/15 border-amber-400 text-amber-300"
                          : "bg-slate-950/60 border-white/10 text-slate-400"
                      }`}
                    >
                      <Smartphone className="w-4 h-4 shrink-0" />
                      <div>
                        <p className="text-xs font-black">MoMo (Paystack)</p>
                        <p className="text-[10px] opacity-80">MTN / Telecel / AT</p>
                      </div>
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-slate-300">Stake Amount (GH₵)</Label>
                      <span className="text-[11px] font-bold text-emerald-400">
                        Winner Pot: GH₵{" "}
                        {(
                          Number(stakeAmount || 0) *
                          (selectedMode === "p2p"
                            ? 2 * (1 - Number(settings.house_commission_percent || 10) / 100)
                            : 1.8)
                        ).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {QUICK_STAKES.map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setStakeAmount(String(amt))}
                          className={`flex-1 py-1.5 rounded-lg border text-xs font-black transition-all ${
                            Number(stakeAmount) === amt
                              ? "bg-amber-500 text-slate-950 border-amber-400"
                              : "bg-slate-950 border-white/10 text-slate-300 hover:border-amber-500/40"
                          }`}
                        >
                          ₵{amt}
                        </button>
                      ))}
                    </div>
                    <Input
                      type="number"
                      min={settings.min_stake_ghs || 2}
                      max={settings.max_stake_ghs || 200}
                      value={stakeAmount}
                      onChange={(e) => setStakeAmount(e.target.value)}
                      className="h-10 rounded-xl bg-slate-950 border-white/15 font-mono font-bold text-white"
                    />
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/30 text-xs text-purple-200 space-y-1">
                  <p className="font-black text-purple-300 flex items-center gap-1.5">
                    <Gift className="w-4 h-4" /> Free Data Challenge Mode
                  </p>
                  <p>
                    Defeat the Grandmaster AI in <strong>{selectedGame.toUpperCase()}</strong> and claim a{" "}
                    <strong>Free {settings.free_data_package_size || "1GB"} Data Bundle</strong> to any network!
                  </p>
                </div>
              )}

              {/* Player Nickname & Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <div>
                  <Label className="text-[11px] text-slate-400">Your Display Name</Label>
                  <Input
                    placeholder="e.g. Kofi Oware"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    className="h-9 rounded-xl bg-slate-950 border-white/15 text-xs text-white"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-slate-400">Phone (For Prize / Data)</Label>
                  <Input
                    placeholder="0241234567"
                    value={playerPhone}
                    onChange={(e) => setPlayerPhone(e.target.value)}
                    className="h-9 rounded-xl bg-slate-950 border-white/15 text-xs font-mono text-white"
                  />
                </div>
              </div>

              <Button
                onClick={handleCreateChallenge}
                disabled={submitting}
                className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-sm gap-2 shadow-xl"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <PlusCircle className="w-4 h-4" />
                )}
                {selectedMode === "p2p"
                  ? `Post Open ${selectedGame.toUpperCase()} Challenge (GH₵ ${Number(stakeAmount || 0).toFixed(2)})`
                  : selectedMode === "ai"
                  ? `Play vs Grandmaster AI (Stake GH₵ ${Number(stakeAmount || 0).toFixed(2)})`
                  : `Start Free Data ${selectedGame.toUpperCase()} Challenge`}
              </Button>
            </CardContent>
          </Card>

          {/* Right Column: Live Open Challenges Board & Winners Feed (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            <Card className="border-white/10 bg-slate-900/80 backdrop-blur-xl shadow-xl">
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3">
                <div>
                  <CardTitle className="text-lg font-black text-white flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-emerald-400" />
                    Open Challenges Waiting for Opponent ({openChallenges.length})
                  </CardTitle>
                  <CardDescription>
                    Accept any open challenge below using your Wallet Balance or Mobile Money (MoMo).
                  </CardDescription>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {["all", "oware", "ludo", "dame"].map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setFilterGame(g)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase border transition-all ${
                        filterGame === g
                          ? "bg-amber-500/20 border-amber-400 text-amber-300"
                          : "bg-slate-950 border-white/10 text-slate-400"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </CardHeader>

              <CardContent className="space-y-3">
                {openChallenges.length === 0 ? (
                  <div className="p-8 rounded-2xl border-2 border-dashed border-white/10 text-center space-y-2">
                    <p className="text-sm font-bold text-slate-300">
                      No open 1v1 challenges waiting right now.
                    </p>
                    <p className="text-xs text-slate-400">
                      Create an Open Challenge on the left — or play immediately against the Grandmaster AI!
                    </p>
                  </div>
                ) : (
                  openChallenges.map((chal) => {
                    const isMine = user && chal.creator_id === user.id;
                    const stake = Number(chal.stake_amount || 0);
                    return (
                      <div
                        key={chal.id}
                        className="p-4 rounded-2xl bg-slate-950/80 border border-white/10 hover:border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="bg-amber-500 text-slate-950 font-black text-[10px] uppercase">
                              {chal.game_type}
                            </Badge>
                            <span className="text-sm font-black text-white">{chal.creator_name}</span>
                            <span className="text-[11px] font-mono text-slate-400">
                              Room #{chal.room_code}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs">
                            <span className="text-slate-300">
                              Stake: <strong className="text-amber-300 font-mono">GH₵ {stake.toFixed(2)}</strong>
                            </span>
                            <span className="text-emerald-400 font-black font-mono">
                              🏆 Winner Takes: GH₵ {Number(chal.prize_pool || 0).toFixed(2)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {isMine ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setMySide("creator");
                                  setActiveChallenge(chal);
                                }}
                                className="h-9 rounded-xl border-amber-500/40 text-amber-300 text-xs font-bold"
                              >
                                Open Room
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleCancelOpenChallenge(chal.id)}
                                className="h-9 rounded-xl text-rose-400 hover:bg-rose-500/10 text-xs font-bold"
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              {user && (
                                <Button
                                  size="sm"
                                  disabled={joiningChallengeId === chal.id}
                                  onClick={() => handleJoinChallenge(chal, "wallet")}
                                  className="h-9 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs gap-1.5"
                                >
                                  <Wallet className="w-3.5 h-3.5" />
                                  Accept (Wallet)
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={joiningChallengeId === chal.id}
                                onClick={() => handleJoinChallenge(chal, "momo")}
                                className="h-9 rounded-xl border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-black text-xs gap-1.5"
                              >
                                <Smartphone className="w-3.5 h-3.5" />
                                Accept (MoMo)
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            {/* Recent Champions & Free Data Winners */}
            <Card className="border-white/10 bg-slate-900/80 backdrop-blur-xl shadow-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-black text-white flex items-center gap-2">
                  <Crown className="w-4 h-4 text-amber-400" />
                  Recent Arena Winners &amp; Free Data Claims
                </CardTitle>
              </CardHeader>
              <CardContent>
                {recentClaims.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3">
                    Be the first champion today to claim Free Data or a Wallet Prize pot!
                  </p>
                ) : (
                  <div className="space-y-2">
                    {recentClaims.slice(0, 8).map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-white/5 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <Trophy className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span className="font-bold text-white">{c.winner_name}</span>
                          <span className="text-slate-400 text-[11px]">{c.notes}</span>
                        </div>
                        <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-[10px]">
                          {c.reward_type === "wallet_cash"
                            ? `+GH₵ ${Number(c.cash_amount || 0).toFixed(2)}`
                            : `🎁 ${c.network} ${c.data_package_size || "1GB"}`}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

