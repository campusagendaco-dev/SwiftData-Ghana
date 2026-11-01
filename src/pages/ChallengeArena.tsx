import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
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
  BellRing,
  Send,
  UserPlus,
  MessageCircle,
  Search,
  Brain,
  Zap,
  Compass,
} from "lucide-react";
import { OwareGameBoard, INITIAL_OWARE_STATE } from "@/components/games/OwareGameBoard";
import { GhanaLudoBoard, INITIAL_LUDO_STATE } from "@/components/games/GhanaLudoBoard";
import { DameCheckersBoard, INITIAL_DAME_STATE } from "@/components/games/DameCheckersBoard";
import { EightBallPoolBoard, INITIAL_POOL_STATE } from "@/components/games/EightBallPoolBoard";
import { MarketSlashBoard, INITIAL_SLASH_STATE } from "@/components/games/MarketSlashBoard";
import { ChallengeHowItWorks, GameInstructionPromptModal } from "@/components/games/ChallengeHowItWorks";
import { playSuccessSound } from "@/lib/sound";
import {
  DATA_TARGET_CATALOG,
  HUMAN_CHALLENGER_PERSONAS,
  getPlayerLevelStatus,
  playLevelUpFanfare,
  triggerHapticSensor,
  type DataTargetTier,
} from "@/lib/game-sensory-engine";

declare global {
  interface Window {
    PaystackPop?: any;
  }
}

type GameType = "oware" | "ludo" | "dame" | "pool" | "slash";
type ChallengeMode = "p2p" | "ai" | "free_data";
type PaymentSource = "wallet" | "momo" | "free";

interface SuggestedPlayer {
  user_id: string;
  full_name: string;
  masked_phone: string;
  phone: string;
  is_agent: boolean;
}

