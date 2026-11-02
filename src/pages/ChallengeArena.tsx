import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Trophy,
  Gamepad2,
  Wallet,
  Smartphone,
  Gift,
  Sparkles,
  Users,
  PlusCircle,
  RefreshCw,
  Check,
  XCircle,
  Share2,
  Loader2,
  Crown,
  ArrowLeft,
  ArrowRight,
  BellRing,
  Send,
  UserPlus,
  MessageCircle,
  Search,
  Brain,
  Zap,
  Compass,
  Settings,
  HelpCircle,
  Volume2,
  VolumeX,
  Vibrate,
  User,
  X,
  BookOpen,
  ChevronLeft,
  Hash,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useDeviceScreenFit } from "@/hooks/use-device-screen-fit";
import { OwareGameBoard, INITIAL_OWARE_STATE } from "@/components/games/OwareGameBoard";
import { GhanaLudoBoard, INITIAL_LUDO_STATE } from "@/components/games/GhanaLudoBoard";
import { DameCheckersBoard, INITIAL_DAME_STATE } from "@/components/games/DameCheckersBoard";
import { EightBallPoolBoard, INITIAL_POOL_STATE } from "@/components/games/EightBallPoolBoard";
import { MarketSlashBoard, INITIAL_SLASH_STATE } from "@/components/games/MarketSlashBoard";
import { CandyCrashBoard, INITIAL_CANDY_STATE } from "@/components/games/CandyCrashBoard";
import { BeachBuggyTrack, INITIAL_BUGGY_STATE } from "@/components/games/BeachBuggyTrack";
import {
  GamerCommunityHub,
  GamerCommunityPreviewCard,
} from "@/components/games/GamerCommunityHub";
import {
  DailyStoriesBar,
  VerifiedGamerAvatar,
  GamerAvatarPickerGrid,
} from "@/components/games/DailyStoriesBar";
import { GameInstructionPromptModal } from "@/components/games/ChallengeHowItWorks";
import { playSuccessSound } from "@/lib/sound";
import {
  DATA_TARGET_CATALOG,
  HUMAN_CHALLENGER_PERSONAS,
  getPlayerLevelStatus,
  playLevelUpFanfare,
  playTurnNotificationSound,
  triggerHapticSensor,
  getGameSensoryPreferences,
  setGameSensoryPreferences,
  type DataTargetTier,
} from "@/lib/game-sensory-engine";

declare global {
  interface Window {
    PaystackPop?: any;
  }
}

type GameType = "oware" | "ludo" | "dame" | "pool" | "slash" | "candy" | "buggy";
type ChallengeMode = "p2p" | "ai" | "free_data";
type PaymentSource = "wallet" | "momo" | "free";
type ProfileDrawerTab = "profile" | "settings" | "rooms" | "help";

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
  shortTitle: string;
  categoryTag: string;
  statusTag: string;
  statusColor: "gold" | "green";
  subtitle: string;
  rulesSummary: string[];
  badge: string;
  emoji: string;
  gradient: string;
}[] = [
  {
    id: "oware",
    name: "Oware",
    shortTitle: "Oware",
    categoryTag: "GHANA'S GAME",
    statusTag: "PLAY ONLINE",
    statusColor: "green",
    subtitle: "Our own board game. Beat Kofi, Ama and Nana, or send a friend a code and play online.",
    rulesSummary: [
      "Tap any of your 6 bowls on your side to scoop all seeds and sow counter-clockwise.",
      "Nam-Nam mode: relay-sow continuously and harvest whenever a bowl reaches 4 seeds.",
      "Abapa mode: single-lap sowing; capture opponent bowls holding 2 or 3 seeds.",
      "First player to capture 25 or more seeds wins the match!",
    ],
    badge: "Most Popular",
    emoji: "🪨",
    gradient: "from-amber-600/30 via-amber-900/20 to-slate-950 border-amber-500/40",
  },
  {
    id: "pool",
    name: "8-Ball Pool",
    shortTitle: "8-Ball Pool",
    categoryTag: "BILLIARDS",
    statusTag: "ONLINE",
    statusColor: "gold",
    subtitle: "Aim the laser cue, fine-tune stick angle on the left tray, and pull the cue stick to strike.",
    rulesSummary: [
      "Play in Landscape view for full tournament table precision.",
      "Use the Left Fine-Aim Tray to micro-adjust your cue angle and the Right Tray to pull & shoot.",
      "Pot all 7 of your group (Solids 1–7 or Stripes 9–15), then legally sink the Black 8-Ball.",
      "Scratching the white cue ball gives your opponent Ball-in-Hand anywhere on the felt.",
    ],
    badge: "Pro Physics",
    emoji: "🎱",
    gradient: "from-sky-600/30 via-blue-900/25 to-slate-950 border-sky-500/40",
  },
  {
    id: "slash",
    name: "Market Slash",
    shortTitle: "Market Slash",
    categoryTag: "REFLEX",
    statusTag: "NEW",
    statusColor: "gold",
    subtitle: "Swipe fast to slice flying Makola watermelons, pineapples & papayas while dodging bombs.",
    rulesSummary: [
      "Drag or swipe your finger across flying fruits to slice them with your blade.",
      "Slice 3+ fruits in a single swipe for multi-slice combo bonus points.",
      "Never touch the black explosives — hitting a bomb costs a life and drops your combo!",
      "Clear all 5 market stall stages with a higher score than your challenger to win.",
    ],
    badge: "Swipe & Slice",
    emoji: "🍉",
    gradient: "from-orange-600/35 via-amber-900/25 to-slate-950 border-orange-500/50",
  },
  {
    id: "ludo",
    name: "Ghana Ludo",
    shortTitle: "Ghana Ludo",
    categoryTag: "BOARD",
    statusTag: "ONLINE",
    statusColor: "gold",
    subtitle: "52-cell track Ludo for 2–4 players. Roll a 6 to launch, kick opponents & race home.",
    rulesSummary: [
      "Tap the 3D dice on your turn; roll a 6 to bring a token out of your Base onto your start square.",
      "Landing on an opponent token on a non-safe square sends it back to Base and grants a bonus roll.",
      "Rolling a 6, capturing an opponent, or reaching the center Home triangle earns an extra roll.",
      "First player to bring all 4 tokens into the center Home triangle wins!",
    ],
    badge: "2–4 Players",
    emoji: "🎲",
    gradient: "from-rose-600/30 via-amber-900/20 to-slate-950 border-rose-500/40",
  },
  {
    id: "dame",
    name: "Ghana Dame",
    shortTitle: "Ghana Dame",
    categoryTag: "STRATEGY",
    statusTag: "ONLINE",
    statusColor: "gold",
    subtitle: "8×8 Ghanaian checkers with mandatory jump captures and crowned Kings.",
    rulesSummary: [
      "Tap one of your pieces, then tap a highlighted diagonal square to move.",
      "Mandatory Capture Rule: if a jump over an opponent piece is available, you must take it.",
      "Reach the opponent's back row to crown your piece into a King that moves forward and backward.",
      "Capture all 12 opponent pieces or block all their legal moves to win!",
    ],
    badge: "Pure Skill",
    emoji: "♟️",
    gradient: "from-emerald-600/30 via-teal-900/20 to-slate-950 border-emerald-500/40",
  },
  {
    id: "candy",
    name: "Candy Crash (Alewa & Kube)",
    shortTitle: "Candy Crash",
    categoryTag: "GHANA SWEETS",
    statusTag: "NEW",
    statusColor: "gold",
    subtitle: "Match 3+ Ghanaian Alewa, Kube & Golden Cocoa Pods — forge Kente Boosters & Calabash Bombs.",
    rulesSummary: [
      "Swipe or tap two adjacent Ghanaian sweets (Alewa, Kube, Cocoa Pod, Nkate Cake, Sobolo, Bofrot) on the 8×8 wooden tray.",
      "Match 4 sweets to wrap a Red-Gold-Green Kente-Striped Booster that blasts an entire row or column.",
      "Match 5 sweets to forge a Takoradi Calabash Cocoa Bomb that wipes out every sweet of that type.",
      "Outscore Auntie Efua across 10 Ghana Markets (Makola, Osu, Kejetia) to earn up to 3 Stars and Free Data!",
    ],
    badge: "Alewa & Kube",
    emoji: "🍬",
    gradient: "from-amber-600/35 via-rose-900/25 to-slate-950 border-amber-500/45",
  },
  {
    id: "buggy",
    name: "Labadi Beach & Aburi Buggy GP",
    shortTitle: "Labadi Buggy GP",
    categoryTag: "GHANA RACING",
    statusTag: "NEW 3D",
    statusColor: "gold",
    subtitle:
      "Race 3 laps across Labadi Beach, Aburi Hills & Tema Motorway — hit Kente Boost Pads & upgrade at Suame Garage.",
    rulesSummary: [
      "Choose from 4 Ghanaian rides (Labadi Sand Buggy, Yellow-Yellow Pragya, VIP Sprinter Trotro, or Kantanka 4×4) and 3 circuits.",
      "Hit glowing yellow Kente Boost Pads and tap Shito Nitro (N₂) to blast past Kwame Turbo and the 6-racer pack.",
      "Dodge volcanic rocks, coconut palms, and beach huts so your Armor HP never hits 0 before finishing 3 laps.",
      "Collect spinning Gold Ghana Cedi Coins (GH₵) to upgrade your Engine, Nitro & Armor at the Suame Magazine Workshop!",
    ],
    badge: "Suame Turbo",
    emoji: "🏎️",
    gradient: "from-red-600/35 via-amber-900/25 to-slate-950 border-red-500/45",
  },
];

const QUICK_STAKES = [2, 5, 10, 20, 50];

