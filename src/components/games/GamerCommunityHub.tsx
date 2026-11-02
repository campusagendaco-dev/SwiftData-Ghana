import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { safeRemoveChannel } from "@/lib/safe-realtime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MessageSquare,
  Users,
  Send,
  Swords,
  Sparkles,
  Trophy,
  Search,
  Radio,
  ArrowRight,
  X,
  RefreshCw,
  Loader2,
  Hash,
  UserPlus,
} from "lucide-react";
import {
  playTurnNotificationSound,
  triggerHapticSensor,
} from "@/lib/game-sensory-engine";
import { VerifiedGamerAvatar, DailyStoriesBar } from "./DailyStoriesBar";

export type CommunityGameType =
  | "oware"
  | "pool"
  | "ludo"
  | "dame"
  | "slash"
  | "candy";

export interface CommunityChatMessage {
  id: string;
  channel: string;
  sender_id?: string | null;
  sender_name: string;
  sender_phone_masked?: string | null;
  avatar_id?: string | null;
  sender_level: number;
  sender_title: string;
  favorite_game: string;
  message_type: "chat" | "challenge_card" | "direct_invite" | "victory_shoutout";
  message: string;
  challenge_id?: string | null;
  room_code?: string | null;
  game_type?: string | null;
  stake_amount?: number;
  prize_pool?: number;
  target_user_id?: string | null;
  target_user_name?: string | null;
  reactions?: Record<string, number>;
  created_at: string;
}

export interface CommunityGamerProfile {
  player_key: string;
  user_id?: string | null;
  display_name: string;
  masked_phone?: string;
  raw_phone?: string;
  avatar_id?: string | null;
  player_level: number;
  player_title: string;
  favorite_game: string;
  status: "online" | "looking_for_match" | "in_match";
  is_online_now?: boolean;
  active_room_code?: string | null;
  last_seen_at: string;
}

const GAME_LABELS: Record<
  string,
  { name: string; emoji: string; badgeClass: string }
> = {
  oware: {
    name: "Ghana Oware",
    emoji: "🪨",
    badgeClass: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  },
  pool: {
    name: "8-Ball Pool",
    emoji: "🎱",
    badgeClass: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  },
  ludo: {
    name: "Ghana Ludo",
    emoji: "🎲",
    badgeClass: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  },
  dame: {
    name: "Ghana Dame",
    emoji: "♟️",
    badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  },
  slash: {
    name: "Market Slash",
    emoji: "🍉",
    badgeClass: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  },
  candy: {
    name: "Alewa & Kube",
    emoji: "🍬",
    badgeClass: "bg-pink-500/20 text-pink-300 border-pink-500/40",
  },
  buggy: {
    name: "Labadi Buggy GP",
    emoji: "🏎️",
    badgeClass: "bg-red-500/20 text-red-300 border-red-500/40",
  },
};

const QUICK_BANTER_CHIPS = [
  "🪨 Who is ready for an Oware duel?",
  "🎱 Join my 8-Ball Pool table right now!",
  "🏎️ Labadi Beach Buggy 3-Lap GP — who fits beat my time?",
  "🎲 Ludo 4-Player room open — step up!",
  "🍬 Alewa & Kube high-score race, who fits beat me?",
  "🔥 Chale, sharp game! Rematch?",
  "⚔️ Looking for a serious challenger!",
];

const REACTION_EMOJIS = ["🔥", "⚔️", "👑", "🇬🇭", "😂"];

function formatRelativeTime(iso: string): string {
  if (!iso) return "just now";
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 45) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

interface GamerCommunityHubProps {
  currentUserId?: string | null;
  playerName: string;
  playerPhone: string;
  playerAvatarId?: string;
  playerLevel: number;
  playerTitle: string;
  activeRoomCode?: string | null;
  activeChallenge?: any | null;
  openChallenges?: any[];
  onJoinByRoomCode: (roomCode: string) => void;
  onJoinChallengeObject?: (challenge: any) => void;
  onQuickCreateChallenge: (
    gameType: CommunityGameType,
    invitedUser?: { user_id?: string | null; full_name: string; phone?: string } | null
  ) => void;
  onClose?: () => void;
  defaultTab?: "chat" | "gamers" | "room";
}