const GAME_CATALOG: {
  id: GameType;
  name: string;
  subtitle: string;
  badge: string;
  emoji: string;
  gradient: string;
}[] = [
  {
    id: "slash",
    name: "Market Slash (Makola & Kejetia)",
    subtitle: "Swipe fast across the wooden board to slice Watermelons, Papayas & Pineapples across 5 market stalls while dodging bombs!",
    badge: "🔪 Swipe & Slice",
    emoji: "🍉",
    gradient: "from-orange-600/35 via-amber-900/25 to-slate-950 border-orange-500/50",
  },
  {
    id: "oware",
    name: "Ghana Oware (Nam-Nam & Abapa)",
    subtitle: "Authentic Akan 12-bowl Oware with continuous Nam-Nam relay sowing (4-seed harvest) & Abapa tournament rules!",
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
    id: "pool",
    name: "8-Ball Pool (Landscape Pro)",
    subtitle: "Turn your phone sideways! Aim the cue laser, control shot power, sink Solids or Stripes & pot the 8-Ball!",
    badge: "📱 Rotate Phone",
    emoji: "🎱",
    gradient: "from-sky-600/30 via-blue-900/25 to-slate-950 border-sky-500/40",
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
  if (gameType === "slash") return INITIAL_SLASH_STATE;
  if (gameType === "oware") return INITIAL_OWARE_STATE;
  if (gameType === "ludo") return INITIAL_LUDO_STATE;
  if (gameType === "pool") return INITIAL_POOL_STATE;
  if (gameType === "dame") return INITIAL_DAME_STATE;
  return INITIAL_DAME_STATE;
}

export default function ChallengeArena() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const roomQueryParam = (searchParams.get("room") || "").trim().toUpperCase();

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
  const [rewardType] = useState<"wallet_cash" | "data_bundle">("wallet_cash");
  const [rewardNetwork] = useState<string>("MTN");

  // Invite Player & Broadcast state
  const [invitedPhone, setInvitedPhone] = useState<string>("");
  const [selectedInvitedUser, setSelectedInvitedUser] = useState<SuggestedPlayer | null>(null);
  const [playerSearchQuery, setPlayerSearchQuery] = useState<string>("");
  const [suggestedPlayers, setSuggestedPlayers] = useState<SuggestedPlayer[]>([]);
  const [searchingPlayers, setSearchingPlayers] = useState<boolean>(false);
  const [sendingInvite, setSendingInvite] = useState<boolean>(false);
  const [roomInvitePhone, setRoomInvitePhone] = useState<string>("");

  // Active match state
  const [activeChallenge, setActiveChallenge] = useState<any | null>(null);
  const [mySide, setMySide] = useState<"creator" | "opponent">("creator");
  const [copiedCode, setCopiedCode] = useState(false);

  // Claim Free Data / Bundle Modal state
  const [claimPhone, setClaimPhone] = useState("");
  const [claimNetwork, setClaimNetwork] = useState("MTN");
  const [claimingReward, setClaimingReward] = useState(false);

  // Level & Target Data Bundle Accumulation State (Medium Difficulty Progression)
  const [arenaPoints, setArenaPoints] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem("swiftdata_arena_points_v1"));
      return Number.isFinite(saved) && saved >= 0 ? saved : 120; // Start new players with 120 welcome points!
    } catch {
      return 120;
    }
  });
  const [targetDataSize, setTargetDataSize] = useState<DataTargetTier>(() => {
    try {
      const saved = window.localStorage.getItem("swiftdata_target_data_v1") as DataTargetTier;
      return saved === "1GB" || saved === "2GB" || saved === "5GB" ? saved : "1GB";
    } catch {
      return "1GB";
    }
  });
  const [lastPointsPopup, setLastPointsPopup] = useState<{ pts: number; reason: string } | null>(
    null
  );
  const [claimingPointsBundle, setClaimingPointsBundle] = useState(false);

  // Join challenge modal state for MoMo / Guest
  const [joiningChallengeId, setJoiningChallengeId] = useState<string | null>(null);
  const [filterGame, setFilterGame] = useState<string>("all");
  const [instructionModalOpen, setInstructionModalOpen] = useState<boolean>(false);

  const levelInfo = getPlayerLevelStatus(arenaPoints);
  const selectedTargetOption =
    DATA_TARGET_CATALOG.find((t) => t.size === targetDataSize) || DATA_TARGET_CATALOG[0];
  const targetProgressPercent = Math.min(
    100,
    Math.round((arenaPoints / selectedTargetOption.pointsRequired) * 100)
  );
  const canRedeemTargetBundle = arenaPoints >= selectedTargetOption.pointsRequired;

  const handleSelectTargetData = (tier: DataTargetTier) => {
    setTargetDataSize(tier);
    try {
      window.localStorage.setItem("swiftdata_target_data_v1", tier);
    } catch {
      // ignore storage error
    }
  };

  const handlePointsEarned = useCallback(
    (pts: number, reason: string) => {
      if (!pts || pts <= 0) return;
      setArenaPoints((prev) => {
        const prevLevel = getPlayerLevelStatus(prev).level;
        const nextTotal = prev + pts;
        const nextLevelInfo = getPlayerLevelStatus(nextTotal);
        try {
          window.localStorage.setItem("swiftdata_arena_points_v1", String(nextTotal));
        } catch {
          // ignore
        }
        if (nextLevelInfo.level > prevLevel) {
          playLevelUpFanfare();
          triggerHapticSensor("level_up");
          toast({
            title: `🎖️ LEVEL UP! Level ${nextLevelInfo.level} • ${nextLevelInfo.title}`,
            description: `You now have ${nextTotal.toLocaleString()} Arena Points toward your ${targetDataSize} Free Data target!`,
          });
        }
        return nextTotal;
      });
      setLastPointsPopup({ pts, reason });
    },
    [targetDataSize, toast]
  );

  const handleRedeemPointsBundle = async () => {
    if (!canRedeemTargetBundle) return;
    if (!claimPhone || claimPhone.replace(/\D/g, "").length < 9) {
      toast({
        title: "Valid Phone Number Required",
        description: "Enter a 10-digit Ghana number (e.g. 0241234567) to receive your Free Data Bundle.",
        variant: "destructive",
      });
      return;
    }

    setClaimingPointsBundle(true);
    try {
      const { data, error } = await supabase.functions.invoke("challenge-arena", {
        body: {
          action: "claim_points_reward",
          phone: claimPhone,
          network: claimNetwork,
          target_data_size: selectedTargetOption.size,
          points_spent: selectedTargetOption.pointsRequired,
          player_level: levelInfo.level,
          winner_name: (playerName || profile?.full_name || "Arena Champion").trim(),
        },
      });
      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Could not redeem points reward");
      }

      playLevelUpFanfare();
      triggerHapticSensor("victory");
      const remainingPts = Math.max(0, arenaPoints - selectedTargetOption.pointsRequired);
      setArenaPoints(remainingPts);
      try {
        window.localStorage.setItem("swiftdata_arena_points_v1", String(remainingPts));
      } catch {
        // ignore
      }

      toast({
        title: `🎁 ${selectedTargetOption.size} Free Data Bundle Redeemed!`,
        description: data.message,
      });
      fetchLobby(true);
    } catch (err: any) {
      toast({
        title: "Redemption Failed",
        description: err.message || "Could not redeem points bundle",
        variant: "destructive",
      });
    } finally {
      setClaimingPointsBundle(false);
    }
  };

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

  const searchPlayersToInvite = useCallback(async (query: string) => {
    setSearchingPlayers(true);
    try {
      const { data } = await supabase.functions.invoke("challenge-arena", {
        body: { action: "search_players", query },
      });
      if (data?.success && Array.isArray(data.players)) {
        setSuggestedPlayers(data.players);
      }
    } catch (_err) {
      // ignore search error
    } finally {
      setSearchingPlayers(false);
    }
  }, []);

  useEffect(() => {
    fetchWalletAndPaystackKey();
    fetchLobby();
    searchPlayersToInvite("");
  }, [fetchWalletAndPaystackKey, fetchLobby, searchPlayersToInvite]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (playerSearchQuery.trim().length >= 2 || playerSearchQuery.trim().length === 0) {
        searchPlayersToInvite(playerSearchQuery.trim());
      }
    }, 300);
    return () => clearTimeout(t);
  }, [playerSearchQuery, searchPlayersToInvite]);

  // Auto-open room if current user is creator or opponent of ?room=XXXXXX
  useEffect(() => {
    if (!roomQueryParam || challenges.length === 0 || activeChallenge) return;
    const matched = challenges.find(
      (c) => String(c.room_code || "").toUpperCase() === roomQueryParam
    );
    if (!matched) return;

    if (user?.id && matched.creator_id === user.id) {
      setMySide("creator");
      setActiveChallenge(matched);
    } else if (user?.id && matched.opponent_id === user.id) {
      setMySide("opponent");
      setActiveChallenge(matched);
    }
  }, [roomQueryParam, challenges, activeChallenge, user?.id]);

  // Realtime subscription to game_challenges for live 1v1 moves & open challenge board
  useEffect(() => {
    const channel = supabase
      .channel("challenge_arena_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_challenges" },
        (payload: any) => {
          const updated = payload.new;
          const oldRow = payload.old;
          if (!updated) return;

          setChallenges((prev) => {
            const exists = prev.some((c) => c.id === updated.id);
            if (!exists) return [updated, ...prev];
            return prev.map((c) => (c.id === updated.id ? updated : c));
          });

          setActiveChallenge((curr: any) => {
            if (curr && curr.id === updated.id) {
              // If opponent just joined the creator's waiting room, celebrate with sound + toast!
              if (curr.status === "open" && updated.status === "in_progress" && updated.opponent_name) {
                playSuccessSound();
                toast({
                  title: `🔥 ${updated.opponent_name} Accepted Your Challenge!`,
                  description: `Room #${updated.room_code} is now LIVE! Make your opening move!`,
                });
              }
              return updated;
            }
            return curr;
          });

          // If another challenge in the lobby was just accepted, show a subtle arena toast
          if (
            oldRow?.status === "open" &&
            updated.status === "in_progress" &&
            updated.opponent_name &&
            (!activeChallenge || activeChallenge.id !== updated.id)
          ) {
            toast({
              title: `⚔️ Challenge Accepted (#${updated.room_code})`,
              description: `${updated.opponent_name} just accepted ${updated.creator_name}'s ${String(
                updated.game_type || ""
              ).toUpperCase()} challenge for GH₵ ${Number(updated.prize_pool || 0).toFixed(2)}!`,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeChallenge, toast]);

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
          invited_phone: selectedInvitedUser?.phone || invitedPhone.trim() || undefined,
          invited_user_id: selectedInvitedUser?.user_id || undefined,
          invited_name: selectedInvitedUser?.full_name || undefined,
          reward_type: selectedMode === "free_data" ? "free_data" : rewardType,
          reward_network: rewardNetwork,
          reward_data_size:
            selectedMode === "free_data"
              ? targetDataSize || settings.free_data_package_size || "1GB"
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
        title: "🎮 Challenge Created & Broadcasted!",
        description: data.message,
      });

      setMySide("creator");
      setActiveChallenge(data.challenge);
      setInvitedPhone("");
      setSelectedInvitedUser(null);
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

  const handleSendRoomInvite = async (
    challenge: any,
    opts: { phone?: string; invitedUser?: SuggestedPlayer | null; broadcastAll?: boolean }
  ) => {
    setSendingInvite(true);
    try {
      const { data, error } = await supabase.functions.invoke("challenge-arena", {
        body: {
          action: "invite_player",
          challenge_id: challenge.id,
          invited_phone: opts.invitedUser?.phone || opts.phone?.trim() || undefined,
          invited_user_id: opts.invitedUser?.user_id || undefined,
          invited_name: opts.invitedUser?.full_name || undefined,
          broadcast_all: Boolean(opts.broadcastAll),
        },
      });
      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Failed to send invite");
      }
      playSuccessSound();
      toast({
        title: "📲 Challenge Notification Dispatched!",
        description: data.message,
      });
      setRoomInvitePhone("");
    } catch (err: any) {
      toast({
        title: "Invite Failed",
        description: err.message || "Could not dispatch invite",
        variant: "destructive",
      });
    } finally {
      setSendingInvite(false);
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
        title: "🔥 Match Started & All Users Notified!",
        description: data.message,
      });

      setMySide("opponent");
      setActiveChallenge(data.challenge);
      if (roomQueryParam) {
        setSearchParams({});
      }
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
  const invitedSpotlightChallenge = roomQueryParam
    ? challenges.find((c) => String(c.room_code || "").toUpperCase() === roomQueryParam && c.status === "open")
    : null;
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
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300 font-bold text-xs gap-1">
                <BellRing className="w-3 h-3" /> Live Web Push, SMS &amp; In-App Alerts Active
              </Badge>
            </div>
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white">
              Play 8-Ball Pool, Oware, Ludo &amp; Dame — Win Cash or Target Free Data!
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Create an <strong>Open Challenge</strong> (auto-notifies all users via Web, SMS &amp; In-App),{" "}
              <strong>invite a friend</strong>, or challenge our <strong>91%–95% Human-Sense Champions (Medium Difficulty)</strong>{" "}
              with <strong>Gyro Motion Sensors</strong>, <strong>3D Audio</strong> &amp; <strong>Haptic Vibration</strong> to level up and accumulate points toward your <strong>1GB, 2GB, or 5GB Free Data Bundle</strong>!
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

      {/* ── PRO LEVEL & TARGET DATA BUNDLE ACCUMULATION CONSOLE (1GB / 2GB / 5GB) ── */}
      <div className="p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-slate-900/95 via-sky-950/40 to-purple-950/40 border border-sky-500/35 shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Player Level & Human-Sense Difficulty Badge */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="px-3.5 py-2 rounded-2xl bg-amber-500/15 border border-amber-400/50 flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 font-black flex items-center justify-center text-sm shadow">
                L{levelInfo.level}
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-amber-300">
                  Level {levelInfo.level} • {levelInfo.title}
                </p>
                <p className="text-xs font-black text-white font-mono">
                  ⚡ {arenaPoints.toLocaleString()} Total Arena Points
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold gap-1 px-2.5 py-1">
                <Brain className="w-3.5 h-3.5" />
                {HUMAN_CHALLENGER_PERSONAS[selectedGame].name} •{" "}
                {HUMAN_CHALLENGER_PERSONAS[selectedGame].humanSensePercent}% Human Sense (Medium)
              </Badge>
              <Badge className="bg-sky-500/15 text-sky-300 border border-sky-500/40 text-[11px] font-bold gap-1 px-2.5 py-1">
                <Compass className="w-3.5 h-3.5" />
                Gyro Motion + Sound + Haptic Sensors Active
              </Badge>
              {lastPointsPopup && (
                <Badge className="bg-amber-400 text-slate-950 font-black text-[11px] animate-bounce px-2.5 py-1">
                  +{lastPointsPopup.pts} PTS • {lastPointsPopup.reason}
                </Badge>
              )}
            </div>
          </div>

          {/* Target Data Bundle Selector (1GB / 2GB / 5GB) */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-black uppercase tracking-wider text-purple-300 flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-amber-400" /> Target Free Data Goal:
            </span>
            <div className="inline-flex items-center rounded-2xl bg-slate-950 p-1 border border-white/15 gap-1">
              {DATA_TARGET_CATALOG.map((tier) => {
                const active = targetDataSize === tier.size;
                return (
                  <button
                    key={tier.size}
                    type="button"
                    onClick={() => handleSelectTargetData(tier.size)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                      active
                        ? "bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow"
                        : "text-slate-300 hover:text-white"
                    }`}
                  >
                    <span>🎁 {tier.size}</span>
                    <span className="text-[10px] font-mono opacity-85">
                      ({tier.pointsRequired.toLocaleString()} Pts)
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Animated Target Data Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between text-xs gap-2">
            <span className="font-bold text-slate-200">
              Progress to{" "}
              <strong className="text-amber-300">{selectedTargetOption.label}</strong> (Earn{" "}
              <span className="text-emerald-300 font-semibold">+40 Pts/ball</span>,{" "}
              <span className="text-emerald-300 font-semibold">+15 Pts/seed</span>,{" "}
              <span className="text-emerald-300 font-semibold">+50 Pts/kick</span>,{" "}
              <span className="text-emerald-300 font-semibold">+300 Pts/win</span>)
            </span>
            <span className="font-mono font-black text-amber-300">
              {arenaPoints.toLocaleString()} / {selectedTargetOption.pointsRequired.toLocaleString()} PTS (
              {targetProgressPercent}%)
            </span>
          </div>
          <div className="w-full h-3.5 rounded-full bg-slate-950 border border-white/15 overflow-hidden p-0.5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 via-emerald-400 to-amber-400 transition-all duration-500 shadow-[0_0_12px_rgba(52,211,153,0.6)]"
              style={{ width: `${targetProgressPercent}%` }}
            />
          </div>
        </div>

        {/* Instant Target Data Bundle Redemption Panel (Unlocks at 100% Points!) */}
        {canRedeemTargetBundle && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/90 via-teal-950/80 to-slate-950 border-2 border-emerald-400 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-black text-white flex items-center gap-1.5">
                🎉 Target Reached! Redeem Your {selectedTargetOption.label} Now!
              </p>
              <p className="text-xs text-emerald-200">
                You accumulated {arenaPoints.toLocaleString()} Points (Level {levelInfo.level}). Enter your Ghana phone number below to claim your{" "}
                <strong>{selectedTargetOption.size} Data Bundle</strong>!
              </p>
            </div>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <select
                value={claimNetwork}
                onChange={(e) => setClaimNetwork(e.target.value)}
                className="h-10 rounded-xl bg-slate-950 border border-emerald-500/40 px-3 text-xs font-bold text-white"
              >
                <option value="MTN">MTN</option>
                <option value="TELECEL">Telecel</option>
                <option value="AT">AirtelTigo</option>
              </select>
              <Input
                placeholder="0241234567"
                value={claimPhone}
                onChange={(e) => setClaimPhone(e.target.value)}
                className="h-10 w-40 rounded-xl bg-slate-950 border-emerald-500/40 text-xs font-mono text-white"
              />
              <Button
                type="button"
                disabled={claimingPointsBundle}
                onClick={handleRedeemPointsBundle}
                className="h-10 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs gap-1.5 px-4 shrink-0"
              >
                {claimingPointsBundle ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Gift className="w-4 h-4" />
                )}
                Redeem {selectedTargetOption.size} Data
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Deep-Link Invited Challenge Spotlight Banner (?room=XXXXXX) ── */}
      {!activeChallenge && invitedSpotlightChallenge && (
        <div className="p-5 sm:p-6 rounded-3xl bg-gradient-to-r from-amber-500/20 via-orange-500/15 to-emerald-500/20 border-2 border-amber-400 shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in zoom-in-95 duration-300">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="bg-amber-400 text-slate-950 font-black text-[10px] uppercase">
                🎯 Direct Challenge Invite • Room #{invitedSpotlightChallenge.room_code}
              </Badge>
              <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 font-mono text-xs">
                Winner Takes GH₵ {Number(invitedSpotlightChallenge.prize_pool || 0).toFixed(2)}
              </Badge>
            </div>
            <h2 className="text-lg sm:text-xl font-black text-white">
              {invitedSpotlightChallenge.creator_name} challenged you to play{" "}
              <span className="text-amber-300 uppercase">{invitedSpotlightChallenge.game_type}</span>!
            </h2>
            <p className="text-xs text-slate-200">
              Required Stake: <strong className="text-amber-300 font-mono">GH₵ {Number(invitedSpotlightChallenge.stake_amount || 0).toFixed(2)}</strong> • Once you accept, the match starts immediately and all players are notified!
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {user && (
              <Button
                disabled={joiningChallengeId === invitedSpotlightChallenge.id}
                onClick={() => handleJoinChallenge(invitedSpotlightChallenge, "wallet")}
                className="h-11 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs gap-2 px-5 shadow-lg"
              >
                <Wallet className="w-4 h-4" />
                Accept with Wallet (GH₵ {Number(invitedSpotlightChallenge.stake_amount || 0).toFixed(2)})
              </Button>
            )}
            <Button
              variant="outline"
              disabled={joiningChallengeId === invitedSpotlightChallenge.id}
              onClick={() => handleJoinChallenge(invitedSpotlightChallenge, "momo")}
              className="h-11 rounded-2xl border-amber-400 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-black text-xs gap-2 px-5"
            >
              <Smartphone className="w-4 h-4" />
              Accept with MoMo (GH₵ {Number(invitedSpotlightChallenge.stake_amount || 0).toFixed(2)})
            </Button>
          </div>
        </div>
      )}

      {/* ── Interactive 4-Step Animated Guide & Game Mechanics Preview ── */}
      {!activeChallenge && (
        <ChallengeHowItWorks
          onQuickStart={(g, m) => {
            setSelectedGame(g);
            setSelectedMode(m);
            setInstructionModalOpen(true);
          }}
        />
      )}

      {/* ── On-Select Game Instruction Modal (Skip or Follow 4 Steps) ── */}
      <GameInstructionPromptModal
        gameType={selectedGame}
        open={instructionModalOpen}
        onSkip={() => setInstructionModalOpen(false)}
        onStartGame={() => setInstructionModalOpen(false)}
      />

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
                        description: `Room #${activeChallenge.room_code} link copied. Send to a friend on WhatsApp or SMS!`,
                      });
                      setTimeout(() => setCopiedCode(false), 2000);
                    }}
                    className="h-9 rounded-xl border-amber-500/40 bg-amber-500/10 text-amber-300 font-bold text-xs gap-1.5"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                    Copy Invite Link
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
            {/* Waiting for Opponent + Live Invite & Broadcast Console (Open P2P Challenge) */}
            {activeChallenge.status === "open" && (
              <div className="p-5 sm:p-6 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-5">
                <div className="text-center space-y-2">
                  <Loader2 className="w-8 h-8 text-amber-400 animate-spin mx-auto" />
                  <h3 className="text-base sm:text-lg font-black text-white">
                    Open Challenge #{activeChallenge.room_code} is Live &amp; Broadcasted to All Users!
                  </h3>
                  <p className="text-xs text-slate-300 max-w-xl mx-auto">
                    All users have been notified via <strong>In-App Popup</strong>, <strong>Web Push</strong>, and{" "}
                    <strong>SMS</strong>. You can also invite a specific friend by phone number or WhatsApp below — once they accept, everyone gets notified and the match starts automatically!
                  </p>
                </div>

                {/* Direct Invite & Re-Broadcast Console */}
                <div className="max-w-2xl mx-auto p-4 rounded-2xl bg-slate-950/90 border border-white/10 space-y-3.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-black text-amber-300 flex items-center gap-1.5">
                      <UserPlus className="w-4 h-4" /> Invite a Friend via SMS / In-App / WhatsApp
                    </span>
                    <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">
                      Instant SMS + Web + App Link
                    </Badge>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      placeholder="Enter friend's Ghana phone (e.g. 0241234567)"
                      value={roomInvitePhone}
                      onChange={(e) => setRoomInvitePhone(e.target.value)}
                      className="h-10 rounded-xl bg-slate-900 border-white/15 font-mono text-xs text-white flex-1"
                    />
                    <Button
                      type="button"
                      disabled={sendingInvite || !roomInvitePhone.trim()}
                      onClick={() =>
                        handleSendRoomInvite(activeChallenge, { phone: roomInvitePhone })
                      }
                      className="h-10 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs gap-1.5 shrink-0"
                    >
                      {sendingInvite ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      Send SMS &amp; App Invite
                    </Button>
                  </div>

                  {/* Quick-pick registered players */}
                  {suggestedPlayers.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Or Click a Registered Player to Invite Directly:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {suggestedPlayers.slice(0, 6).map((p) => (
                          <button
                            key={p.user_id}
                            type="button"
                            disabled={sendingInvite}
                            onClick={() => handleSendRoomInvite(activeChallenge, { invitedUser: p })}
                            className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-amber-500/20 border border-white/10 hover:border-amber-400/50 text-[11px] font-bold text-slate-200 hover:text-amber-300 transition-all flex items-center gap-1.5 cursor-pointer"
                          >
                            <span>🎯 {p.full_name}</span>
                            <span className="text-[9px] font-mono text-slate-400">({p.masked_phone})</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={sendingInvite}
                      onClick={() => handleSendRoomInvite(activeChallenge, { broadcastAll: true })}
                      className="h-9 rounded-xl border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 font-bold text-xs gap-1.5"
                    >
                      <BellRing className="w-3.5 h-3.5" />
                      Notify All Online Users Again
                    </Button>

                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(
                        `⚔️ I just posted a ${String(activeChallenge.game_type || "").toUpperCase()} Challenge on SwiftData Arena!\n💰 Stake: GH₵ ${Number(
                          activeChallenge.stake_amount || 0
                        ).toFixed(2)} | 🏆 Winner Takes: GH₵ ${Number(
                          activeChallenge.prize_pool || 0
                        ).toFixed(2)}\n🔑 Room #${activeChallenge.room_code}\n👉 Accept my challenge live: ${
                          window.location.origin
                        }/challenges?room=${activeChallenge.room_code}`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      Invite via WhatsApp
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Winner Reward Claim / Point Accumulation Banner */}
            {activeChallenge.status === "completed" &&
              activeChallenge.winner_side === mySide &&
              !activeChallenge.reward_claimed && (
                <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-950/90 via-teal-950/80 to-slate-900 border-2 border-emerald-400/60 space-y-4">
                  {activeChallenge.mode === "free_data" && !canRedeemTargetBundle ? (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
                          🏆 Victory! +300 Arena Points Added (Level {levelInfo.level} • {levelInfo.title})
                        </h3>
                        <p className="text-xs text-emerald-200">
                          You now have{" "}
                          <strong className="text-amber-300 font-mono">
                            {arenaPoints.toLocaleString()} /{" "}
                            {selectedTargetOption.pointsRequired.toLocaleString()} PTS (
                            {targetProgressPercent}%)
                          </strong>{" "}
                          toward your <strong>{selectedTargetOption.label}</strong>! Need{" "}
                          <strong className="text-amber-300 font-mono">
                            {Math.max(
                              0,
                              selectedTargetOption.pointsRequired - arenaPoints
                            ).toLocaleString()}{" "}
                            more points
                          </strong>{" "}
                          to unlock instant redemption.
                        </p>
                      </div>
                      <Button
                        type="button"
                        disabled={submitting}
                        onClick={handleCreateChallenge}
                        className="h-11 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs gap-2 px-5 shrink-0 shadow-lg"
                      >
                        <Zap className="w-4 h-4" />
                        Play Next Level Match (+300 Pts)
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <div className="p-3 rounded-2xl bg-emerald-500 text-slate-950">
                          <Gift className="w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="text-base sm:text-lg font-black text-white">
                            🎉 Congratulations! Claim Your{" "}
                            {activeChallenge.mode === "free_data"
                              ? `Free ${selectedTargetOption.size} Data Bundle`
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
                          onClick={
                            activeChallenge.mode === "free_data"
                              ? handleRedeemPointsBundle
                              : handleClaimDataReward
                          }
                          disabled={claimingReward || claimingPointsBundle}
                          className="h-11 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs gap-2"
                        >
                          {claimingReward || claimingPointsBundle ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Gift className="w-4 h-4" />
                          )}
                          Claim {selectedTargetOption.size} Data Bundle Now
                        </Button>
                      </div>
                    </>
                  )}
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
                    opponentName={
                      activeChallenge.opponent_name || HUMAN_CHALLENGER_PERSONAS.oware.name
                    }
                    initialState={activeChallenge.board_state}
                    onStateChange={handleBoardStateChange}
                    onMatchComplete={handleMatchComplete}
                    onPointsEarned={handlePointsEarned}
                    playerLevel={levelInfo.level}
                  />
                )}
                {activeChallenge.game_type === "ludo" && (
                  <GhanaLudoBoard
                    mode={activeChallenge.mode}
                    mySide={mySide}
                    creatorName={activeChallenge.creator_name}
                    opponentName={
                      activeChallenge.opponent_name || HUMAN_CHALLENGER_PERSONAS.ludo.name
                    }
                    initialState={activeChallenge.board_state}
                    onStateChange={handleBoardStateChange}
                    onMatchComplete={handleMatchComplete}
                    onPointsEarned={handlePointsEarned}
                    playerLevel={levelInfo.level}
                  />
                )}
                {activeChallenge.game_type === "dame" && (
                  <DameCheckersBoard
                    mode={activeChallenge.mode}
                    mySide={mySide}
                    creatorName={activeChallenge.creator_name}
                    opponentName={
                      activeChallenge.opponent_name || HUMAN_CHALLENGER_PERSONAS.dame.name
                    }
                    initialState={activeChallenge.board_state}
                    onStateChange={handleBoardStateChange}
                    onMatchComplete={handleMatchComplete}
                    onPointsEarned={handlePointsEarned}
                    playerLevel={levelInfo.level}
                  />
                )}
                {activeChallenge.game_type === "pool" && (
                  <EightBallPoolBoard
                    mode={activeChallenge.mode}
                    mySide={mySide}
                    creatorName={activeChallenge.creator_name}
                    opponentName={
                      activeChallenge.opponent_name || HUMAN_CHALLENGER_PERSONAS.pool.name
                    }
                    initialState={activeChallenge.board_state}
                    onStateChange={handleBoardStateChange}
                    onMatchComplete={handleMatchComplete}
                    onPointsEarned={handlePointsEarned}
                    playerLevel={levelInfo.level}
                  />
                )}
                {activeChallenge.game_type === "slash" && (
                  <MarketSlashBoard
                    mode={activeChallenge.mode}
                    mySide={mySide}
                    creatorName={activeChallenge.creator_name}
                    opponentName={
                      activeChallenge.opponent_name || HUMAN_CHALLENGER_PERSONAS.slash.name
                    }
                    initialState={activeChallenge.board_state}
                    onStateChange={handleBoardStateChange}
                    onMatchComplete={handleMatchComplete}
                    onPointsEarned={handlePointsEarned}
                    playerLevel={levelInfo.level}
                    onBackToLobby={() => setActiveChallenge(null)}
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
                Choose a traditional Ghanaian or Pro Arena game, pick your stake mode (Wallet, MoMo, or Free Data), and invite or notify players!
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 1. Choose Game */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-wider text-amber-400">
                    1. Choose Arena Game (Tap to View Steps or Skip)
                  </Label>
                  <button
                    type="button"
                    onClick={() => setInstructionModalOpen(true)}
                    className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
                  >
                    📖 View Game Steps
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {GAME_CATALOG.map((g) => {
                    const active = selectedGame === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => {
                          setSelectedGame(g.id);
                          setInstructionModalOpen(true);
                        }}
                        className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
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
                          ) : g.id === "pool" ? (
                            <img src="/pool-challenge-icon.jpg" alt="8-Ball Pool" className="w-10 h-7 rounded-lg object-cover shadow-md border border-sky-400/50" />
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
                    <span className="text-[9px] opacity-75">Notify All / Invite</span>
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
                    <Brain className="w-4 h-4 mx-auto mb-1" />
                    <span className="text-[11px] block">Human Sense</span>
                    <span className="text-[9px] opacity-75">1.8× • Medium</span>
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
                    <span className="text-[9px] opacity-75">Target {targetDataSize}</span>
                  </button>
                </div>
              </div>

              {/* 3. Payment Source & Stake Amount (When not Free Data mode) */}
              {selectedMode !== "free_data" ? (
                <div className="space-y-3 pt-1">
                  <Label className="text-xs font-bold uppercase tracking-wider text-amber-400">
                    3. Stake Source (Wallet Balance or Mobile Money)
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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
                <div className="p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/30 text-xs text-purple-200 space-y-1.5">
                  <p className="font-black text-purple-300 flex items-center gap-1.5">
                    <Gift className="w-4 h-4" /> Free Data Level &amp; Point Accumulation ({targetDataSize} Goal)
                  </p>
                  <p>
                    Play against <strong>{HUMAN_CHALLENGER_PERSONAS[selectedGame].name}</strong> ({HUMAN_CHALLENGER_PERSONAS[selectedGame].humanSensePercent}% Human Sense • Medium Difficulty). Every potted ball, harvested seed, token kick &amp; victory adds points toward your <strong>{selectedTargetOption.label}</strong> ({arenaPoints.toLocaleString()} / {selectedTargetOption.pointsRequired.toLocaleString()} Pts)!
                  </p>
                </div>
              )}

              {/* 4. Invite a Specific Player & Auto-Notify All Users (When Open 1v1 mode) */}
              {selectedMode === "p2p" && (
                <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-amber-500/30 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-[11px] font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5" /> 4. Invite Player &amp; Notify All Users
                    </Label>
                    <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[9px]">
                      Web + SMS + App Alert
                    </Badge>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Posting an Open Challenge automatically alerts <strong>all users</strong>. Optionally enter a friend&apos;s phone number or pick a player below to send them a personal SMS &amp; App invite:
                  </p>

                  {selectedInvitedUser ? (
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-500/15 border border-amber-400/50 text-xs">
                      <div>
                        <span className="font-black text-amber-300">🎯 Inviting: {selectedInvitedUser.full_name}</span>
                        <span className="ml-2 font-mono text-[10px] text-slate-300">({selectedInvitedUser.masked_phone})</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedInvitedUser(null)}
                        className="text-[10px] font-bold text-rose-300 hover:text-rose-200 underline"
                      >
                        Clear
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input
                          placeholder="Friend's Phone (Optional, e.g. 024...)"
                          value={invitedPhone}
                          onChange={(e) => setInvitedPhone(e.target.value)}
                          className="h-9 rounded-xl bg-slate-900 border-white/15 text-xs font-mono text-white"
                        />
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                          <Input
                            placeholder="Search registered player..."
                            value={playerSearchQuery}
                            onChange={(e) => setPlayerSearchQuery(e.target.value)}
                            className="h-9 pl-8 rounded-xl bg-slate-900 border-white/15 text-xs text-white"
                          />
                        </div>
                      </div>

                      {suggestedPlayers.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {suggestedPlayers.slice(0, 5).map((p) => (
                            <button
                              key={p.user_id}
                              type="button"
                              onClick={() => {
                                setSelectedInvitedUser(p);
                                setInvitedPhone(p.phone || "");
                              }}
                              className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-amber-500/20 border border-white/10 hover:border-amber-400/40 text-[10px] font-bold text-slate-300 hover:text-amber-300 transition-all"
                            >
                              + {p.full_name} ({p.masked_phone})
                            </button>
                          ))}
                          {searchingPlayers && (
                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" /> searching...
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  )}
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
                  <Label className="text-[11px] text-slate-400">Your Phone (For Turn &amp; Prize SMS)</Label>
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
                  ? selectedInvitedUser
                    ? `Challenge ${selectedInvitedUser.full_name.split(" ")[0]} & Notify Arena (GH₵ ${Number(stakeAmount || 0).toFixed(2)})`
                    : invitedPhone.trim()
                    ? `Post & Send SMS Invite (GH₵ ${Number(stakeAmount || 0).toFixed(2)})`
                    : `Post Open ${selectedGame.toUpperCase()} Challenge & Notify All (GH₵ ${Number(stakeAmount || 0).toFixed(2)})`
                  : selectedMode === "ai"
                  ? `Play vs ${HUMAN_CHALLENGER_PERSONAS[selectedGame].name} (${HUMAN_CHALLENGER_PERSONAS[selectedGame].humanSensePercent}% Human Sense • GH₵ ${Number(stakeAmount || 0).toFixed(2)})`
                  : `Start ${selectedGame.toUpperCase()} Level Match (Target ${targetDataSize} Free Data)`}
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
                    Accept any open challenge below using your Wallet Balance or Mobile Money (MoMo). Once accepted, all users get notified!
                  </CardDescription>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {["all", "slash", "pool", "oware", "ludo", "dame"].map((g) => (
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
                      Create an Open Challenge on the left to notify all users via Web, SMS &amp; In-App — or play immediately against the Grandmaster AI!
                    </p>
                  </div>
                ) : (
                  openChallenges.map((chal) => {
                    const isMine = user && chal.creator_id === user.id;
                    const stake = Number(chal.stake_amount || 0);
                    const isHighlighted = roomQueryParam === String(chal.room_code || "").toUpperCase();
                    return (
                      <div
                        key={chal.id}
                        className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all ${
                          isHighlighted
                            ? "bg-amber-500/15 border-2 border-amber-400 shadow-lg"
                            : "bg-slate-950/80 border-white/10 hover:border-amber-500/40"
                        }`}
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
                            {chal.metadata?.invited_name && (
                              <Badge variant="outline" className="text-[9px] border-amber-400/40 text-amber-300">
                                🎯 Invited: {chal.metadata.invited_name}
                              </Badge>
                            )}
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

                        <div className="flex items-center gap-2 flex-wrap">
                          {isMine ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setMySide("creator");
                                  setActiveChallenge(chal);
                                }}
                                className="h-9 rounded-xl border-amber-500/40 text-amber-300 text-xs font-bold gap-1"
                              >
                                <UserPlus className="w-3.5 h-3.5" />
                                Open &amp; Invite
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