function getInitialBoardForGame(gameType: GameType) {
  if (gameType === "buggy") return INITIAL_BUGGY_STATE;
  if (gameType === "candy") return INITIAL_CANDY_STATE;
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
  const navigate = useNavigate();
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

  // Create / Launch challenge form state
  const [selectedGame, setSelectedGame] = useState<GameType>("oware");
  const [selectedMode, setSelectedMode] = useState<ChallengeMode>("free_data");
  const [paymentSource, setPaymentSource] = useState<PaymentSource>("wallet");
  const [stakeAmount, setStakeAmount] = useState<string>("5");
  const [playerName, setPlayerName] = useState<string>("");
  const [playerPhone, setPlayerPhone] = useState<string>("");
  const [playerAvatarId, setPlayerAvatarId] = useState<string>(() => {
    try {
      return localStorage.getItem("swiftdata_gamer_avatar_id") || "royal_headband";
    } catch {
      return "royal_headband";
    }
  });
  const handleSelectGamerAvatar = useCallback((nextAvatarId: string) => {
    setPlayerAvatarId(nextAvatarId);
    try {
      localStorage.setItem("swiftdata_gamer_avatar_id", nextAvatarId);
    } catch {
      // ignore storage errors
    }
  }, []);
  const [rewardType] = useState<"wallet_cash" | "data_bundle">("wallet_cash");
  const [rewardNetwork] = useState<string>("MTN");

  // Modals & Left-Corner Profile / Settings / Help Drawer state
  const screenFit = useDeviceScreenFit();
  const [topHudCollapsed, setTopHudCollapsed] = useState<boolean>(false);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState<boolean>(false);
  const [profileDrawerTab, setProfileDrawerTab] = useState<ProfileDrawerTab>("profile");
  const [communityModalOpen, setCommunityModalOpen] = useState<boolean>(false);
  const [communityModalTab, setCommunityModalTab] = useState<"chat" | "dms" | "gamers" | "room">("chat");
  const [initialDmPartner, setInitialDmPartner] = useState<any | null>(null);
  const [launchModalOpen, setLaunchModalOpen] = useState<boolean>(false);
  const [roomCodeInput, setRoomCodeInput] = useState<string>("");
  const [soundEnabled, setSoundEnabled] = useState<boolean>(
    () => getGameSensoryPreferences().soundEnabled
  );
  const [vibrationEnabled, setVibrationEnabled] = useState<boolean>(
    () => getGameSensoryPreferences().vibrationEnabled
  );

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

  // Level & Target Data Bundle Accumulation State
  const [arenaPoints, setArenaPoints] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem("swiftdata_arena_points_v1"));
      return Number.isFinite(saved) && saved >= 0 ? saved : 120;
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

  const [filterGame, setFilterGame] = useState<string>("all");
  const [joiningChallengeId, setJoiningChallengeId] = useState<string | null>(null);
  const [instructionModalOpen, setInstructionModalOpen] = useState<boolean>(false);
  const [nudgingTurn, setNudgingTurn] = useState<boolean>(false);
  const [turnNotificationBanner, setTurnNotificationBanner] = useState<{
    isMyTurn: boolean;
    nextPlayerName: string;
    title: string;
    subtitle: string;
  } | null>(null);

  // Trigger overall match turn notification (Sound Chime + Haptic + Visual Banner + Browser Notification)
  const triggerOverallTurnNotification = useCallback(
    (challengeObj: any, nextTurnSide: string, boardState?: any) => {
      if (!challengeObj || challengeObj.status !== "in_progress") return;
      const bState = boardState || challengeObj.board_state || {};
      if (bState.winner) return;

      const isNowMyTurn = nextTurnSide === mySide;
      const gType = (challengeObj.game_type || "pool") as GameType;
      const activeLudoColor = bState.currentPlayerColor;
      const activeLudoSeat =
        activeLudoColor && bState.players?.[activeLudoColor]
          ? bState.players[activeLudoColor]
          : null;

      const nextPlayerName =
        activeLudoSeat?.name ||
        (nextTurnSide === "creator"
          ? challengeObj.creator_name || "Player 1"
          : challengeObj.opponent_name ||
            HUMAN_CHALLENGER_PERSONAS[gType]?.name ||
            "Challenger");

      playTurnNotificationSound(isNowMyTurn);

      const title = isNowMyTurn
        ? `🟢 YOUR TURN TO PLAY, ${nextPlayerName.toUpperCase()}!`
        : `🔔 NEXT PLAYER'S TURN: ${nextPlayerName.toUpperCase()}`;

      const subtitle =
        bState.lastAction ||
        bState.lastMove?.summary ||
        (typeof bState.lastMove === "string" ? bState.lastMove : "") ||
        (isNowMyTurn
          ? "Step up to the board and make your move now!"
          : `Waiting for ${nextPlayerName} to complete their turn...`);

      setTurnNotificationBanner({
        isMyTurn: isNowMyTurn,
        nextPlayerName,
        title,
        subtitle,
      });

      if (
        isNowMyTurn &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted" &&
        document.visibilityState !== "visible"
      ) {
        try {
          new Notification(`🟢 Your Turn in ${gType.toUpperCase()} (#${challengeObj.room_code})`, {
            body: subtitle,
            icon: "/favicon.ico",
            tag: `turn-${challengeObj.room_code}`,
          });
        } catch {
          // ignore notification error
        }
      }
    },
    [mySide]
  );

  useEffect(() => {
    if (!turnNotificationBanner) return;
    const t = setTimeout(() => setTurnNotificationBanner(null), 4200);
    return () => clearTimeout(t);
  }, [turnNotificationBanner]);

  // Lock page scrolling & rubber-banding whenever an active game board is open
  useEffect(() => {
    const prevBodyOverscroll = document.body.style.overscrollBehavior;
    const prevHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overscrollBehavior = "none";

    if (activeChallenge) {
      const prevBodyOverflow = document.body.style.overflow;
      const prevHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
      document.body.setAttribute("data-full-game-mode", "true");
      window.scrollTo(0, 0);

      return () => {
        document.body.style.overflow = prevBodyOverflow;
        document.documentElement.style.overflow = prevHtmlOverflow;
        document.body.style.overscrollBehavior = prevBodyOverscroll;
        document.documentElement.style.overscrollBehavior = prevHtmlOverscroll;
        document.body.removeAttribute("data-full-game-mode");
      };
    }

    return () => {
      document.body.style.overscrollBehavior = prevBodyOverscroll;
      document.documentElement.style.overscrollBehavior = prevHtmlOverscroll;
    };
  }, [activeChallenge]);

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
            description: `You reached ${nextTotal.toLocaleString()} Arena Points! Keep playing toward your ${targetDataSize} Free Data Bundle!`,
          });
        }
        return nextTotal;
      });
      setLastPointsPopup({ pts, reason });
      window.setTimeout(() => setLastPointsPopup(null), 2600);
    },
    [targetDataSize, toast]
  );

  const handleRedeemPointsBundle = async () => {
    if (!canRedeemTargetBundle) return;
    const cleanPhone = (claimPhone || playerPhone || profile?.phone || "").replace(/\D/g, "");
    if (cleanPhone.length < 9) {
      toast({
        title: "Enter Valid Recipient Phone",
        description: "Please enter a 10-digit Ghana phone number (e.g. 0241234567) to receive your Free Data Bundle.",
        variant: "destructive",
      });
      return;
    }

    setClaimingPointsBundle(true);
    try {
      const { data, error } = await supabase.functions.invoke("challenge-arena", {
        body: {
          action: "redeem_points_bundle",
          phone: cleanPhone,
          network: claimNetwork,
          data_size: selectedTargetOption.size,
          points_spent: selectedTargetOption.pointsRequired,
          player_name: playerName || profile?.full_name || "Arena Champion",
        },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Could not redeem data bundle");
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
  }, [user]);

  const [myJoinedSides, setMyJoinedSides] = useState<Record<string, "creator" | "opponent">>(() => {
    try {
      const saved = window.localStorage.getItem("swiftdata_arena_my_sides_v1");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const recordMyChallengeSide = useCallback((challengeId: string, side: "creator" | "opponent") => {
    if (!challengeId) return;
    setMyJoinedSides((prev) => {
      const next = { ...prev, [challengeId]: side };
      try {
        window.localStorage.setItem("swiftdata_arena_my_sides_v1", JSON.stringify(next));
      } catch {
        // ignore storage error
      }
      return next;
    });
  }, []);

  const resolveMySideForChallenge = useCallback(
    (chal: any): "creator" | "opponent" | null => {
      if (!chal) return null;
      if (myJoinedSides[chal.id]) return myJoinedSides[chal.id];
      if (user?.id && chal.creator_id === user.id) return "creator";
      if (user?.id && chal.opponent_id === user.id) return "opponent";
      const cleanMyPhone = String(playerPhone || profile?.phone || "").replace(/\D/g, "").slice(-9);
      if (cleanMyPhone.length >= 9) {
        const cleanCreatorPhone = String(chal.creator_phone || "").replace(/\D/g, "").slice(-9);
        const cleanOpponentPhone = String(chal.opponent_phone || "").replace(/\D/g, "").slice(-9);
        if (cleanCreatorPhone === cleanMyPhone) return "creator";
        if (cleanOpponentPhone === cleanMyPhone) return "opponent";
      }
      return null;
    },
    [myJoinedSides, user?.id, playerPhone, profile?.phone]
  );

  const fetchLobby = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("challenge-arena", {
        body: { action: "get_lobby" },
      });
      if (!error && data?.success) {
        if (data.settings) setSettings(data.settings);
        if (Array.isArray(data.challenges)) {
          setChallenges(data.challenges);
          setActiveChallenge((curr: any) => {
            if (!curr) return curr;
            const fresh = data.challenges.find((c: any) => c.id === curr.id);
            if (!fresh) return curr;
            const currMoves =
              Number(curr.board_state?.shotCount || 0) +
              Number(curr.board_state?.moveCount || 0) +
              Number(curr.board_state?.engine?.moveCount || 0);
            const freshMoves =
              Number(fresh.board_state?.shotCount || 0) +
              Number(fresh.board_state?.moveCount || 0) +
              Number(fresh.board_state?.engine?.moveCount || 0);
            if (
              fresh.status !== curr.status ||
              freshMoves > currMoves ||
              (freshMoves === currMoves && fresh.current_turn !== curr.current_turn)
            ) {
              return fresh;
            }
            return curr;
          });
        }
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

    const detectedSide = resolveMySideForChallenge(matched);
    if (detectedSide) {
      setMySide(detectedSide);
      setActiveChallenge(matched);
    } else if (matched.status === "in_progress") {
      const fallbackSide = user?.id && matched.creator_id === user.id ? "creator" : "opponent";
      setMySide(fallbackSide);
      setActiveChallenge(matched);
    }
  }, [roomQueryParam, challenges, activeChallenge, resolveMySideForChallenge, user?.id]);

  // Background polling fallback while inside a live P2P challenge room
  useEffect(() => {
    if (
      !activeChallenge ||
      activeChallenge.mode !== "p2p" ||
      (activeChallenge.status !== "open" && activeChallenge.status !== "in_progress")
    ) {
      return;
    }
    const pollTimer = window.setInterval(() => {
      fetchLobby(true);
    }, 3500);
    return () => window.clearInterval(pollTimer);
  }, [activeChallenge, fetchLobby]);

  // Realtime subscription to game_challenges for live 1v1 moves & open challenge board
  useEffect(() => {
    const uid = `${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`challenge_arena_live_${uid}`)
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
              if (curr.status === "open" && updated.status === "in_progress" && updated.opponent_name) {
                playSuccessSound();
                toast({
                  title: `🔥 ${updated.opponent_name} Accepted Your Challenge!`,
                  description: `Room #${updated.room_code} is now LIVE! Make your opening move!`,
                });
              }

              const prevTurn = curr.current_turn || curr.board_state?.turn || "creator";
              const nextTurn = updated.current_turn || updated.board_state?.turn || "creator";
              const prevColor = curr.board_state?.currentPlayerColor;
              const nextColor = updated.board_state?.currentPlayerColor;
              if (
                updated.status === "in_progress" &&
                !updated.board_state?.winner &&
                (prevTurn !== nextTurn || (prevColor && nextColor && prevColor !== nextColor))
              ) {
                triggerOverallTurnNotification(updated, nextTurn, updated.board_state);
              }
              return updated;
            }
            return curr;
          });

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
              ).toUpperCase()} challenge!`,
            });
          }
        }
      )
      .subscribe();
    } catch {
      // ignore realtime channel collision
    }

    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {
          // ignore cleanup warning
        }
      }
    };
  }, [activeChallenge, toast, triggerOverallTurnNotification]);

  const loadPaystackInline = (): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (window.PaystackPop) return resolve(window.PaystackPop);
      const script = document.createElement("script");
      script.src = "https://js.paystack.co/v1/inline.js";
      script.async = true;
      script.onload = () => resolve(window.PaystackPop);
      script.onerror = () => reject(new Error("Could not load Paystack checkout"));
      document.body.appendChild(script);
    });
  };

  const triggerMoMoStakeCheckout = async (amountGhs: number): Promise<string> => {
    if (!paystackPublicKey) {
      throw new Error("Paystack public key is not configured yet.");
    }
    const PaystackPop = await loadPaystackInline();
    const ref = `CHAL_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    return new Promise((resolve, reject) => {
      const handler = PaystackPop.setup({
        key: paystackPublicKey,
        email: user?.email || `${(playerPhone || "0240000000").replace(/\D/g, "")}@swiftdatagh.shop`,
        amount: Math.round(amountGhs * 100),
        currency: "GHS",
        ref,
        channels: ["mobile_money", "card"],
        callback: (response: any) => {
          resolve(response.reference || ref);
        },
        onClose: () => {
          reject(new Error("MoMo payment cancelled"));
        },
      });
      handler.openIframe();
    });
  };

  const startChallengeWithConfig = async (
    gameToStart: GameType = selectedGame,
    modeToStart: ChallengeMode = selectedMode
  ) => {
    const stake = modeToStart === "free_data" ? 0 : Number(stakeAmount || 0);
    if (modeToStart !== "free_data" && (isNaN(stake) || stake < Number(settings.min_stake_ghs || 2))) {
      toast({
        title: "Minimum Stake Required",
        description: `Minimum stake is GH₵ ${Number(settings.min_stake_ghs || 2).toFixed(2)}`,
        variant: "destructive",
      });
      return;
    }

    if (modeToStart !== "free_data" && paymentSource === "wallet" && !user) {
      toast({
        title: "Sign in for Wallet Stake, or Choose MoMo",
        description: "Guests can stake directly with Mobile Money (MoMo) or play Free Data mode!",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      let paystackRef: string | undefined;
      if (modeToStart !== "free_data" && stake > 0 && paymentSource === "momo") {
        paystackRef = await triggerMoMoStakeCheckout(stake);
      }

      const initialBoard = getInitialBoardForGame(gameToStart);
      const { data, error } = await supabase.functions.invoke("challenge-arena", {
        body: {
          action: "create_challenge",
          game_type: gameToStart,
          mode: modeToStart,
          stake_amount: stake,
          payment_source: modeToStart === "free_data" ? "free" : paymentSource,
          paystack_reference: paystackRef,
          creator_name: (playerName || profile?.full_name || "Ghana Champion").trim(),
          creator_phone: playerPhone || profile?.phone || "",
          reward_type: modeToStart === "free_data" ? "data_bundle" : rewardType,
          reward_network: rewardNetwork,
          board_state: initialBoard,
          invited_phone: selectedInvitedUser?.phone || invitedPhone.trim() || undefined,
          invited_user_id: selectedInvitedUser?.user_id || undefined,
          invited_name: selectedInvitedUser?.full_name || undefined,
          player_level: levelInfo.level,
          player_title: levelInfo.title,
          notify_all_users: modeToStart === "p2p",
        },
      });

      if (error || !data?.success) {
        // Seamless instant fallback for free_data mode if edge function schema is still updating
        if (modeToStart === "free_data") {
          const persona = HUMAN_CHALLENGER_PERSONAS[gameToStart] || HUMAN_CHALLENGER_PERSONAS.oware;
          const localChallenge = {
            id: `local_${Date.now()}`,
            room_code: Math.random().toString(36).slice(2, 8).toUpperCase(),
            game_type: gameToStart,
            mode: "free_data",
            status: "in_progress",
            creator_name: (playerName || profile?.full_name || "Ghana Champion").trim(),
            opponent_name: `${persona.name} (${persona.humanSensePercent}% Human Sense)`,
            stake_amount: 0,
            prize_pool: 0,
            reward_type: "data_bundle",
            reward_network: rewardNetwork,
            reward_data_size: settings.free_data_package_size || "1GB",
            board_state: initialBoard,
            current_turn: "creator",
          };
          playSuccessSound();
          setLaunchModalOpen(false);
          setProfileDrawerOpen(false);
          setMySide("creator");
          setActiveChallenge(localChallenge);
          return;
        }
        throw new Error(data?.error || error?.message || "Failed to create challenge");
      }

      playSuccessSound();
      setLaunchModalOpen(false);
      setProfileDrawerOpen(false);
      recordMyChallengeSide(data.challenge.id, "creator");
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

  const handleCreateChallenge = () => startChallengeWithConfig(selectedGame, selectedMode);

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

      const joinedChallenge = { ...data.challenge };
      const joinedBoard =
        joinedChallenge.board_state && typeof joinedChallenge.board_state === "object"
          ? { ...joinedChallenge.board_state }
          : {};
      const hasMovesAlready =
        Number(joinedBoard.moveCount || 0) > 0 ||
        Number(joinedBoard.shotCount || 0) > 0 ||
        Number(joinedBoard.engine?.moveCount || 0) > 0;

      if (!hasMovesAlready) {
        joinedChallenge.current_turn = "opponent";
        joinedBoard.turn = "opponent";
        if (joinedBoard.engine && typeof joinedBoard.engine === "object") {
          const eng = { ...joinedBoard.engine };
          const playersArr = Array.isArray(eng.players) ? eng.players : ["RED", "YELLOW"];
          eng.currentPlayer = "YELLOW";
          eng.currentPlayerIndex = Math.max(0, playersArr.indexOf("YELLOW"));
          joinedBoard.engine = eng;
        }
        joinedChallenge.board_state = joinedBoard;
      }

      setLaunchModalOpen(false);
      setProfileDrawerOpen(false);
      recordMyChallengeSide(joinedChallenge.id, "opponent");
      setMySide("opponent");
      setActiveChallenge(joinedChallenge);
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

  const handleJoinByRoomCode = (overrideCode?: string) => {
    const code = (typeof overrideCode === "string" ? overrideCode : roomCodeInput)
      .trim()
      .toUpperCase()
      .replace(/^#/, "");
    if (!code) return;
    const found = challenges.find((c) => String(c.room_code || "").toUpperCase() === code);
    if (!found) {
      toast({
        title: "Room Not Found",
        description: `No active room found with code #${code}. Try refreshing the lobby.`,
        variant: "destructive",
      });
      return;
    }
    setCommunityModalOpen(false);
    const myDetectedSide = resolveMySideForChallenge(found);
    if (found.status === "in_progress" || myDetectedSide === "creator") {
      const side = myDetectedSide || "opponent";
      recordMyChallengeSide(found.id, side);
      setMySide(side);
      setActiveChallenge(found);
      setProfileDrawerOpen(false);
      setLaunchModalOpen(false);
      return;
    }
    if (found.status === "open") {
      handleJoinChallenge(found, user ? "wallet" : "momo");
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
      if (activeChallenge?.id === challengeId) setActiveChallenge(null);
      fetchWalletAndPaystackKey();
      fetchLobby(true);
    } catch (err: any) {
      toast({ title: "Cancel Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleBoardStateChange = useCallback(
    async (nextState: any) => {
      if (!activeChallenge) return;
      const prevTurn =
        activeChallenge.current_turn || activeChallenge.board_state?.turn || "creator";
      const nextTurn = nextState.turn || "creator";
      const prevColor = activeChallenge.board_state?.currentPlayerColor;
      const nextColor = nextState.currentPlayerColor;

      if (
        !nextState.winner &&
        (prevTurn !== nextTurn || (prevColor && nextColor && prevColor !== nextColor))
      ) {
        triggerOverallTurnNotification(activeChallenge, nextTurn, nextState);
      }

      setActiveChallenge((prev: any) =>
        prev ? { ...prev, board_state: nextState, current_turn: nextTurn } : prev
      );
      if (activeChallenge.mode === "p2p") {
        await supabase.functions.invoke("challenge-arena", {
          body: {
            action: "sync_board",
            challenge_id: activeChallenge.id,
            board_state: nextState,
            current_turn: nextTurn,
          },
        });
      }
    },
    [activeChallenge, triggerOverallTurnNotification]
  );

  const handleNudgeNextPlayer = async () => {
    if (!activeChallenge) return;
    setNudgingTurn(true);
    try {
      const currentTurnSide =
        activeChallenge.current_turn || activeChallenge.board_state?.turn || "creator";
      const nextName =
        currentTurnSide === "creator"
          ? activeChallenge.creator_name || "Player 1"
          : activeChallenge.opponent_name || "Opponent";

      await supabase.functions.invoke("challenge-arena", {
        body: {
          action: "sync_board",
          challenge_id: activeChallenge.id,
          board_state: activeChallenge.board_state || {},
          current_turn: currentTurnSide,
          notify_turn: true,
        },
      });
      playTurnNotificationSound(false);
      toast({
        title: `🔔 Next Player Notified (${nextName})!`,
        description: `Sent an instant In-App, Web Push & SMS turn alert for Room #${activeChallenge.room_code}!`,
      });
    } catch (err: any) {
      toast({
        title: "Could Not Send Turn Alert",
        description: err.message || "Try again in a moment",
        variant: "destructive",
      });
    } finally {
      setNudgingTurn(false);
    }
  };

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
  const activeInProgressChallenges = challenges.filter((c) => {
    if (c.status !== "in_progress") return false;
    if (filterGame !== "all" && c.game_type !== filterGame) return false;
    const myRole = resolveMySideForChallenge(c);
    return Boolean(myRole) || c.mode === "p2p";
  });
  const invitedSpotlightChallenge = roomQueryParam
    ? challenges.find(
        (c) =>
          String(c.room_code || "").toUpperCase() === roomQueryParam &&
          (c.status === "open" || c.status === "in_progress")
      )
    : null;
  const remainingFreeDataToday = Math.max(
    0,
    Number(settings.daily_free_data_limit || 15) - todayFreeDataCount
  );

  const displayFirstName =
    (playerName || profile?.full_name || "Player").trim().split(" ")[0] || "Player";
  const selectedGameMeta =
    GAME_CATALOG.find((g) => g.id === selectedGame) || GAME_CATALOG[0];

  const openLaunchSheetForGame = (gId: GameType, defaultMode: ChallengeMode = "free_data") => {
    setSelectedGame(gId);
    setSelectedMode(defaultMode);
    setLaunchModalOpen(true);
  };

  return (
    <div
      style={
        activeChallenge
          ? {
              width: `${screenFit.availWidth}px`,
              height: `${screenFit.availHeight}px`,
            }
          : undefined
      }
      className={
        activeChallenge
          ? "fixed top-0 left-0 z-[85] bg-[#070b14] flex flex-col overflow-hidden overscroll-none select-none"
          : "min-h-[100dvh] w-full bg-gradient-to-b from-[#0b111e] via-[#090e1a] to-[#050811] text-white overscroll-none"
      }
    >
      {/* ── On-Select Game Instruction Modal (Skip or Follow 4 Steps) ── */}
      <GameInstructionPromptModal
        gameType={selectedGame}
        open={instructionModalOpen}
        onSkip={() => setInstructionModalOpen(false)}
        onStartGame={() => setInstructionModalOpen(false)}
      />

      {/* ── TOP-LEFT GAMER PROFILE, SETTINGS, ONLINE ROOMS & HELP DRAWER ── */}
      {profileDrawerOpen && (
        <div className="fixed inset-0 z-[120] flex">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setProfileDrawerOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md bg-[#0c1322] border-r border-white/10 h-[100dvh] flex flex-col shadow-2xl animate-in slide-in-from-left duration-200">
            {/* Drawer Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-[#0f172a]">
              <div className="flex items-center gap-3">
                <VerifiedGamerAvatar
                  avatarId={playerAvatarId}
                  seedName={displayFirstName}
                  size={48}
                  showVerifiedBadge={true}
                  glow={true}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-black text-white">{displayFirstName}</p>
                    <Badge className="bg-amber-500/20 text-amber-300 border border-amber-400/40 text-[10px] font-black">
                      Lv.{levelInfo.level} • {levelInfo.title}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400 font-mono">
                    ⚡ {arenaPoints.toLocaleString()} Pts • {targetProgressPercent}% to{" "}
                    {selectedTargetOption.size}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProfileDrawerOpen(false)}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Banner to Open the Full Gamer Chat & Community Hub */}
            <div className="px-3 pt-2 bg-[#090e1a]">
              <button
                type="button"
                onClick={() => {
                  setProfileDrawerOpen(false);
                  setCommunityModalTab(activeChallenge ? "room" : "chat");
                  setCommunityModalOpen(true);
                }}
                className="w-full py-2.5 px-3 rounded-2xl bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-emerald-500/20 hover:from-amber-500/30 hover:to-emerald-500/30 border border-amber-400/50 flex items-center justify-between text-xs font-black text-white cursor-pointer shadow"
              >
                <span className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-amber-400" />
                  <span>Open Gamer Chat &amp; Community Hub</span>
                </span>
                <Badge className="bg-emerald-500 text-slate-950 font-black text-[9px]">
                  LIVE
                </Badge>
              </button>
            </div>

            {/* Drawer Navigation Tabs */}
            <div className="grid grid-cols-4 gap-1 p-2 bg-[#090e1a] border-b border-white/10">
              {(
                [
                  { id: "profile", label: "Profile", icon: User },
                  { id: "rooms", label: "Online", icon: Users },
                  { id: "settings", label: "Settings", icon: Settings },
                  { id: "help", label: "Help", icon: HelpCircle },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = profileDrawerTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setProfileDrawerTab(tab.id)}
                    className={`py-2 px-2 rounded-xl text-[11px] font-black flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      active
                        ? "bg-amber-500 text-slate-950 shadow"
                        : "text-slate-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {profileDrawerTab === "profile" && (
                <>
                  {/* Wallet & Points Summary */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10">
                      <p className="text-[10px] font-bold uppercase text-slate-400">Wallet Float</p>
                      <p className="text-lg font-black text-emerald-400 font-mono mt-0.5">
                        GH₵ {walletBalance.toFixed(2)}
                      </p>
                      {user && (
                        <button
                          type="button"
                          onClick={() => navigate("/dashboard/wallet")}
                          className="text-[10px] font-bold text-amber-300 hover:underline mt-1 inline-block"
                        >
                          + Top up wallet →
                        </button>
                      )}
                    </div>
                    <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10">
                      <p className="text-[10px] font-bold uppercase text-slate-400">Free Data Left</p>
                      <p className="text-lg font-black text-amber-300 font-mono mt-0.5">
                        🎁 {remainingFreeDataToday} Today
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1">Daily skill rewards</p>
                    </div>
                  </div>

                  {/* Player Identity & 4x5 Glossy Avatar Picker Grid */}
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3.5">
                    <GamerAvatarPickerGrid
                      selectedAvatarId={playerAvatarId}
                      onSelectAvatar={handleSelectGamerAvatar}
                    />
                    <p className="text-xs font-black uppercase tracking-wider text-amber-300 pt-1">
                      Gamer Identity &amp; SMS Alert Number
                    </p>
                    <div className="space-y-2">
                      <div>
                        <Label className="text-[11px] text-slate-400">Display Name</Label>
                        <Input
                          placeholder="e.g. Kofi Oware"
                          value={playerName}
                          onChange={(e) => setPlayerName(e.target.value)}
                          className="h-9 rounded-xl bg-slate-950 border-white/15 text-xs text-white mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-[11px] text-slate-400">
                          Ghana Phone (For Turn Alerts &amp; Free Data)
                        </Label>
                        <Input
                          placeholder="0241234567"
                          value={playerPhone}
                          onChange={(e) => {
                            setPlayerPhone(e.target.value);
                            setClaimPhone(e.target.value);
                          }}
                          className="h-9 rounded-xl bg-slate-950 border-white/15 text-xs font-mono text-white mt-1"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Free Data Target Goal & Progress */}
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 via-slate-900 to-emerald-500/10 border border-amber-500/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-amber-300 flex items-center gap-1.5">
                        <Gift className="w-4 h-4" /> Target Free Data Goal
                      </span>
                      <span className="text-xs font-mono font-black text-white">
                        {arenaPoints.toLocaleString()} /{" "}
                        {selectedTargetOption.pointsRequired.toLocaleString()} Pts
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      {DATA_TARGET_CATALOG.map((tier) => {
                        const active = targetDataSize === tier.size;
                        return (
                          <button
                            key={tier.size}
                            type="button"
                            onClick={() => handleSelectTargetData(tier.size)}
                            className={`py-2 px-2 rounded-xl text-xs font-black border transition-all cursor-pointer ${
                              active
                                ? "bg-amber-500 text-slate-950 border-amber-400 shadow"
                                : "bg-slate-950 border-white/10 text-slate-300 hover:text-white"
                            }`}
                          >
                            🎁 {tier.size}
                          </button>
                        );
                      })}
                    </div>

                    <div className="w-full h-3 rounded-full bg-slate-950 border border-white/15 overflow-hidden p-0.5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-all duration-500"
                        style={{ width: `${targetProgressPercent}%` }}
                      />
                    </div>

                    {canRedeemTargetBundle ? (
                      <div className="space-y-2 pt-1">
                        <p className="text-xs font-black text-emerald-300">
                          🎉 Goal Reached! Claim your {selectedTargetOption.size} bundle now:
                        </p>
                        <div className="flex gap-2">
                          <select
                            value={claimNetwork}
                            onChange={(e) => setClaimNetwork(e.target.value)}
                            className="h-9 rounded-xl bg-slate-950 border border-emerald-500/40 px-2.5 text-xs font-bold text-white"
                          >
                            <option value="MTN">MTN</option>
                            <option value="TELECEL">Telecel</option>
                            <option value="AT">AirtelTigo</option>
                          </select>
                          <Input
                            placeholder="0241234567"
                            value={claimPhone}
                            onChange={(e) => setClaimPhone(e.target.value)}
                            className="h-9 flex-1 rounded-xl bg-slate-950 border-emerald-500/40 text-xs font-mono text-white"
                          />
                        </div>
                        <Button
                          type="button"
                          disabled={claimingPointsBundle}
                          onClick={handleRedeemPointsBundle}
                          className="w-full h-9 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs"
                        >
                          {claimingPointsBundle ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                          ) : (
                            <Gift className="w-4 h-4 mr-1" />
                          )}
                          Redeem {selectedTargetOption.size} Free Data
                        </Button>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-300">
                        Win matches &amp; score combos to earn{" "}
                        <strong className="text-amber-300">
                          {(selectedTargetOption.pointsRequired - arenaPoints).toLocaleString()} more
                          points
                        </strong>{" "}
                        for instant {selectedTargetOption.size} data redemption.
                      </p>
                    )}
                  </div>

                  {/* Recent Champions */}
                  {recentClaims.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <Crown className="w-3.5 h-3.5 text-amber-400" /> Recent Winners
                      </p>
                      <div className="space-y-1.5">
                        {recentClaims.slice(0, 5).map((c) => (
                          <div
                            key={c.id}
                            className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-xs"
                          >
                            <span className="font-bold text-white truncate max-w-[170px]">
                              {c.winner_name}
                            </span>
                            <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-[10px]">
                              {c.reward_type === "wallet_cash"
                                ? `+GH₵ ${Number(c.cash_amount || 0).toFixed(2)}`
                                : `🎁 ${c.network} ${c.data_package_size || "1GB"}`}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {profileDrawerTab === "rooms" && (
                <>
                  {/* Join by Room Code */}
                  <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 space-y-2.5">
                    <p className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                      <Hash className="w-3.5 h-3.5" /> Enter Friend&apos;s Room Code
                    </p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="e.g. 8F2K9A"
                        value={roomCodeInput}
                        onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                        className="h-10 rounded-xl bg-slate-950 border-white/15 font-mono font-bold text-white uppercase"
                      />
                      <Button
                        type="button"
                        onClick={handleJoinByRoomCode}
                        className="h-10 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs px-4 shrink-0"
                      >
                        Join Room
                      </Button>
                    </div>
                  </div>

                  {/* Active / Accepted Matches */}
                  {activeInProgressChallenges.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-black uppercase tracking-wider text-emerald-400">
                        🟢 Live Matches In Progress ({activeInProgressChallenges.length})
                      </p>
                      {activeInProgressChallenges.map((chal) => {
                        const detectedRole = resolveMySideForChallenge(chal);
                        const effectiveSide: "creator" | "opponent" =
                          detectedRole ||
                          (user?.id && chal.creator_id === user.id ? "creator" : "opponent");
                        return (
                          <div
                            key={chal.id}
                            className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 flex items-center justify-between gap-2"
                          >
                            <div>
                              <p className="text-xs font-black text-white uppercase">
                                {chal.game_type} • #{chal.room_code}
                              </p>
                              <p className="text-[11px] text-slate-300">
                                {chal.creator_name} vs {chal.opponent_name || "Challenger"}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => {
                                recordMyChallengeSide(chal.id, effectiveSide);
                                setMySide(effectiveSide);
                                setActiveChallenge(chal);
                                setProfileDrawerOpen(false);
                              }}
                              className="h-8 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-xs"
                            >
                              Resume →
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Open Challenges Waiting */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-black uppercase tracking-wider text-slate-300">
                        Open Friend Challenges ({openChallenges.length})
                      </p>
                      <button
                        type="button"
                        onClick={() => fetchLobby()}
                        className="text-[11px] font-bold text-amber-300 flex items-center gap-1"
                      >
                        <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                      </button>
                    </div>

                    {openChallenges.length === 0 ? (
                      <div className="p-5 rounded-2xl border border-dashed border-white/10 text-center space-y-2">
                        <p className="text-xs text-slate-400">
                          No open friend rooms waiting right now.
                        </p>
                        <Button
                          size="sm"
                          onClick={() => {
                            setProfileDrawerOpen(false);
                            openLaunchSheetForGame("oware", "p2p");
                          }}
                          className="h-8 rounded-xl bg-amber-500 text-slate-950 font-black text-xs"
                        >
                          + Create Online Room
                        </Button>
                      </div>
                    ) : (
                      openChallenges.map((chal) => {
                        const isMine = user && chal.creator_id === user.id;
                        const stake = Number(chal.stake_amount || 0);
                        return (
                          <div
                            key={chal.id}
                            className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <Badge className="bg-amber-500 text-slate-950 font-black text-[10px] uppercase">
                                {chal.game_type} • #{chal.room_code}
                              </Badge>
                              <span className="text-xs font-mono font-bold text-emerald-400">
                                Pot: GH₵ {Number(chal.prize_pool || 0).toFixed(2)}
                              </span>
                            </div>
                            <p className="text-xs font-bold text-white">
                              Host: {chal.creator_name} (Stake: GH₵ {stake.toFixed(2)})
                            </p>
                            <div className="flex gap-2">
                              {isMine ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setMySide("creator");
                                      setActiveChallenge(chal);
                                      setProfileDrawerOpen(false);
                                    }}
                                    className="h-8 flex-1 rounded-xl border-amber-400/40 text-amber-300 text-xs font-bold"
                                  >
                                    Open Room
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleCancelOpenChallenge(chal.id)}
                                    className="h-8 text-rose-400 text-xs font-bold"
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
                                      className="h-8 flex-1 rounded-xl bg-emerald-500 text-slate-950 font-black text-xs"
                                    >
                                      Accept (Wallet)
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={joiningChallengeId === chal.id}
                                    onClick={() => handleJoinChallenge(chal, "momo")}
                                    className="h-8 flex-1 rounded-xl border-amber-500/40 text-amber-300 font-black text-xs"
                                  >
                                    Accept (MoMo)
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}

              {profileDrawerTab === "settings" && (
                <div className="space-y-3">
                  <p className="text-xs font-black uppercase tracking-wider text-amber-300">
                    Audio, Haptics &amp; Sensor Controls
                  </p>

                  {/* Sound Toggle */}
                  <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400">
                        {soundEnabled ? (
                          <Volume2 className="w-5 h-5" />
                        ) : (
                          <VolumeX className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-black text-white">3D Game Sound Effects</p>
                        <p className="text-[11px] text-slate-400">
                          Wood seed clacks, billiard collisions &amp; turn chimes
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={soundEnabled ? "default" : "outline"}
                      onClick={() => {
                        const next = !soundEnabled;
                        setSoundEnabled(next);
                        setGameSensoryPreferences({ soundEnabled: next });
                      }}
                      className={
                        soundEnabled
                          ? "bg-emerald-500 text-slate-950 font-black text-xs h-8 rounded-xl"
                          : "border-white/15 text-slate-300 text-xs h-8 rounded-xl"
                      }
                    >
                      {soundEnabled ? "ON" : "OFF"}
                    </Button>
                  </div>

                  {/* Haptic Vibration Toggle */}
                  <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-amber-500/15 text-amber-400">
                        <Vibrate className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-white">Haptic Vibration Feedback</p>
                        <p className="text-[11px] text-slate-400">
                          Tactile pulse on captures, cue shots &amp; dice rolls
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={vibrationEnabled ? "default" : "outline"}
                      onClick={() => {
                        const next = !vibrationEnabled;
                        setVibrationEnabled(next);
                        setGameSensoryPreferences({ vibrationEnabled: next });
                        if (next) triggerHapticSensor("aim_tick");
                      }}
                      className={
                        vibrationEnabled
                          ? "bg-amber-500 text-slate-950 font-black text-xs h-8 rounded-xl"
                          : "border-white/15 text-slate-300 text-xs h-8 rounded-xl"
                      }
                    >
                      {vibrationEnabled ? "ON" : "OFF"}
                    </Button>
                  </div>

                  {/* Browser Turn Alerts */}
                  <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-sky-500/15 text-sky-400">
                        <BellRing className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-white">Live Turn Push Alerts</p>
                        <p className="text-[11px] text-slate-400">
                          Get alerted when your friend completes their move
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (typeof window !== "undefined" && "Notification" in window) {
                          Notification.requestPermission();
                        }
                      }}
                      className="border-sky-500/40 text-sky-300 text-xs h-8 rounded-xl font-bold"
                    >
                      Enable
                    </Button>
                  </div>
                </div>
              )}

              {profileDrawerTab === "help" && (
                <div className="space-y-3">
                  <p className="text-xs font-black uppercase tracking-wider text-amber-300">
                    Game Rules &amp; How to Play
                  </p>
                  {GAME_CATALOG.map((g) => (
                    <div
                      key={g.id}
                      className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-white flex items-center gap-1.5">
                          <span>{g.emoji}</span> {g.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedGame(g.id);
                            setProfileDrawerOpen(false);
                            setInstructionModalOpen(true);
                          }}
                          className="text-[11px] font-bold text-amber-300 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <BookOpen className="w-3 h-3" /> Interactive Guide
                        </button>
                      </div>
                      <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-300">
                        {g.rulesSummary.map((rule, idx) => (
                          <li key={idx}>{rule}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div className="p-3 border-t border-white/10 bg-[#090e1a] flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(user ? "/dashboard" : "/")}
                className="flex-1 h-10 rounded-xl border-white/15 bg-white/5 hover:bg-white/10 text-white font-bold text-xs gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to {user ? "Dashboard" : "Home"}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setProfileDrawerOpen(false);
                  openLaunchSheetForGame(selectedGame, "free_data");
                }}
                className="flex-1 h-10 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs"
              >
                Play Now →
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── QUICK GAME LAUNCH & MATCH SETUP MODAL (OPENS WHEN TAPPING A GAME CARD) ── */}
      {launchModalOpen && (
        <div className="fixed inset-0 z-[115] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setLaunchModalOpen(false)}
          />
          <div className="relative z-10 w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-[#0e1628] border border-white/15 p-5 sm:p-6 shadow-2xl space-y-5 max-h-[92dvh] overflow-y-auto animate-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-400/40 flex items-center justify-center text-2xl">
                  {selectedGameMeta.emoji}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-black text-white">{selectedGameMeta.name}</h3>
                    <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 text-[10px] font-black">
                      {selectedGameMeta.statusTag}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-300 line-clamp-1">{selectedGameMeta.subtitle}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLaunchModalOpen(false)}
                className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Game Switcher Strip inside Launch Modal */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {GAME_CATALOG.map((g) => {
                const active = selectedGame === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setSelectedGame(g.id)}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-black whitespace-nowrap border transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                      active
                        ? "bg-amber-500 text-slate-950 border-amber-300 shadow-md"
                        : "bg-slate-950/70 text-slate-300 border-white/10 hover:text-white hover:border-white/25"
                    }`}
                  >
                    <span>{g.emoji}</span>
                    <span>{g.shortTitle}</span>
                  </button>
                );
              })}
            </div>

            {/* Mode Selector Pills */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSelectedMode("free_data")}
                className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                  selectedMode === "free_data"
                    ? "bg-amber-500/20 border-amber-400 text-white ring-1 ring-amber-400"
                    : "bg-slate-950/70 border-white/10 text-slate-400 hover:text-white"
                }`}
              >
                <Gift className="w-4 h-4 text-amber-400 mb-1" />
                <p className="text-xs font-black">Win Data</p>
                <p className="text-[10px] opacity-80">Free • vs Smart AI</p>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMode("p2p")}
                className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                  selectedMode === "p2p"
                    ? "bg-emerald-500/20 border-emerald-400 text-white ring-1 ring-emerald-400"
                    : "bg-slate-950/70 border-white/10 text-slate-400 hover:text-white"
                }`}
              >
                <Users className="w-4 h-4 text-emerald-400 mb-1" />
                <p className="text-xs font-black">Play Friend</p>
                <p className="text-[10px] opacity-80">Online Room Code</p>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMode("ai")}
                className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                  selectedMode === "ai"
                    ? "bg-sky-500/20 border-sky-400 text-white ring-1 ring-sky-400"
                    : "bg-slate-950/70 border-white/10 text-slate-400 hover:text-white"
                }`}
              >
                <Brain className="w-4 h-4 text-sky-400 mb-1" />
                <p className="text-xs font-black">1.8× Cash AI</p>
                <p className="text-[10px] opacity-80">Staked Match</p>
              </button>
            </div>

            {selectedMode === "free_data" ? (
              <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 space-y-2 text-xs text-slate-300">
                <div className="flex items-center justify-between">
                  <span className="font-black text-amber-300">
                    🎯 Opponent: {HUMAN_CHALLENGER_PERSONAS[selectedGame].name}
                  </span>
                  <Badge className="bg-white/10 text-white text-[10px]">
                    {HUMAN_CHALLENGER_PERSONAS[selectedGame].humanSensePercent}% Skill
                  </Badge>
                </div>
                <p className="text-[11px] text-slate-400">
                  Play for free and earn Arena Points toward your{" "}
                  <strong className="text-white">{selectedTargetOption.label}</strong> (
                  {arenaPoints.toLocaleString()} /{" "}
                  {selectedTargetOption.pointsRequired.toLocaleString()} Pts).
                </p>
              </div>
            ) : (
              <div className="space-y-3 p-3.5 rounded-2xl bg-white/[0.03] border border-white/10">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentSource("wallet")}
                    className={`p-2.5 rounded-xl border text-left flex items-center gap-2 cursor-pointer ${
                      paymentSource === "wallet"
                        ? "bg-emerald-500/15 border-emerald-400 text-emerald-300"
                        : "bg-slate-950 border-white/10 text-slate-400"
                    }`}
                  >
                    <Wallet className="w-4 h-4 shrink-0" />
                    <div>
                      <p className="text-xs font-black">Wallet</p>
                      <p className="text-[10px]">GH₵ {walletBalance.toFixed(2)}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentSource("momo")}
                    className={`p-2.5 rounded-xl border text-left flex items-center gap-2 cursor-pointer ${
                      paymentSource === "momo"
                        ? "bg-amber-500/15 border-amber-400 text-amber-300"
                        : "bg-slate-950 border-white/10 text-slate-400"
                    }`}
                  >
                    <Smartphone className="w-4 h-4 shrink-0" />
                    <div>
                      <p className="text-xs font-black">MoMo</p>
                      <p className="text-[10px]">MTN / Telecel / AT</p>
                    </div>
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Stake Amount (GH₵)</span>
                    <span className="font-mono font-black text-emerald-400">
                      Winner Pot: GH₵{" "}
                      {(
                        Number(stakeAmount || 0) *
                        (selectedMode === "p2p"
                          ? 2 * (1 - Number(settings.house_commission_percent || 10) / 100)
                          : 1.8)
                      ).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    {QUICK_STAKES.map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setStakeAmount(String(amt))}
                        className={`flex-1 py-1.5 rounded-xl border text-xs font-black cursor-pointer ${
                          Number(stakeAmount) === amt
                            ? "bg-amber-500 text-slate-950 border-amber-400"
                            : "bg-slate-950 border-white/10 text-slate-300"
                        }`}
                      >
                        ₵{amt}
                      </button>
                    ))}
                  </div>
                </div>

                {selectedMode === "p2p" && (
                  <div className="space-y-2 pt-1 border-t border-white/10">
                    <Label className="text-[11px] text-amber-300 font-bold">
                      Invite Friend by Phone (Optional — or share room code after creating)
                    </Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Input
                        placeholder="Friend's Phone (024...)"
                        value={invitedPhone}
                        onChange={(e) => setInvitedPhone(e.target.value)}
                        className="h-9 rounded-xl bg-slate-950 border-white/15 text-xs font-mono text-white"
                      />
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                        <Input
                          placeholder="Search player..."
                          value={playerSearchQuery}
                          onChange={(e) => setPlayerSearchQuery(e.target.value)}
                          className="h-9 pl-8 rounded-xl bg-slate-950 border-white/15 text-xs text-white"
                        />
                      </div>
                    </div>
                    {suggestedPlayers.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {suggestedPlayers.slice(0, 4).map((p) => (
                          <button
                            key={p.user_id}
                            type="button"
                            onClick={() => {
                              setSelectedInvitedUser(p);
                              setInvitedPhone(p.phone || "");
                            }}
                            className="px-2 py-0.5 rounded-lg bg-slate-900 border border-white/10 text-[10px] font-bold text-slate-300 hover:text-amber-300"
                          >
                            + {p.full_name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2.5 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setLaunchModalOpen(false);
                  setInstructionModalOpen(true);
                }}
                className="h-12 px-4 rounded-2xl border-white/15 bg-white/5 hover:bg-white/10 text-slate-200 font-bold text-xs gap-1.5"
              >
                <HelpCircle className="w-4 h-4 text-amber-400" />
                Rules
              </Button>
              <Button
                type="button"
                disabled={submitting}
                onClick={() => startChallengeWithConfig(selectedGame, selectedMode)}
                className="flex-1 h-12 rounded-2xl bg-[#f59e0b] hover:bg-[#fbbf24] text-slate-950 font-black text-sm gap-2 shadow-xl"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>
                      {selectedMode === "free_data"
                        ? `Play ${selectedGameMeta.shortTitle} Now`
                        : selectedMode === "p2p"
                        ? `Create ${selectedGameMeta.shortTitle} Room (GH₵ ${Number(
                            stakeAmount || 0
                          ).toFixed(2)})`
                        : `Play vs Champion (GH₵ ${Number(stakeAmount || 0).toFixed(2)})`}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── GAMER COMMUNITY & LIVE CHAT HUB MODAL ── */}
      {communityModalOpen && (
        <div
          className="fixed inset-0 z-[115] bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150"
          onClick={() => setCommunityModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl h-[90dvh] sm:h-[88dvh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <GamerCommunityHub
              currentUserId={user?.id || null}
              playerName={displayFirstName}
              playerPhone={playerPhone || profile?.phone || ""}
              playerAvatarId={playerAvatarId}
              playerLevel={levelInfo.level}
              playerTitle={levelInfo.title}
              activeRoomCode={activeChallenge?.room_code || null}
              activeChallenge={activeChallenge}
              openChallenges={openChallenges}
              defaultTab={communityModalTab}
              initialDmPartner={initialDmPartner}
              onClose={() => {
                setCommunityModalOpen(false);
                setInitialDmPartner(null);
              }}
              onJoinByRoomCode={(code) => handleJoinByRoomCode(code)}
              onJoinChallengeObject={(chal) => {
                setCommunityModalOpen(false);
                const isMine = user && chal.creator_id === user.id;
                if (isMine) {
                  setMySide("creator");
                  setActiveChallenge(chal);
                } else {
                  handleJoinChallenge(chal, user ? "wallet" : "momo");
                }
              }}
              onQuickCreateChallenge={(gKey, invitedTarget) => {
                setCommunityModalOpen(false);
                if (invitedTarget) {
                  setSelectedInvitedUser({
                    user_id: invitedTarget.user_id || "",
                    full_name: invitedTarget.full_name,
                    masked_phone: invitedTarget.phone || "",
                    phone: invitedTarget.phone || "",
                    is_agent: false,
                  });
                  setInvitedPhone(invitedTarget.phone || "");
                }
                openLaunchSheetForGame(gKey as GameType, "p2p");
              }}
            />
          </div>
        </div>
      )}

      {/* ── ACTIVE GAME STAGE (ULTRA-COMPACT TOP BAR + FULL-SCREEN FITTED BOARD) ── */}
      {activeChallenge ? (
        <Card className="relative flex-1 min-h-0 w-full flex flex-col border-0 rounded-none bg-[#070b14] shadow-none overflow-hidden">
          {topHudCollapsed ? (
            /* Floating Corner Pill when Board is 100% Locked to Screen */
            <div className="fixed top-1.5 left-1.5 z-[95] flex items-center gap-1 px-2 py-1 rounded-full bg-slate-950/90 border border-white/15 shadow-xl backdrop-blur-md">
              <button
                type="button"
                onClick={() => setActiveChallenge(null)}
                className="px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20 text-[10px] font-black text-white flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3 h-3" /> Lobby
              </button>
              <button
                type="button"
                onClick={() => {
                  setCommunityModalTab("room");
                  setCommunityModalOpen(true);
                }}
                className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-[9px] font-black text-emerald-300 flex items-center gap-1 cursor-pointer"
                title="Open Room & Community Chat"
              >
                <MessageCircle className="w-2.5 h-2.5" /> Chat
              </button>
              <button
                type="button"
                onClick={() => {
                  setProfileDrawerTab("settings");
                  setProfileDrawerOpen(true);
                }}
                className="p-1 rounded-full bg-white/5 hover:bg-white/15 text-amber-400 cursor-pointer"
                title="Settings & Rules"
              >
                <Settings className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setTopHudCollapsed(false)}
                className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/40 text-[9px] font-black text-amber-300 flex items-center gap-1 cursor-pointer"
                title="Show Top Bar"
              >
                <Minimize2 className="w-2.5 h-2.5" /> Bar
              </button>
            </div>
          ) : (
            <CardHeader className="shrink-0 h-7 py-0.5 px-2 sm:px-3 border-b border-white/10 bg-[#0c1322] flex flex-row flex-nowrap items-center justify-between gap-1.5 space-y-0 overflow-x-auto no-scrollbar">
              <div className="flex items-center gap-1.5 min-w-0 shrink-0">
                {/* Left-Corner Profile / Settings / Help Micro Button */}
                <button
                  type="button"
                  onClick={() => {
                    setProfileDrawerTab("settings");
                    setProfileDrawerOpen(true);
                  }}
                  className="h-5 px-1.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/15 flex items-center gap-1 text-[9px] font-bold text-white cursor-pointer shrink-0"
                  title="Player Profile, Sound Settings & Game Rules"
                >
                  <span className="w-3.5 h-3.5 rounded bg-amber-500 text-slate-950 font-black text-[8px] flex items-center justify-center">
                    {displayFirstName.slice(0, 1).toUpperCase()}
                  </span>
                  <Settings className="w-2.5 h-2.5 text-amber-400" />
                </button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveChallenge(null)}
                  className="h-5 px-1.5 rounded-md border-white/15 bg-white/5 text-[9px] text-slate-200 hover:text-white gap-1 font-bold shrink-0"
                >
                  <ArrowLeft className="w-2.5 h-2.5" /> Lobby
                </Button>

                <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono text-[8px] px-1 py-0 shrink-0">
                  #{activeChallenge.room_code}
                </Badge>

                <Badge
                  className={
                    activeChallenge.status === "in_progress"
                      ? "bg-emerald-500 text-slate-950 font-black text-[8px] px-1 py-0 shrink-0"
                      : activeChallenge.status === "open"
                      ? "bg-amber-500 text-slate-950 font-black animate-pulse text-[8px] px-1 py-0 shrink-0"
                      : "bg-purple-500 text-white font-black text-[8px] px-1 py-0 shrink-0"
                  }
                >
                  {activeChallenge.status === "open"
                    ? "⏳ WAIT"
                    : activeChallenge.status === "in_progress"
                    ? "🟢 LIVE"
                    : "🏁 DONE"}
                </Badge>

                <span className="text-[9px] sm:text-[11px] font-black text-white truncate max-w-[120px] sm:max-w-[240px]">
                  {activeChallenge.creator_name} <span className="text-amber-400">vs.</span>{" "}
                  {activeChallenge.opponent_name || "Waiting..."}
                </span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-sky-500/10 border border-sky-400/30 text-[8px] font-mono text-sky-300">
                  📱 {screenFit.deviceBrand} {screenFit.availWidth}×{screenFit.availHeight}
                </span>

                {lastPointsPopup && (
                  <Badge className="bg-amber-400 text-slate-950 font-black text-[8px] animate-bounce px-1 py-0">
                    +{lastPointsPopup.pts} PTS
                  </Badge>
                )}

                <div className="px-1.5 py-0.2 rounded-md bg-emerald-500/15 border border-emerald-500/35 flex items-center gap-1 shrink-0">
                  <span className="text-[9px] font-black text-emerald-400 font-mono whitespace-nowrap">
                    {activeChallenge.mode === "free_data"
                      ? `🎁 Free ${activeChallenge.reward_data_size || "1GB"}`
                      : `GH₵ ${Number(activeChallenge.prize_pool || 0).toFixed(2)}`}
                  </span>
                </div>

                {/* 1-Tap Live Room & Community Chat Button */}
                <button
                  type="button"
                  onClick={() => {
                    setCommunityModalTab("room");
                    setCommunityModalOpen(true);
                  }}
                  className="h-5 px-1.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-[9px] font-black text-emerald-300 flex items-center gap-1 cursor-pointer shrink-0"
                  title="Open Room & Community Chat"
                >
                  <MessageCircle className="w-2.5 h-2.5" />
                  <span>Chat</span>
                </button>

                {/* 1-Tap Full Board Lock Toggle (Collapses Top Bar for 100% Screen Fit) */}
                <button
                  type="button"
                  onClick={() => setTopHudCollapsed(true)}
                  className="h-5 px-1.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-[9px] font-black text-amber-300 flex items-center gap-1 cursor-pointer shrink-0"
                  title="Hide top bar and lock board to 100% of screen"
                >
                  <Maximize2 className="w-2.5 h-2.5" />
                  <span className="hidden sm:inline">Lock Board</span>
                </button>

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
                      className="h-5 px-1.5 rounded-md border-amber-500/40 bg-amber-500/10 text-amber-300 font-bold text-[9px] gap-1"
                    >
                      {copiedCode ? <Check className="w-2.5 h-2.5" /> : <Share2 className="w-2.5 h-2.5" />}
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleCancelOpenChallenge(activeChallenge.id)}
                      className="h-5 px-1.5 rounded-md text-[9px] font-bold gap-1"
                    >
                      <XCircle className="w-2.5 h-2.5" /> Cancel
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>
          )}

          <CardContent
            className={
              activeChallenge.game_type === "pool" && activeChallenge.status === "in_progress"
                ? "flex-1 min-h-0 w-full overflow-hidden overscroll-none p-0 flex flex-col items-center justify-center"
                : "flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-none p-1.5 sm:p-3 space-y-1.5 max-w-6xl mx-auto"
            }
          >
            {/* Waiting for Opponent + Invite Console (Open P2P Challenge) */}
            {activeChallenge.status === "open" && (
              <div className="p-5 sm:p-6 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-4">
                <div className="text-center space-y-1.5">
                  <Loader2 className="w-7 h-7 text-amber-400 animate-spin mx-auto" />
                  <h3 className="text-base sm:text-lg font-black text-white">
                    Room #{activeChallenge.room_code} — Waiting for Friend to Join
                  </h3>
                  <p className="text-xs text-slate-300 max-w-md mx-auto">
                    Send your room code <strong className="text-amber-300">#{activeChallenge.room_code}</strong> to a friend or invite them via SMS / WhatsApp below:
                  </p>
                </div>

                <div className="max-w-xl mx-auto p-4 rounded-2xl bg-slate-950/90 border border-white/10 space-y-3">
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
                      Send SMS Invite
                    </Button>
                  </div>

                  <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={sendingInvite}
                      onClick={() => handleSendRoomInvite(activeChallenge, { broadcastAll: true })}
                      className="h-9 rounded-xl border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-bold text-xs gap-1.5"
                    >
                      <BellRing className="w-3.5 h-3.5" />
                      Notify Online Players
                    </Button>

                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(
                        `⚔️ Join my ${String(activeChallenge.game_type || "").toUpperCase()} match on SwiftData Games!\n🔑 Room Code: #${activeChallenge.room_code}\n👉 Tap to play: ${
                          window.location.origin
                        }/challenges?room=${activeChallenge.room_code}`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      Share on WhatsApp
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Winner Reward Claim / Point Accumulation Banner */}
            {activeChallenge.status === "completed" &&
              activeChallenge.winner_side === mySide &&
              !activeChallenge.reward_claimed && (
                <div className="p-3 rounded-2xl bg-gradient-to-r from-emerald-950/90 via-teal-950/80 to-slate-900 border border-emerald-400/60 space-y-2">
                  {activeChallenge.mode === "free_data" && !canRedeemTargetBundle ? (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="space-y-0.5">
                        <h3 className="text-xs sm:text-sm font-black text-white">
                          🏆 Victory! +300 Points Added (Lv.{levelInfo.level} • {targetProgressPercent}% to {selectedTargetOption.size})
                        </h3>
                        <p className="text-[11px] text-emerald-200">
                          {arenaPoints.toLocaleString()} / {selectedTargetOption.pointsRequired.toLocaleString()} Pts accumulated.
                        </p>
                      </div>
                      <Button
                        type="button"
                        disabled={submitting}
                        onClick={handleCreateChallenge}
                        className="h-8 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs gap-1.5 px-3 shrink-0"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        Play Next Match (+300 Pts)
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <select
                        value={claimNetwork}
                        onChange={(e) => setClaimNetwork(e.target.value)}
                        className="h-9 rounded-xl bg-slate-950 border border-emerald-500/40 px-3 text-xs font-bold text-white"
                      >
                        <option value="MTN">MTN Data</option>
                        <option value="TELECEL">Telecel Data</option>
                        <option value="AT">AirtelTigo Data</option>
                      </select>
                      <Input
                        placeholder="Recipient Phone (0241234567)"
                        value={claimPhone}
                        onChange={(e) => setClaimPhone(e.target.value)}
                        className="h-9 rounded-xl bg-slate-950 border-emerald-500/40 text-white font-mono text-xs"
                      />
                      <Button
                        onClick={
                          activeChallenge.mode === "free_data"
                            ? handleRedeemPointsBundle
                            : handleClaimDataReward
                        }
                        disabled={claimingReward || claimingPointsBundle}
                        className="h-9 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs gap-1.5"
                      >
                        <Gift className="w-3.5 h-3.5" />
                        Claim {selectedTargetOption.size} Data Now
                      </Button>
                    </div>
                  )}
                </div>
              )}

            {/* Render the Active Game Engine */}
            {activeChallenge.status !== "open" && (
              <>
                {activeChallenge.status === "in_progress" &&
                  activeChallenge.game_type !== "slash" &&
                  activeChallenge.game_type !== "buggy" &&
                  (activeChallenge.game_type !== "pool" || activeChallenge.mode === "p2p") && (() => {
                    const currentTurnSide =
                      activeChallenge.current_turn ||
                      activeChallenge.board_state?.turn ||
                      "creator";
                    const hasAnyMoveOccurred =
                      Number(activeChallenge.board_state?.shotCount || 0) > 0 ||
                      Number(activeChallenge.board_state?.moveCount || 0) > 0 ||
                      Number(activeChallenge.board_state?.engine?.moveCount || 0) > 0;
                    const isCurrentlyMyTurn =
                      currentTurnSide === mySide ||
                      (activeChallenge.mode === "p2p" && !hasAnyMoveOccurred);
                    const gType = (activeChallenge.game_type || "pool") as GameType;
                    const activeLudoColor = activeChallenge.board_state?.currentPlayerColor;
                    const activeLudoSeat =
                      activeLudoColor && activeChallenge.board_state?.players?.[activeLudoColor]
                        ? activeChallenge.board_state.players[activeLudoColor]
                        : null;
                    const nextUpName =
                      activeLudoSeat?.name ||
                      (isCurrentlyMyTurn
                        ? mySide === "creator"
                          ? activeChallenge.creator_name || "You"
                          : activeChallenge.opponent_name || playerName || "You"
                        : currentTurnSide === "creator"
                        ? activeChallenge.creator_name || "Player 1"
                        : activeChallenge.opponent_name ||
                          HUMAN_CHALLENGER_PERSONAS[gType]?.name ||
                          "Player 2");

                    // For Pool P2P, only show a slim 1-line bar when waiting on a P2P friend so Ping / vs AI buttons are handy
                    if (activeChallenge.game_type === "pool" && isCurrentlyMyTurn) {
                      return null;
                    }

                    return (
                      <div
                        className={`px-2.5 py-1 rounded-xl border flex flex-wrap items-center justify-between gap-1.5 shrink-0 ${
                          isCurrentlyMyTurn
                            ? "bg-emerald-950/50 border-emerald-500/40"
                            : "bg-amber-950/40 border-amber-500/40"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isCurrentlyMyTurn
                                ? "bg-emerald-400 animate-ping"
                                : "bg-amber-400 animate-pulse"
                            }`}
                          />
                          <span className="text-[11px] font-black text-white">
                            {isCurrentlyMyTurn
                              ? `🟢 YOUR TURN (${nextUpName})`
                              : `🔔 NEXT TURN: ${nextUpName.toUpperCase()}`}
                          </span>
                        </div>

                        {!isCurrentlyMyTurn && activeChallenge.mode === "p2p" && (
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              disabled={nudgingTurn}
                              onClick={handleNudgeNextPlayer}
                              className="h-6 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[9px] gap-1 px-2"
                            >
                              <BellRing className="w-2.5 h-2.5" />
                              Ping {nextUpName}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const gKey = (activeChallenge.game_type || "pool") as GameType;
                                const aiName =
                                  HUMAN_CHALLENGER_PERSONAS[gKey]?.name || "Grandmaster AI";
                                setMySide("creator");
                                setActiveChallenge((prev: any) => {
                                  if (!prev) return prev;
                                  const nextBoard = {
                                    ...(prev.board_state || {}),
                                    turn: "creator",
                                  };
                                  if (nextBoard.engine && typeof nextBoard.engine === "object") {
                                    nextBoard.engine = {
                                      ...nextBoard.engine,
                                      currentPlayer: "RED",
                                      currentPlayerIndex: 0,
                                      playerMeta: {
                                        ...(nextBoard.engine.playerMeta || {}),
                                        RED: {
                                          ...(nextBoard.engine.playerMeta?.RED || {}),
                                          isAI: false,
                                        },
                                        YELLOW: {
                                          ...(nextBoard.engine.playerMeta?.YELLOW || {}),
                                          name: aiName,
                                          isAI: true,
                                        },
                                      },
                                    };
                                  }
                                  return {
                                    ...prev,
                                    mode: "ai",
                                    opponent_name: aiName,
                                    current_turn: "creator",
                                    board_state: nextBoard,
                                  };
                                });
                                toast({
                                  title: `⚡ Switched to ${aiName}!`,
                                  description: "Play immediately without waiting!",
                                });
                              }}
                              className="h-6 rounded-lg border-emerald-400/50 bg-emerald-500/15 text-emerald-300 font-black text-[9px] gap-1 px-2"
                            >
                              <Brain className="w-2.5 h-2.5" />
                              vs AI Now
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })()}

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
                    roomCode={activeChallenge.room_code}
                    initialState={activeChallenge.board_state}
                    onStateChange={handleBoardStateChange}
                    onMatchComplete={handleMatchComplete}
                    onPointsEarned={handlePointsEarned}
                    onInvitePlayer={({ phone }) => {
                      if (phone) {
                        handleSendRoomInvite(activeChallenge, { phone });
                      }
                    }}
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
                    reservedTopPx={topHudCollapsed ? 0 : 28}
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
                {activeChallenge.game_type === "candy" && (
                  <CandyCrashBoard
                    mode={activeChallenge.mode}
                    mySide={mySide}
                    creatorName={activeChallenge.creator_name}
                    opponentName={
                      activeChallenge.opponent_name || HUMAN_CHALLENGER_PERSONAS.candy.name
                    }
                    initialState={activeChallenge.board_state}
                    onStateChange={handleBoardStateChange}
                    onMatchComplete={handleMatchComplete}
                    onPointsEarned={handlePointsEarned}
                    playerLevel={levelInfo.level}
                    onBackToLobby={() => setActiveChallenge(null)}
                  />
                )}
                {activeChallenge.game_type === "buggy" && (
                  <BeachBuggyTrack
                    mode={activeChallenge.mode}
                    mySide={mySide}
                    creatorName={activeChallenge.creator_name}
                    opponentName={
                      activeChallenge.opponent_name || HUMAN_CHALLENGER_PERSONAS.buggy.name
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
        /* ── PROFESSIONAL GAME HUB HOME (MATCHING REFERENCE DESIGN) ── */
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 pb-16 space-y-7">
          {/* 1. Top Bar: Left Profile/Settings/Help Corner + Home Pill & Right Status Pill */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {/* Left-Corner Gamer Profile, Help & Settings Trigger */}
              <button
                type="button"
                onClick={() => {
                  setProfileDrawerTab("profile");
                  setProfileDrawerOpen(true);
                }}
                className="group flex items-center gap-2.5 pl-1 pr-3.5 py-1 rounded-full bg-white/[0.07] hover:bg-white/[0.12] border border-white/15 transition-all cursor-pointer shadow-lg"
                title="Open Gamer Profile, Avatar Grid, Settings, Online Rooms & Help"
              >
                <VerifiedGamerAvatar
                  avatarId={playerAvatarId}
                  seedName={displayFirstName}
                  size={38}
                  showVerifiedBadge={true}
                  glow={true}
                />
                <div className="text-left leading-tight">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-black text-white">{displayFirstName}</span>
                    <span className="text-[10px] font-black text-amber-400">
                      Lv.{levelInfo.level}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    Avatar • Menu • Settings
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => navigate(user ? "/dashboard" : "/")}
                className="flex items-center gap-1 px-3.5 py-2 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs font-bold text-slate-300 hover:text-white transition-all cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Home</span>
              </button>
            </div>

            {/* Top-Right Status Pill */}
            <button
              type="button"
              onClick={() => {
                setProfileDrawerTab("rooms");
                setProfileDrawerOpen(true);
              }}
              className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/12 text-xs font-bold text-slate-200 transition-all cursor-pointer"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>
                7 games • {openChallenges.length > 0 ? `${openChallenges.length} open` : "free"}
              </span>
            </button>
          </div>

          {/* 2. Clean Editorial Hero Section */}
          <div className="space-y-4 pt-1">
            <p className="text-[11px] sm:text-xs font-black uppercase tracking-[0.22em] text-slate-400">
              SWIFTDATA GAMES
            </p>

            <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-[1.03]">
              <span className="block text-white">Play smart.</span>
              <span className="block bg-gradient-to-r from-[#f59e0b] via-[#fb923c] to-[#fbbf24] bg-clip-text text-transparent">
                Win data.
              </span>
            </h1>

            <p className="text-sm sm:text-base text-slate-300/90 max-w-lg leading-relaxed">
              Skill games only. No luck, no guesswork. Only the sharpest players will win.
            </p>

            {/* Interactive Feature Pills */}
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => openLaunchSheetForGame("buggy", "free_data")}
                className="px-4 py-2 rounded-full bg-gradient-to-r from-orange-500/25 via-amber-500/25 to-emerald-500/20 hover:from-orange-500/35 hover:to-emerald-500/30 border border-amber-400/50 text-xs sm:text-sm font-black text-amber-200 flex items-center gap-2 transition-all cursor-pointer shadow-[0_0_20px_rgba(245,158,11,0.2)]"
              >
                <span>🏎️</span>
                <span>Labadi Buggy GP • NEW</span>
              </button>

              <button
                type="button"
                onClick={() => openLaunchSheetForGame("oware", "free_data")}
                className="px-4 py-2 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/12 text-xs sm:text-sm font-bold text-slate-200 flex items-center gap-2 transition-all cursor-pointer"
              >
                <span>🧠</span>
                <span>Skill, not luck</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setInitialDmPartner(null);
                  setCommunityModalTab("dms");
                  setCommunityModalOpen(true);
                }}
                className="px-4 py-2 rounded-full bg-gradient-to-r from-pink-500/25 via-rose-500/25 to-amber-500/25 hover:from-pink-500/35 hover:to-amber-500/35 border border-pink-400/50 text-xs sm:text-sm font-black text-pink-200 flex items-center gap-2 transition-all cursor-pointer shadow-[0_0_20px_rgba(236,72,153,0.2)]"
              >
                <span>✈️</span>
                <span>Text Gamers (DMs)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setInitialDmPartner(null);
                  setCommunityModalTab("chat");
                  setCommunityModalOpen(true);
                }}
                className="px-4 py-2 rounded-full bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 text-xs sm:text-sm font-bold text-amber-300 flex items-center gap-2 transition-all cursor-pointer"
              >
                <span>💬</span>
                <span>SwiftGram Feed</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCommunityModalTab("gamers");
                  setCommunityModalOpen(true);
                }}
                className="px-4 py-2 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/12 text-xs sm:text-sm font-bold text-slate-200 flex items-center gap-2 transition-all cursor-pointer"
              >
                <span>👥</span>
                <span>Meet &amp; Challenge Players</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setProfileDrawerTab("profile");
                  setProfileDrawerOpen(true);
                }}
                className="px-4 py-2 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/12 text-xs sm:text-sm font-bold text-slate-200 flex items-center gap-2 transition-all cursor-pointer"
              >
                <span>🎁</span>
                <span>
                  {targetDataSize} Goal ({targetProgressPercent}%)
                </span>
              </button>
            </div>
          </div>

          {/* 2A. Gamer Daily Life Stories (Photos, Videos & Statuses + Glossy Avatars) */}
          <DailyStoriesBar
            currentUserId={user?.id || null}
            playerName={displayFirstName}
            playerPhone={playerPhone || profile?.phone || ""}
            playerAvatarId={playerAvatarId}
            playerLevel={levelInfo.level}
            playerTitle={levelInfo.title}
            favoriteGame={selectedGame}
            activeRoomCode={activeChallenge?.room_code || null}
            onJoinRoomCode={(code) => handleJoinByRoomCode(code)}
            onChallengeStoryAuthor={(author) => {
              setSelectedInvitedUser({
                user_id: author.user_id || "",
                full_name: author.display_name,
                masked_phone: "Story Gamer",
                phone: "",
                is_agent: false,
              });
              openLaunchSheetForGame(
                (author.favorite_game as GameType) || "oware",
                "p2p"
              );
            }}
          />

          {/* 2B. Live SwiftGram Gamer Feed & 1-on-1 Direct Messaging Card */}
          <GamerCommunityPreviewCard
            currentUserId={user?.id || null}
            playerName={displayFirstName}
            playerPhone={playerPhone || profile?.phone || ""}
            playerAvatarId={playerAvatarId}
            playerLevel={levelInfo.level}
            playerTitle={levelInfo.title}
            onOpenChat={() => {
              setInitialDmPartner(null);
              setCommunityModalTab("chat");
              setCommunityModalOpen(true);
            }}
            onOpenDirectMessages={(targetGamer) => {
              setInitialDmPartner(targetGamer || null);
              setCommunityModalTab("dms");
              setCommunityModalOpen(true);
            }}
            onOpenMeetGamers={() => {
              setInitialDmPartner(null);
              setCommunityModalTab("gamers");
              setCommunityModalOpen(true);
            }}
            onJoinByRoomCode={(code) => handleJoinByRoomCode(code)}
            onQuickChallengeGamer={(g) => {
              setSelectedInvitedUser({
                user_id: g.user_id || "",
                full_name: g.display_name,
                masked_phone: g.masked_phone || "",
                phone: g.raw_phone || "",
                is_agent: false,
              });
              openLaunchSheetForGame(
                (g.favorite_game as GameType) || "oware",
                "p2p"
              );
            }}
          />

          {/* 3. Live / Accepted Match Alert (Only shown when user has an active or invited room) */}
          {invitedSpotlightChallenge && (
            <div className="p-4 rounded-3xl bg-gradient-to-r from-amber-500/20 to-emerald-500/15 border border-amber-400/60 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black text-amber-300 uppercase">
                  🎯 Direct Room Invite • #{invitedSpotlightChallenge.room_code}
                </p>
                <p className="text-sm font-black text-white">
                  {invitedSpotlightChallenge.creator_name} invited you to play{" "}
                  {String(invitedSpotlightChallenge.game_type || "").toUpperCase()}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  handleJoinChallenge(invitedSpotlightChallenge, user ? "wallet" : "momo")
                }
                className="h-10 rounded-full bg-[#f59e0b] hover:bg-[#fbbf24] text-slate-950 font-black text-xs px-5"
              >
                Accept &amp; Play →
              </Button>
            </div>
          )}

          {activeInProgressChallenges.length > 0 && (
            <div className="p-4 rounded-3xl bg-emerald-500/10 border border-emerald-500/40 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-emerald-300 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                  Live Match Ready to Resume ({activeInProgressChallenges.length})
                </span>
              </div>
              {activeInProgressChallenges.slice(0, 2).map((chal) => {
                const detectedRole = resolveMySideForChallenge(chal);
                const effectiveSide: "creator" | "opponent" =
                  detectedRole ||
                  (user?.id && chal.creator_id === user.id ? "creator" : "opponent");
                return (
                  <div
                    key={chal.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-950/80 border border-white/10"
                  >
                    <div>
                      <p className="text-xs font-black text-white uppercase">
                        {chal.game_type} • Room #{chal.room_code}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {chal.creator_name} vs {chal.opponent_name || "Challenger"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        recordMyChallengeSide(chal.id, effectiveSide);
                        setMySide(effectiveSide);
                        setActiveChallenge(chal);
                      }}
                      className="h-9 rounded-full bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-xs px-4"
                    >
                      Play now →
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {/* 4. Featured Hero Game Card — OWARE (Carved Wooden Board + Seeds Showcase) */}
          <div
            onClick={() => openLaunchSheetForGame("oware", "free_data")}
            className="group relative rounded-[28px] overflow-hidden border border-amber-500/30 bg-gradient-to-b from-[#6b3c1b] via-[#3c210e] to-[#0f131d] shadow-[0_24px_60px_rgba(0,0,0,0.75)] cursor-pointer transition-transform duration-200 hover:scale-[1.01]"
          >
            {/* Carved Wooden Oware Board Illustration */}
            <div className="relative pt-4 px-4 sm:px-6 pb-2">
              {/* Top Badges inside Featured Card */}
              <div className="relative z-10 flex items-center gap-2 mb-3">
                <span className="px-3.5 py-1 rounded-full bg-[#fde08d] text-slate-950 font-black text-[11px] uppercase tracking-wider shadow">
                  GHANA&apos;S GAME
                </span>
                <span className="px-3.5 py-1 rounded-full bg-[#34d399] text-slate-950 font-black text-[11px] uppercase tracking-wider shadow">
                  PLAY ONLINE
                </span>
              </div>

              {/* Carved Oware Wooden Plank with 2 End Stores & 12 Pits */}
              <div
                className="relative rounded-2xl p-3 sm:p-4 border border-amber-300/20 shadow-inner"
                style={{
                  background:
                    "linear-gradient(180deg, #9a5b2c 0%, #7c451b 55%, #4d290e 100%)",
                  boxShadow:
                    "inset 0 4px 12px rgba(255,255,255,0.15), 0 12px 28px rgba(0,0,0,0.65)",
                }}
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  {/* Left Store */}
                  <div className="w-10 sm:w-14 h-24 sm:h-28 rounded-full bg-gradient-to-b from-[#2a1506] to-[#43230c] shadow-[inset_0_6px_12px_rgba(0,0,0,0.85)] flex flex-wrap items-center justify-center p-1.5 gap-0.5">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <span
                        key={i}
                        className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full"
                        style={{
                          background:
                            "radial-gradient(circle at 35% 30%, #f1f5f9 0%, #94a3b8 60%, #334155 100%)",
                        }}
                      />
                    ))}
                  </div>

                  {/* 12 Pits (2 Rows of 6) */}
                  <div className="flex-1 grid grid-cols-6 gap-1.5 sm:gap-2.5">
                    {Array.from({ length: 12 }).map((_, pitIdx) => (
                      <div
                        key={pitIdx}
                        className="aspect-square rounded-full bg-gradient-to-b from-[#261205] to-[#46240c] shadow-[inset_0_5px_10px_rgba(0,0,0,0.85)] flex flex-wrap items-center justify-center p-1 gap-0.5"
                      >
                        {Array.from({ length: (pitIdx % 3) + 2 }).map((__, sIdx) => (
                          <span
                            key={sIdx}
                            className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shadow"
                            style={{
                              background:
                                "radial-gradient(circle at 35% 30%, #f8fafc 0%, #94a3b8 60%, #334155 100%)",
                            }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>

                  {/* Right Store */}
                  <div className="w-10 sm:w-14 h-24 sm:h-28 rounded-full bg-gradient-to-b from-[#2a1506] to-[#43230c] shadow-[inset_0_6px_12px_rgba(0,0,0,0.85)] flex flex-wrap items-center justify-center p-1.5 gap-0.5">
                    {Array.from({ length: 7 }).map((_, i) => (
                      <span
                        key={i}
                        className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full"
                        style={{
                          background:
                            "radial-gradient(circle at 35% 30%, #f1f5f9 0%, #94a3b8 60%, #334155 100%)",
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Text & Gold CTA Overlay */}
            <div className="px-5 sm:px-7 pt-2 pb-6 space-y-3 bg-gradient-to-t from-[#090d16] via-[#090d16]/90 to-transparent">
              <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight">Oware</h2>
              <p className="text-xs sm:text-sm text-slate-300 max-w-lg leading-relaxed">
                Our own board game. Beat Kofi, Ama and Nana, or send a friend a code and play online.
              </p>
              <div className="pt-1">
                <span className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#f59e0b] group-hover:bg-[#fbbf24] text-slate-950 font-black text-sm shadow-lg transition-all">
                  <span>Play now</span>
                  <ArrowRight className="w-4 h-4" />
                </span>
              </div>
            </div>
          </div>

          {/* 5. "All games" Grid Section */}
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                All games
              </h2>
              <span className="text-xs sm:text-sm font-semibold text-slate-400">Tap to play</span>
            </div>

            <div className="grid grid-cols-2 gap-3.5 sm:gap-4">
              {/* Featured Racing Card: Labadi Beach & Aburi Buggy GP */}
              <div
                onClick={() => openLaunchSheetForGame("buggy", "free_data")}
                className="group relative rounded-3xl overflow-hidden border-2 border-amber-400/40 bg-[#101829] hover:border-amber-400 transition-all cursor-pointer flex flex-col justify-between shadow-[0_14px_35px_rgba(245,158,11,0.18)] col-span-2"
              >
                <div className="relative h-40 sm:h-44 bg-gradient-to-br from-[#7c2d12] via-[#0f4c5c] to-[#081c24] p-3.5 sm:p-4 flex flex-col justify-between overflow-hidden">
                  {/* Ghana Flag Racing Stripe Top Accent */}
                  <div
                    className="absolute inset-x-0 top-0 h-1.5"
                    style={{
                      background:
                        "linear-gradient(90deg, #ef4444 0% 33%, #facc15 33% 66%, #22c55e 66% 100%)",
                    }}
                  />
                  <div className="relative z-10 flex items-center justify-between gap-1">
                    <span className="px-2.5 py-1 rounded-full bg-slate-950/80 backdrop-blur-md text-amber-300 font-black text-[10px] uppercase tracking-wider">
                      🇬🇭 3D GHANA RACING • 3 LAPS
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-300 via-yellow-400 to-orange-400 text-slate-950 font-black text-[10px] uppercase tracking-wider shadow">
                      NEW • SUAME GARAGE
                    </span>
                  </div>

                  {/* Pseudo-3D Highway, Palm Trees, Kente Boost Pad & Buggy Illustration */}
                  <div className="relative my-auto flex items-center justify-center gap-4 sm:gap-6">
                    <span className="text-3xl sm:text-4xl drop-shadow-lg -rotate-6">🌴</span>
                    <div className="relative px-5 py-2 rounded-2xl bg-slate-950/65 border border-amber-400/40 shadow-[0_0_24px_rgba(245,158,11,0.35)] flex items-center gap-3">
                      <span className="text-4xl sm:text-5xl drop-shadow-[0_6px_12px_rgba(0,0,0,0.65)]">
                        🏎️
                      </span>
                      <div className="text-left">
                        <div className="text-[10px] font-black uppercase tracking-widest text-amber-300">
                          LABADI • TEMA • ABURI
                        </div>
                        <div className="text-xs sm:text-sm font-black text-white flex items-center gap-1.5">
                          <span>⚡ Sobolo Nitro</span>
                          <span className="text-emerald-400">• ₵ Cedis</span>
                        </div>
                      </div>
                    </div>
                    <span className="text-3xl sm:text-4xl drop-shadow-lg rotate-6">🚐</span>
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1 bg-[#0d1424]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
                      <span>Labadi Beach &amp; Aburi Buggy GP</span>
                      <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/40 text-amber-300 text-[10px] font-black uppercase">
                        PLAY NOW
                      </span>
                    </h3>
                    <ArrowRight className="w-4 h-4 text-amber-400 group-hover:translate-x-1 transition-transform" />
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-300 line-clamp-2">
                    Race across Labadi Beach, Tema Motorway &amp; Aburi Hills! Hit Kente boost pads, collect ₵ Cedis &amp; upgrade your buggy in Suame Magazine Garage.
                  </p>
                </div>
              </div>

              {/* Card 1: 8-Ball Pool & Snooker */}
              <div
                onClick={() => openLaunchSheetForGame("pool", "free_data")}
                className="group relative rounded-3xl overflow-hidden border border-white/10 bg-[#101829] hover:border-amber-400/50 transition-all cursor-pointer flex flex-col justify-between shadow-xl"
              >
                <div className="relative h-36 sm:h-44 bg-gradient-to-br from-[#0e4f82] via-[#1668a8] to-[#082c4c] p-3 flex flex-col justify-between overflow-hidden">
                  <div className="relative z-10 flex items-center justify-between gap-1">
                    <span className="px-2.5 py-1 rounded-full bg-slate-950/75 backdrop-blur-md text-white font-black text-[10px] uppercase tracking-wider">
                      BILLIARDS
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-[#fde08d] text-slate-950 font-black text-[10px] uppercase tracking-wider">
                      ONLINE
                    </span>
                  </div>

                  {/* Pool Table Felt, Cue Stick & Balls Art */}
                  <div className="relative my-auto flex items-center justify-center">
                    <div className="w-full h-20 rounded-xl border-4 border-[#5c260c] bg-[#1d7ec2] shadow-inner flex items-center justify-around px-3 relative">
                      <span className="w-5 h-5 rounded-full bg-white shadow-md" />
                      <div className="w-12 h-0.5 border-t border-dashed border-white/60" />
                      <div className="flex items-center -space-x-1">
                        <span className="w-5 h-5 rounded-full bg-amber-400 border border-black/20 flex items-center justify-center text-[8px] font-black text-black">
                          1
                        </span>
                        <span className="w-5 h-5 rounded-full bg-slate-950 border border-white/30 flex items-center justify-center text-[8px] font-black text-white">
                          8
                        </span>
                        <span className="w-5 h-5 rounded-full bg-rose-600 border border-black/20 flex items-center justify-center text-[8px] font-black text-white">
                          3
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1 bg-[#0d1424]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base sm:text-lg font-black text-white">8-Ball Pool</h3>
                    <ArrowRight className="w-4 h-4 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-400 line-clamp-2">
                    Pro cue stick tray, spin &amp; laser sight. Play online or vs Yaw.
                  </p>
                </div>
              </div>

              {/* Card 2: Market Slash (Reflex / Watermelon Card matching screenshot!) */}
              <div
                onClick={() => openLaunchSheetForGame("slash", "free_data")}
                className="group relative rounded-3xl overflow-hidden border border-white/10 bg-[#101829] hover:border-amber-400/50 transition-all cursor-pointer flex flex-col justify-between shadow-xl"
              >
                <div className="relative h-36 sm:h-44 bg-gradient-to-br from-[#4b2c18] via-[#7c3f1c] to-[#291509] p-3 flex flex-col justify-between overflow-hidden">
                  <div className="relative z-10 flex items-center justify-between gap-1">
                    <span className="px-2.5 py-1 rounded-full bg-slate-950/75 backdrop-blur-md text-white font-black text-[10px] uppercase tracking-wider">
                      REFLEX
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-[#fde08d] text-slate-950 font-black text-[10px] uppercase tracking-wider">
                      NEW
                    </span>
                  </div>

                  {/* Sliced Watermelon & Blade Flash Illustration */}
                  <div className="relative my-auto flex items-center justify-center">
                    <div className="relative flex items-center gap-1">
                      <span className="text-5xl sm:text-6xl drop-shadow-[0_8px_16px_rgba(0,0,0,0.6)] -rotate-12">
                        🍉
                      </span>
                      <span className="text-3xl sm:text-4xl drop-shadow-[0_8px_16px_rgba(0,0,0,0.6)] rotate-12">
                        🍍
                      </span>
                      <div className="absolute inset-x-0 top-1/2 h-1 bg-gradient-to-r from-transparent via-white to-amber-300 -rotate-12 shadow-[0_0_12px_#fff]" />
                    </div>
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1 bg-[#0d1424]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base sm:text-lg font-black text-white">Market Slash</h3>
                    <ArrowRight className="w-4 h-4 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-400 line-clamp-2">
                    Swipe to slice flying Makola fruits, build combos &amp; dodge bombs.
                  </p>
                </div>
              </div>

              {/* Card 3: Ghana Ludo */}
              <div
                onClick={() => openLaunchSheetForGame("ludo", "free_data")}
                className="group relative rounded-3xl overflow-hidden border border-white/10 bg-[#101829] hover:border-amber-400/50 transition-all cursor-pointer flex flex-col justify-between shadow-xl"
              >
                <div className="relative h-36 sm:h-44 bg-gradient-to-br from-[#3b1d5e] via-[#1e2952] to-[#0f172a] p-3 flex flex-col justify-between overflow-hidden">
                  <div className="relative z-10 flex items-center justify-between gap-1">
                    <span className="px-2.5 py-1 rounded-full bg-slate-950/75 backdrop-blur-md text-white font-black text-[10px] uppercase tracking-wider">
                      BOARD
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-[#fde08d] text-slate-950 font-black text-[10px] uppercase tracking-wider">
                      ONLINE
                    </span>
                  </div>

                  {/* 4-Color Ludo Home Bases & 3D Dice Art */}
                  <div className="relative my-auto flex items-center justify-center gap-3">
                    <div className="w-16 h-16 rounded-xl overflow-hidden grid grid-cols-2 grid-rows-2 gap-0.5 bg-white p-0.5 shadow-lg">
                      <div className="bg-red-600 rounded-tl-md" />
                      <div className="bg-emerald-600 rounded-tr-md" />
                      <div className="bg-sky-600 rounded-bl-md" />
                      <div className="bg-amber-400 rounded-br-md" />
                    </div>
                    <span className="text-4xl drop-shadow-lg -rotate-12">🎲</span>
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1 bg-[#0d1424]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base sm:text-lg font-black text-white">Ghana Ludo</h3>
                    <ArrowRight className="w-4 h-4 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-400 line-clamp-2">
                    2–4 players, step-by-step token hops, captures &amp; extra rolls.
                  </p>
                </div>
              </div>

              {/* Card 4: Ghana Dame Checkers */}
              <div
                onClick={() => openLaunchSheetForGame("dame", "free_data")}
                className="group relative rounded-3xl overflow-hidden border border-white/10 bg-[#101829] hover:border-amber-400/50 transition-all cursor-pointer flex flex-col justify-between shadow-xl"
              >
                <div className="relative h-36 sm:h-44 bg-gradient-to-br from-[#0f3d3e] via-[#134e4a] to-[#091e22] p-3 flex flex-col justify-between overflow-hidden">
                  <div className="relative z-10 flex items-center justify-between gap-1">
                    <span className="px-2.5 py-1 rounded-full bg-slate-950/75 backdrop-blur-md text-white font-black text-[10px] uppercase tracking-wider">
                      STRATEGY
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-[#fde08d] text-slate-950 font-black text-[10px] uppercase tracking-wider">
                      ONLINE
                    </span>
                  </div>

                  {/* Crowned Dame Pieces Art */}
                  <div className="relative my-auto flex items-center justify-center gap-2.5">
                    <div className="w-11 h-11 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 border-2 border-white/60 shadow-lg flex items-center justify-center">
                      <Crown className="w-5 h-5 text-slate-950" />
                    </div>
                    <div className="w-11 h-11 rounded-full bg-gradient-to-b from-rose-500 to-rose-800 border-2 border-white/40 shadow-lg flex items-center justify-center">
                      <Crown className="w-5 h-5 text-amber-200" />
                    </div>
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1 bg-[#0d1424]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base sm:text-lg font-black text-white">Ghana Dame</h3>
                    <ArrowRight className="w-4 h-4 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-400 line-clamp-2">
                    8×8 Ghanaian checkers with mandatory jumps &amp; crowned Kings.
                  </p>
                </div>
              </div>

              {/* Card 5: Candy Crash — Alewa & Kube Ghanaian Sweet Match-3 */}
              <div
                onClick={() => openLaunchSheetForGame("candy", "free_data")}
                className="group relative rounded-3xl overflow-hidden border border-white/10 bg-[#101829] hover:border-amber-400/60 transition-all cursor-pointer flex flex-col justify-between shadow-xl col-span-2 sm:col-span-2"
              >
                <div className="relative h-36 sm:h-40 bg-gradient-to-br from-[#5c260c] via-[#3b1507] to-[#1a0802] p-3.5 flex flex-col justify-between overflow-hidden">
                  {/* Subtle Kente Top Accent Strip */}
                  <div
                    className="absolute inset-x-0 top-0 h-1"
                    style={{
                      background:
                        "repeating-linear-gradient(90deg, #ef4444 0px 18px, #facc15 18px 36px, #22c55e 36px 54px, #111827 54px 60px)",
                    }}
                  />
                  <div className="relative z-10 flex items-center justify-between gap-1">
                    <span className="px-2.5 py-1 rounded-full bg-slate-950/75 backdrop-blur-md text-amber-200 font-black text-[10px] uppercase tracking-wider">
                      🇬🇭 GHANA SWEETS • MATCH-3
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 text-slate-950 font-black text-[10px] uppercase tracking-wider">
                      NEW • ALEWA &amp; KUBE
                    </span>
                  </div>

                  {/* Glossy 3D Alewa, Kube, Golden Cocoa Pod & Calabash Bomb Art */}
                  <div className="relative my-auto flex items-center justify-center gap-3">
                    <div
                      title="Alewa Swirl Toffee"
                      className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#ff9fb0] via-[#e11d48] to-[#7f1d1d] border-2 border-amber-200/60 shadow-lg flex items-center justify-center -rotate-12 relative overflow-hidden"
                    >
                      <span className="w-8 h-1.5 bg-white/80 rotate-45 block" />
                    </div>
                    <div
                      title="Takoradi Calabash Cocoa Bomb"
                      className="w-12 h-12 rounded-full bg-gradient-to-br from-[#a16207] via-[#451a03] to-[#1c0a00] border-2 border-amber-300 shadow-[0_0_20px_rgba(251,191,36,0.5)] flex items-center justify-center relative"
                    >
                      <span className="text-xl">🍫</span>
                    </div>
                    <div
                      title="Nkate Groundnut Brittle"
                      className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#bbf7d0] via-[#16a34a] to-[#14532d] border-2 border-amber-200/60 shadow-lg flex items-center justify-center rotate-12"
                    >
                      <span className="text-sm font-black text-amber-200">🥜</span>
                    </div>
                    <div
                      title="Golden Ghana Cocoa Pod"
                      className="w-11 h-11 rounded-full bg-gradient-to-br from-[#fef9c3] via-[#eab308] to-[#854d0e] border-2 border-amber-200/60 shadow-lg hidden sm:flex items-center justify-center -rotate-6"
                    >
                      <span className="text-sm font-black text-amber-950">★</span>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 sm:p-4 space-y-1 bg-[#0d1424]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base sm:text-lg font-black text-white">
                      Candy Crash • Alewa &amp; Kube
                    </h3>
                    <ArrowRight className="w-4 h-4 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-400 line-clamp-2">
                    Match 3+ Ghanaian Alewa, Kube &amp; Golden Cocoa Pods, forge Kente Boosters &amp; Calabash Bombs across Makola &amp; Kejetia.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 6. Compact Open Friend Challenges Strip (If Any Open Rooms Exist) */}
          {openChallenges.length > 0 && (
            <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.03] border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" /> Open Friend Challenges ({openChallenges.length})
                </span>
                <button
                  type="button"
                  onClick={() => fetchLobby()}
                  className="text-xs font-bold text-slate-400 hover:text-white flex items-center gap-1"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>

              <div className="space-y-2">
                {openChallenges.slice(0, 4).map((chal) => {
                  const isMine = user && chal.creator_id === user.id;
                  const stake = Number(chal.stake_amount || 0);
                  return (
                    <div
                      key={chal.id}
                      className="p-3 rounded-2xl bg-slate-950/80 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-2.5">
                        <Badge className="bg-amber-500 text-slate-950 font-black text-[10px] uppercase">
                          {chal.game_type}
                        </Badge>
                        <div>
                          <p className="text-xs font-black text-white">
                            {chal.creator_name}{" "}
                            <span className="text-slate-400 font-mono">#{chal.room_code}</span>
                          </p>
                          <p className="text-[11px] text-emerald-400 font-mono">
                            Stake: GH₵ {stake.toFixed(2)} • Winner Takes GH₵{" "}
                            {Number(chal.prize_pool || 0).toFixed(2)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isMine ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setMySide("creator");
                              setActiveChallenge(chal);
                            }}
                            className="h-8 rounded-full border-amber-400/40 text-amber-300 text-xs font-bold"
                          >
                            Open Room
                          </Button>
                        ) : (
                          <>
                            {user && (
                              <Button
                                size="sm"
                                disabled={joiningChallengeId === chal.id}
                                onClick={() => handleJoinChallenge(chal, "wallet")}
                                className="h-8 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs px-3.5"
                              >
                                Accept (Wallet)
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={joiningChallengeId === chal.id}
                              onClick={() => handleJoinChallenge(chal, "momo")}
                              className="h-8 rounded-full border-amber-500/40 text-amber-300 font-black text-xs px-3.5"
                            >
                              Accept (MoMo)
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