export function GamerCommunityHub({
  currentUserId,
  playerName,
  playerPhone,
  playerAvatarId = "royal_headband",
  playerLevel,
  playerTitle,
  activeRoomCode,
  activeChallenge,
  openChallenges = [],
  onJoinByRoomCode,
  onJoinChallengeObject,
  onQuickCreateChallenge,
  onClose,
  defaultTab = "chat",
}: GamerCommunityHubProps) {
  const [activeTab, setActiveTab] = useState<"chat" | "gamers" | "room">(
    activeRoomCode && defaultTab === "room" ? "room" : defaultTab
  );
  const [messages, setMessages] = useState<CommunityChatMessage[]>([]);
  const [gamers, setGamers] = useState<CommunityGamerProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);
  const [chatInput, setChatInput] = useState<string>("");
  const [gamerSearch, setGamerSearch] = useState<string>("");
  const [onlyLookingForMatch, setOnlyLookingForMatch] = useState<boolean>(false);
  const [myStatus, setMyStatus] = useState<"online" | "looking_for_match">(
    "looking_for_match"
  );
  const [myFavoriteGame, setMyFavoriteGame] = useState<CommunityGameType>("oware");
  const [showDropChallengePicker, setShowDropChallengePicker] =
    useState<boolean>(false);
  const [challengingGamer, setChallengingGamer] =
    useState<CommunityGamerProfile | null>(null);
  const [taggedTargetUser, setTaggedTargetUser] = useState<{
    user_id?: string | null;
    name: string;
  } | null>(null);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const fetchCommunityHub = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("challenge-arena", {
          body: {
            action: "get_community_hub",
            room_code: activeRoomCode || undefined,
          },
        });
        if (!error && data?.success) {
          setMessages(data.messages || []);
          setGamers(data.gamers || []);
        }
      } catch (err) {
        console.warn("[GamerCommunityHub] Fetch warning:", err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [activeRoomCode]
  );

  const sendPresenceHeartbeat = useCallback(
    async (nextStatus?: "online" | "looking_for_match" | "in_match", nextFav?: CommunityGameType) => {
      try {
        await supabase.functions.invoke("challenge-arena", {
          body: {
            action: "heartbeat_presence",
            display_name: playerName || "Ghana Champion",
            phone: playerPhone || "",
            avatar_id: playerAvatarId,
            player_level: playerLevel,
            player_title: playerTitle,
            favorite_game: nextFav || myFavoriteGame,
            status: activeRoomCode ? "in_match" : nextStatus || myStatus,
            active_room_code: activeRoomCode || null,
          },
        });
      } catch {
        // ignore heartbeat network blip
      }
    },
    [activeRoomCode, myFavoriteGame, myStatus, playerAvatarId, playerLevel, playerName, playerPhone, playerTitle]
  );

  useEffect(() => {
    fetchCommunityHub(false);
    sendPresenceHeartbeat();
    const interval = window.setInterval(() => {
      fetchCommunityHub(true);
    }, 12000);
    return () => window.clearInterval(interval);
  }, [fetchCommunityHub, sendPresenceHeartbeat]);

  // Realtime subscription to `game_community_messages` and `game_community_presence`
  useEffect(() => {
    const uid = `${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;
    let msgChannel: ReturnType<typeof supabase.channel> | null = null;
    let presChannel: ReturnType<typeof supabase.channel> | null = null;

    try {
      msgChannel = supabase
        .channel(`arena-community-msgs-${activeRoomCode || "global"}-${uid}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "game_community_messages",
          },
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              const incoming = payload.new as CommunityChatMessage;
              setMessages((prev) => {
                if (prev.some((m) => m.id === incoming.id)) return prev;
                return [...prev, incoming];
              });
              if (incoming.sender_name !== playerName) {
                playTurnNotificationSound(false);
              }
            } else if (payload.eventType === "UPDATE" && payload.new) {
              const updated = payload.new as CommunityChatMessage;
              setMessages((prev) =>
                prev.map((m) => (m.id === updated.id ? updated : m))
              );
            }
          }
        )
        .subscribe();
    } catch {
      // ignore realtime channel collision
    }

    try {
      presChannel = supabase
        .channel(`arena-community-presence-${uid}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "game_community_presence",
          },
          () => {
            fetchCommunityHub(true);
          }
        )
        .subscribe();
    } catch {
      // ignore realtime channel collision
    }

    return () => {
      safeRemoveChannel(msgChannel);
      safeRemoveChannel(presChannel);
    };
  }, [activeRoomCode, fetchCommunityHub, playerName]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages.length, activeTab]);

  const activeChannel =
    activeTab === "room" && activeRoomCode
      ? `room:${activeRoomCode.toUpperCase()}`
      : "global";

  const visibleMessages = messages.filter((m) =>
    activeTab === "room" && activeRoomCode
      ? m.channel === `room:${activeRoomCode.toUpperCase()}`
      : m.channel === "global"
  );

  const handleSendMessage = async (
    customText?: string,
    opts?: {
      messageType?: "chat" | "challenge_card" | "direct_invite";
      challenge?: any;
      targetUser?: { user_id?: string | null; name: string } | null;
    }
  ) => {
    const textToSend = (customText ?? chatInput).trim();
    if (!textToSend || sending) return;

    setSending(true);
    if (!customText) setChatInput("");

    const effectiveTarget = opts?.targetUser || taggedTargetUser;
    const attachedChallenge = opts?.challenge || null;

    // Optimistic message insert so chat feels instantaneous
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: CommunityChatMessage = {
      id: tempId,
      channel: activeChannel,
      sender_id: currentUserId || null,
      sender_name: playerName || "Ghana Champion",
      avatar_id: playerAvatarId,
      sender_level: playerLevel,
      sender_title: playerTitle,
      favorite_game: myFavoriteGame,
      message_type:
        opts?.messageType ||
        (effectiveTarget ? "direct_invite" : "chat"),
      message: textToSend,
      challenge_id: attachedChallenge?.id || null,
      room_code: attachedChallenge?.room_code || null,
      game_type: attachedChallenge?.game_type || myFavoriteGame,
      stake_amount: Number(attachedChallenge?.stake_amount || 0),
      prize_pool: Number(attachedChallenge?.prize_pool || 0),
      target_user_id: effectiveTarget?.user_id || null,
      target_user_name: effectiveTarget?.name || null,
      reactions: {},
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setTaggedTargetUser(null);
    triggerHapticSensor("aim_tick");

    try {
      const { data } = await supabase.functions.invoke("challenge-arena", {
        body: {
          action: "send_community_message",
          channel: activeChannel,
          sender_name: playerName || "Ghana Champion",
          sender_phone: playerPhone || "",
          avatar_id: playerAvatarId,
          sender_level: playerLevel,
          sender_title: playerTitle,
          favorite_game: myFavoriteGame,
          message_type: optimisticMsg.message_type,
          message: textToSend,
          challenge_id: attachedChallenge?.id || null,
          room_code: attachedChallenge?.room_code || null,
          game_type: attachedChallenge?.game_type || myFavoriteGame,
          stake_amount: Number(attachedChallenge?.stake_amount || 0),
          prize_pool: Number(attachedChallenge?.prize_pool || 0),
          target_user_id: effectiveTarget?.user_id || null,
          target_user_name: effectiveTarget?.name || null,
        },
      });

      if (data?.success && data?.message_row) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? data.message_row : m))
        );
      }
    } catch (err) {
      console.warn("[GamerCommunityHub] Send message error:", err);
    } finally {
      setSending(false);
    }
  };

  const handleReactMessage = async (messageId: string, emoji: string) => {
    if (messageId.startsWith("temp-")) return;
    triggerHapticSensor("aim_tick");

    // Optimistic reaction bump
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const nextReactions = { ...(m.reactions || {}) };
        nextReactions[emoji] = Number(nextReactions[emoji] || 0) + 1;
        return { ...m, reactions: nextReactions };
      })
    );

    try {
      await supabase.functions.invoke("challenge-arena", {
        body: {
          action: "react_community_message",
          message_id: messageId,
          emoji,
        },
      });
    } catch {
      // ignore
    }
  };

  const handleShareActiveRoomToChat = async () => {
    if (!activeChallenge) return;
    const gInfo = GAME_LABELS[activeChallenge.game_type] || GAME_LABELS.oware;
    const stake = Number(activeChallenge.stake_amount || 0);
    const pot = Number(activeChallenge.prize_pool || 0);
    const text =
      stake > 0
        ? `${gInfo.emoji} Join my live ${gInfo.name} Room #${activeChallenge.room_code}! Stake GH₵ ${stake.toFixed(2)} • Winner Takes GH₵ ${pot.toFixed(2)}!`
        : `${gInfo.emoji} Join my ${gInfo.name} Room #${activeChallenge.room_code}! Free skill duel — tap Accept to play me live!`;

    setActiveTab("chat");
    await handleSendMessage(text, {
      messageType: "challenge_card",
      challenge: activeChallenge,
    });
  };

  const filteredGamers = gamers.filter((g) => {
    if (onlyLookingForMatch && g.status !== "looking_for_match") return false;
    if (!gamerSearch.trim()) return true;
    const q = gamerSearch.toLowerCase();
    return (
      g.display_name.toLowerCase().includes(q) ||
      (g.masked_phone || "").toLowerCase().includes(q) ||
      (g.favorite_game || "").toLowerCase().includes(q)
    );
  });

  const lookingForMatchCount = gamers.filter(
    (g) => g.status === "looking_for_match"
  ).length;

  return (
    <div className="flex flex-col h-full max-h-[82vh] bg-[#0a0f1c] text-white rounded-3xl border border-white/15 shadow-[0_25px_70px_rgba(0,0,0,0.85)] overflow-hidden">
      {/* ── Top Hub Header ── */}
      <div className="px-4 py-3 bg-gradient-to-r from-[#131c33] via-[#0f172a] to-[#1e1533] border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 text-slate-950 flex items-center justify-center shadow-lg shrink-0">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm sm:text-base font-black text-white truncate">
                Gamer Community &amp; Challenge Hub
              </h3>
              <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-black px-2 py-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping mr-1 inline-block" />
                {Math.max(1, gamers.length)} Online
              </Badge>
            </div>
            <p className="text-[11px] text-slate-400 truncate">
              Chat live, meet Ghana gamers &amp; drop 1-tap challenge rooms
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => fetchCommunityHub(false)}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white cursor-pointer"
            title="Refresh Community Feed"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white cursor-pointer"
              title="Close Hub"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Navigation Tabs: Arena Lounge | Meet Gamers | Room Chat ── */}
      <div className="px-3 pt-2.5 pb-2 bg-[#0c1324] border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 flex-1">
          <button
            type="button"
            onClick={() => setActiveTab("chat")}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "chat"
                ? "bg-amber-500 text-slate-950 shadow"
                : "bg-white/[0.04] text-slate-300 hover:text-white"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Arena Chat</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("gamers")}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "gamers"
                ? "bg-amber-500 text-slate-950 shadow"
                : "bg-white/[0.04] text-slate-300 hover:text-white"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Meet Gamers</span>
            {lookingForMatchCount > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[9px] font-black ${
                  activeTab === "gamers"
                    ? "bg-slate-950 text-amber-300"
                    : "bg-emerald-500 text-slate-950"
                }`}
              >
                {lookingForMatchCount}
              </span>
            )}
          </button>

          {activeRoomCode && (
            <button
              type="button"
              onClick={() => setActiveTab("room")}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === "room"
                  ? "bg-emerald-500 text-slate-950 shadow"
                  : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
              }`}
            >
              <Hash className="w-3.5 h-3.5" />
              <span>Room #{activeRoomCode}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Player Status & Quick Challenge Bar ── */}
      <div className="px-3 py-2 bg-[#0e1629] border-b border-white/10 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const next =
                myStatus === "looking_for_match" ? "online" : "looking_for_match";
              setMyStatus(next);
              sendPresenceHeartbeat(next, myFavoriteGame);
              triggerHapticSensor("aim_tick");
            }}
            className={`px-2.5 py-1 rounded-full text-[10px] font-black border flex items-center gap-1.5 cursor-pointer transition-all ${
              myStatus === "looking_for_match"
                ? "bg-emerald-500/20 border-emerald-400 text-emerald-300"
                : "bg-white/5 border-white/15 text-slate-300"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                myStatus === "looking_for_match"
                  ? "bg-emerald-400 animate-ping"
                  : "bg-slate-400"
              }`}
            />
            {myStatus === "looking_for_match"
              ? "🟢 Ready for Challenges"
              : "⚡ Online"}
          </button>

          <select
            value={myFavoriteGame}
            onChange={(e) => {
              const nextGame = e.target.value as CommunityGameType;
              setMyFavoriteGame(nextGame);
              sendPresenceHeartbeat(myStatus, nextGame);
            }}
            className="h-6 rounded-full bg-slate-950 border border-white/15 px-2 text-[10px] font-bold text-amber-300 focus:outline-none"
            title="Your Favorite Game Badge"
          >
            {Object.entries(GAME_LABELS).map(([key, g]) => (
              <option key={key} value={key}>
                {g.emoji} Main: {g.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          {activeChallenge && activeChallenge.status === "open" && (
            <Button
              type="button"
              size="sm"
              onClick={handleShareActiveRoomToChat}
              className="h-7 px-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-[10px] gap-1"
            >
              <Sparkles className="w-3 h-3" />
              Share Room #{activeChallenge.room_code}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => setShowDropChallengePicker((v) => !v)}
            className="h-7 px-3 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-black text-[10px] gap-1 shadow"
          >
            <Swords className="w-3 h-3" />
            Post Challenge in Chat
          </Button>
        </div>
      </div>

      {/* ── Expandable 1-Tap "Post Challenge in Chat" Game Picker ── */}
      {showDropChallengePicker && (
        <div className="p-3 bg-gradient-to-r from-amber-950/60 via-slate-900 to-rose-950/50 border-b border-amber-500/40 space-y-2 shrink-0 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-amber-300 flex items-center gap-1.5">
              <Swords className="w-3.5 h-3.5" /> Pick a Game to Create &amp; Drop into Chat:
            </span>
            <button
              type="button"
              onClick={() => setShowDropChallengePicker(false)}
              className="text-[11px] text-slate-400 hover:text-white"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            {(Object.keys(GAME_LABELS) as CommunityGameType[]).map((gKey) => {
              const g = GAME_LABELS[gKey];
              return (
                <button
                  key={gKey}
                  type="button"
                  onClick={() => {
                    setShowDropChallengePicker(false);
                    onQuickCreateChallenge(gKey, null);
                  }}
                  className="p-2 rounded-xl bg-slate-950/90 hover:bg-amber-500/20 border border-white/10 hover:border-amber-400/60 flex flex-col items-center gap-1 text-center transition-all cursor-pointer"
                >
                  <span className="text-lg">{g.emoji}</span>
                  <span className="text-[10px] font-black text-white leading-tight">
                    {g.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Daily Life Stories Strip Inside Community Hub ── */}
      <div className="px-3 py-2 bg-[#0b1120] border-b border-white/10 shrink-0">
        <DailyStoriesBar
          currentUserId={currentUserId}
          playerName={playerName}
          playerPhone={playerPhone}
          playerAvatarId={playerAvatarId}
          playerLevel={playerLevel}
          playerTitle={playerTitle}
          favoriteGame={myFavoriteGame}
          activeRoomCode={activeRoomCode}
          onJoinRoomCode={onJoinByRoomCode}
          onChallengeStoryAuthor={(author) => {
            onQuickCreateChallenge(
              (author.favorite_game as CommunityGameType) || "oware",
              {
                user_id: author.user_id,
                full_name: author.display_name,
              }
            );
          }}
        />
      </div>

      {/* ── TAB 1 & TAB 3: LIVE CHAT STREAM (GLOBAL LOUNGE OR MATCH ROOM CHAT) ── */}
      {(activeTab === "chat" || activeTab === "room") && (
        <>
          {/* Pinned Open Challenges Strip inside Chat */}
          {activeTab === "chat" && openChallenges.length > 0 && (
            <div className="px-3 py-2 bg-emerald-950/35 border-b border-emerald-500/30 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
              <Badge className="bg-emerald-500 text-slate-950 font-black text-[9px] shrink-0">
                🟢 {openChallenges.length} OPEN ROOMS
              </Badge>
              {openChallenges.slice(0, 4).map((c) => {
                const g = GAME_LABELS[c.game_type] || GAME_LABELS.oware;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      onJoinChallengeObject
                        ? onJoinChallengeObject(c)
                        : onJoinByRoomCode(c.room_code)
                    }
                    className="px-2.5 py-1 rounded-full bg-slate-950/90 hover:bg-emerald-500/20 border border-emerald-400/40 text-[10px] font-bold text-white flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <span>{g.emoji}</span>
                    <span>{c.creator_name}</span>
                    <span className="text-amber-300 font-mono">#{c.room_code}</span>
                    <span className="text-emerald-300 font-black">Join →</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Scrollable Chat Messages Area */}
          <div
            ref={chatScrollRef}
            className="flex-1 min-h-[260px] overflow-y-auto p-3 space-y-3"
          >
            {loading && visibleMessages.length === 0 ? (
              <div className="h-48 flex flex-col items-center justify-center text-slate-400 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
                <span className="text-xs font-bold">
                  Connecting to Ghana Gamer Chat Lounge…
                </span>
              </div>
            ) : visibleMessages.length === 0 ? (
              <div className="p-6 rounded-2xl border border-dashed border-white/10 text-center space-y-2 my-6">
                <p className="text-sm font-black text-amber-300">
                  {activeTab === "room"
                    ? `Room #${activeRoomCode} Chat is Live!`
                    : "Welcome to the SwiftData Gamer Lounge! 🇬🇭"}
                </p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Say hello, tap a quick banter chip below, or drop a challenge card to invite anyone online to an instant duel.
                </p>
              </div>
            ) : (
              visibleMessages.map((msg) => {
                const isMe =
                  (currentUserId && msg.sender_id === currentUserId) ||
                  msg.sender_name.toLowerCase() === playerName.toLowerCase();
                const gMeta =
                  GAME_LABELS[msg.game_type || msg.favorite_game || "oware"] ||
                  GAME_LABELS.oware;
                const isChallengeCard =
                  msg.message_type === "challenge_card" ||
                  msg.message_type === "direct_invite";
                const isVictory = msg.message_type === "victory_shoutout";
                const matchingOpenChallenge = msg.room_code
                  ? openChallenges.find(
                      (c) =>
                        String(c.room_code || "").toUpperCase() ===
                        String(msg.room_code || "").toUpperCase()
                    )
                  : null;

                if (isVictory) {
                  return (
                    <div
                      key={msg.id}
                      className="p-3 rounded-2xl bg-gradient-to-r from-amber-500/20 via-emerald-500/15 to-amber-500/20 border border-amber-400/40 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-black shrink-0">
                          <Trophy className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-amber-200">
                            {msg.message}
                          </p>
                          <span className="text-[10px] text-slate-400">
                            {formatRelativeTime(msg.created_at)}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleReactMessage(msg.id, "👑")}
                        className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-xs font-black text-amber-300 shrink-0 cursor-pointer"
                      >
                        👑 {Number(msg.reactions?.["👑"] || 0) || ""}
                      </button>
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      isMe ? "items-end" : "items-start"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 px-1">
                      <VerifiedGamerAvatar
                        avatarId={msg.avatar_id}
                        seedName={msg.sender_name}
                        size={26}
                        showVerifiedBadge={true}
                      />
                      <span className="text-[11px] font-black text-white">
                        {msg.sender_name}
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-amber-500/20 border border-amber-500/40 text-[9px] font-black text-amber-300">
                        Lv.{msg.sender_level || 1}
                      </span>
                      <span className="text-[10px]" title={`Plays ${gMeta.name}`}>
                        {gMeta.emoji}
                      </span>
                      <span className="text-[9px] text-slate-500">
                        {formatRelativeTime(msg.created_at)}
                      </span>
                      {!isMe && (
                        <button
                          type="button"
                          onClick={() => {
                            setTaggedTargetUser({
                              user_id: msg.sender_id,
                              name: msg.sender_name,
                            });
                            setChatInput(`@${msg.sender_name} `);
                          }}
                          className="text-[9px] font-bold text-amber-400 hover:underline ml-1 cursor-pointer"
                        >
                          Reply / Challenge
                        </button>
                      )}
                    </div>

                    <div
                      className={`max-w-[90%] sm:max-w-[82%] rounded-2xl p-3 space-y-2 ${
                        isChallengeCard
                          ? "bg-gradient-to-br from-[#1e293b] via-[#172033] to-[#2e1065]/60 border-2 border-amber-400/60 shadow-lg"
                          : isMe
                          ? "bg-gradient-to-r from-amber-500/25 to-orange-500/20 border border-amber-400/40 text-white"
                          : "bg-white/[0.06] border border-white/10 text-slate-100"
                      }`}
                    >
                      {msg.target_user_name && (
                        <Badge className="bg-rose-500/20 text-rose-300 border border-rose-400/40 text-[9px] font-black">
                          🎯 Direct Callout to @{msg.target_user_name}
                        </Badge>
                      )}

                      <p className="text-xs sm:text-sm leading-relaxed break-words">
                        {msg.message}
                      </p>

                      {/* Embedded Interactive Challenge Card inside Chat Bubble */}
                      {msg.room_code && (
                        <div className="p-2.5 rounded-xl bg-slate-950/90 border border-amber-400/40 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{gMeta.emoji}</span>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-black text-white">
                                  {gMeta.name}
                                </span>
                                <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono text-[9px]">
                                  #{msg.room_code}
                                </Badge>
                              </div>
                              <p className="text-[10px] text-emerald-300 font-bold">
                                {Number(msg.stake_amount || 0) > 0
                                  ? `Stake: GH₵ ${Number(msg.stake_amount).toFixed(
                                      2
                                    )} • Pot: GH₵ ${Number(msg.prize_pool || 0).toFixed(2)}`
                                  : "🎁 Free Skill Duel • Earn Arena Data Points"}
                              </p>
                            </div>
                          </div>

                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              if (matchingOpenChallenge && onJoinChallengeObject) {
                                onJoinChallengeObject(matchingOpenChallenge);
                              } else if (msg.room_code) {
                                onJoinByRoomCode(msg.room_code);
                              }
                            }}
                            className="h-8 px-3.5 rounded-xl bg-[#f59e0b] hover:bg-[#fbbf24] text-slate-950 font-black text-xs gap-1 shadow"
                          >
                            <span>Accept &amp; Play</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}

                      {/* Emoji Reaction Row */}
                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        {REACTION_EMOJIS.map((emo) => {
                          const count = Number(msg.reactions?.[emo] || 0);
                          return (
                            <button
                              key={emo}
                              type="button"
                              onClick={() => handleReactMessage(msg.id, emo)}
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all cursor-pointer ${
                                count > 0
                                  ? "bg-amber-500/20 border border-amber-400/40 text-amber-200"
                                  : "bg-white/[0.04] hover:bg-white/10 text-slate-400"
                              }`}
                            >
                              {emo} {count > 0 ? count : ""}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Quick Ghanaian Banter Chips + Chat Input Box */}
          <div className="p-2.5 bg-[#0c1324] border-t border-white/10 space-y-2 shrink-0">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
              {QUICK_BANTER_CHIPS.map((chip, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSendMessage(chip)}
                  className="px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-amber-500/20 border border-white/10 hover:border-amber-400/40 text-[10px] font-bold text-slate-200 whitespace-nowrap transition-all cursor-pointer shrink-0"
                >
                  {chip}
                </button>
              ))}
            </div>

            {taggedTargetUser && (
              <div className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-400/40 text-[11px] text-amber-200">
                <span>
                  🎯 Tagging <strong>@{taggedTargetUser.name}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setTaggedTargetUser(null)}
                  className="text-xs text-slate-300 hover:text-white"
                >
                  ×
                </button>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-2"
            >
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={
                  activeTab === "room"
                    ? `Message Room #${activeRoomCode}…`
                    : `Chat as ${playerName || "Ghana Champion"} or @tag a player…`
                }
                className="h-10 flex-1 rounded-2xl bg-slate-950 border-white/15 text-xs text-white"
              />
              <Button
                type="submit"
                disabled={sending || !chatInput.trim()}
                className="h-10 px-4 rounded-2xl bg-[#f59e0b] hover:bg-[#fbbf24] text-slate-950 font-black text-xs gap-1.5 shrink-0"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </>
                )}
              </Button>
            </form>
          </div>
        </>
      )}

      {/* ── TAB 2: MEET GAMERS & 1-TAP DIRECT CHALLENGE DIRECTORY ── */}
      {activeTab === "gamers" && (
        <div className="flex-1 flex flex-col min-h-[280px] overflow-hidden">
          {/* Search & Filter Bar */}
          <div className="p-3 bg-[#0e1629] border-b border-white/10 flex flex-wrap items-center gap-2 shrink-0">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
              <Input
                value={gamerSearch}
                onChange={(e) => setGamerSearch(e.target.value)}
                placeholder="Search gamer by name, game or phone…"
                className="h-9 pl-8 rounded-xl bg-slate-950 border-white/15 text-xs text-white"
              />
            </div>
            <button
              type="button"
              onClick={() => setOnlyLookingForMatch((v) => !v)}
              className={`h-9 px-3 rounded-xl border text-xs font-black flex items-center gap-1.5 cursor-pointer ${
                onlyLookingForMatch
                  ? "bg-emerald-500 text-slate-950 border-emerald-400"
                  : "bg-slate-950 border-white/15 text-slate-300"
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              Ready for Duel ({lookingForMatchCount})
            </button>
          </div>

          {/* Inline 1-Tap Game Picker when challenging a specific gamer */}
          {challengingGamer && (
            <div className="p-3 bg-gradient-to-r from-amber-500/20 via-slate-900 to-emerald-500/20 border-b border-amber-400/50 space-y-2 shrink-0 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black text-amber-300">
                  ⚔️ Pick a Game to Challenge{" "}
                  <span className="text-white">{challengingGamer.display_name}</span>:
                </p>
                <button
                  type="button"
                  onClick={() => setChallengingGamer(null)}
                  className="text-xs text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {(Object.keys(GAME_LABELS) as CommunityGameType[]).map((gKey) => {
                  const g = GAME_LABELS[gKey];
                  return (
                    <button
                      key={gKey}
                      type="button"
                      onClick={() => {
                        const target = challengingGamer;
                        setChallengingGamer(null);
                        onQuickCreateChallenge(gKey, {
                          user_id: target.user_id,
                          full_name: target.display_name,
                          phone: target.raw_phone,
                        });
                      }}
                      className="p-2 rounded-xl bg-slate-950 hover:bg-amber-500/25 border border-white/15 hover:border-amber-400 flex flex-col items-center gap-1 text-center cursor-pointer"
                    >
                      <span className="text-lg">{g.emoji}</span>
                      <span className="text-[10px] font-black text-white">
                        {g.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Gamers Directory List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredGamers.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No gamers matched your search filter.
              </div>
            ) : (
              filteredGamers.map((gamer) => {
                const fav =
                  GAME_LABELS[gamer.favorite_game] || GAME_LABELS.oware;
                const isLooking = gamer.status === "looking_for_match";
                return (
                  <div
                    key={gamer.player_key}
                    className="p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 flex flex-wrap items-center justify-between gap-2.5 transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative">
                        <VerifiedGamerAvatar
                          avatarId={gamer.avatar_id}
                          seedName={gamer.display_name}
                          size={44}
                          showVerifiedBadge={true}
                        />
                        <span
                          className={`w-3 h-3 rounded-full border-2 border-[#0a0f1c] absolute -top-0.5 -left-0.5 ${
                            isLooking
                              ? "bg-emerald-400"
                              : gamer.is_online_now
                              ? "bg-amber-400"
                              : "bg-slate-500"
                          }`}
                        />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs sm:text-sm font-black text-white truncate">
                            {gamer.display_name}
                          </span>
                          <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-black px-1.5 py-0">
                            Lv.{gamer.player_level}
                          </Badge>
                          <Badge
                            className={`border text-[9px] font-bold px-1.5 py-0 ${fav.badgeClass}`}
                          >
                            {fav.emoji} {fav.name}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                          <span
                            className={
                              isLooking
                                ? "text-emerald-300 font-bold"
                                : "text-slate-400"
                            }
                          >
                            {isLooking
                              ? "🟢 Ready for Challenge"
                              : gamer.active_room_code
                              ? `🎮 In Room #${gamer.active_room_code}`
                              : "⚡ Community Member"}
                          </span>
                          {gamer.masked_phone && (
                            <span>• {gamer.masked_phone}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {gamer.active_room_code && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() =>
                            onJoinByRoomCode(String(gamer.active_room_code))
                          }
                          className="h-8 px-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-[10px]"
                        >
                          Join #{gamer.active_room_code}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setTaggedTargetUser({
                            user_id: gamer.user_id,
                            name: gamer.display_name,
                          });
                          setChatInput(
                            `@${gamer.display_name} Chale, let's play ${fav.name}! `
                          );
                          setActiveTab("chat");
                        }}
                        className="h-8 px-2.5 rounded-xl border-white/15 bg-white/5 hover:bg-white/10 text-slate-200 font-bold text-[10px]"
                      >
                        👋 @Tag
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          playTurnNotificationSound(true);
                          setChallengingGamer(gamer);
                        }}
                        className="h-8 px-3 rounded-xl bg-[#f59e0b] hover:bg-[#fbbf24] text-slate-950 font-black text-[10px] gap-1"
                      >
                        <Swords className="w-3 h-3" />
                        Challenge
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact Live Community Hub & Chat Preview Card for the Main Challenge Arena Lobby
 */
export function GamerCommunityPreviewCard({
  onOpenChat,
  onOpenMeetGamers,
  onJoinByRoomCode,
}: {
  onOpenChat: () => void;
  onOpenMeetGamers: () => void;
  onJoinByRoomCode: (roomCode: string) => void;
}) {
  const [recentMessages, setRecentMessages] = useState<CommunityChatMessage[]>([]);
  const [onlineGamers, setOnlineGamers] = useState<CommunityGamerProfile[]>([]);

  const loadPreview = useCallback(async () => {
    try {
      const { data } = await supabase.functions.invoke("challenge-arena", {
        body: { action: "get_community_hub" },
      });
      if (data?.success) {
        setRecentMessages((data.messages || []).slice(-2));
        setOnlineGamers((data.gamers || []).slice(0, 6));
      }
    } catch {
      // ignore preview error
    }
  }, []);

  useEffect(() => {
    loadPreview();
    const uid = `${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;
    let previewChannel: ReturnType<typeof supabase.channel> | null = null;
    try {
      previewChannel = supabase
        .channel(`lobby-community-preview-${uid}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "game_community_messages",
          },
          (payload: any) => {
            if (payload.new) {
              setRecentMessages((prev) => [...prev.slice(-1), payload.new]);
            }
          }
        )
        .subscribe();
    } catch {
      // ignore realtime channel collision
    }
    return () => safeRemoveChannel(previewChannel);
  }, [loadPreview]);

  return (
    <div className="rounded-3xl p-4 sm:p-5 bg-gradient-to-br from-[#131c33] via-[#0e1526] to-[#1d1236] border border-amber-500/35 shadow-xl space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950 flex items-center justify-center shadow-lg">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-black text-white">
                Gamer Chat &amp; Community Hub
              </h3>
              <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-black">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping mr-1 inline-block" />
                {Math.max(4, onlineGamers.length)} Active
              </Badge>
            </div>
            <p className="text-xs text-slate-300">
              Meet players, chat live &amp; drop 1-tap challenge rooms
            </p>
          </div>
        </div>

        {/* Avatar Stack of Online Gamers */}
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {onlineGamers.slice(0, 4).map((g) => (
              <div
                key={g.player_key}
                title={`${g.display_name} (Lv.${g.player_level})`}
              >
                <VerifiedGamerAvatar
                  avatarId={g.avatar_id}
                  seedName={g.display_name}
                  size={34}
                  showVerifiedBadge={true}
                />
              </div>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            onClick={onOpenChat}
            className="h-9 px-4 rounded-full bg-[#f59e0b] hover:bg-[#fbbf24] text-slate-950 font-black text-xs gap-1.5 shadow-lg"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Open Chat Hub
          </Button>
        </div>
      </div>

      {/* Latest 2 Live Community Messages / Challenge Cards */}
      {recentMessages.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {recentMessages.map((m) => (
            <div
              key={m.id}
              onClick={onOpenChat}
              className="p-2.5 rounded-2xl bg-slate-950/75 hover:bg-slate-950 border border-white/10 flex items-center justify-between gap-2 cursor-pointer transition-all"
            >
              <div className="min-w-0 flex items-center gap-2">
                <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[9px] font-black shrink-0">
                  {m.sender_name}
                </Badge>
                <p className="text-xs text-slate-200 truncate">{m.message}</p>
              </div>
              {m.room_code ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onJoinByRoomCode(String(m.room_code));
                  }}
                  className="px-2.5 py-1 rounded-full bg-emerald-500 text-slate-950 font-black text-[10px] shrink-0"
                >
                  Join #{m.room_code} →
                </button>
              ) : (
                <span className="text-[10px] text-amber-400 font-bold shrink-0">
                  Reply →
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={onOpenChat}
          className="px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-bold text-amber-300 flex items-center gap-1.5 cursor-pointer"
        >
          <span>💬</span>
          <span>Live Arena Lounge</span>
        </button>
        <button
          type="button"
          onClick={onOpenMeetGamers}
          className="px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-bold text-emerald-300 flex items-center gap-1.5 cursor-pointer"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Meet &amp; Challenge Players</span>
        </button>
      </div>
    </div>
  );
}

export default GamerCommunityHub;
