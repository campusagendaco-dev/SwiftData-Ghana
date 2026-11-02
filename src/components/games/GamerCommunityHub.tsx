import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  Trophy,
  Search,
  Radio,
  ArrowRight,
  ArrowLeft,
  X,
  RefreshCw,
  Loader2,
  Hash,
  UserPlus,
  MessageCircle,
  SendHorizontal,
  PenSquare,
  Flame,
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
  | "candy"
  | "buggy";

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
  ig_note?: string | null;
  last_seen_at: string;
}

export const GAME_LABELS: Record<
  string,
  { name: string; emoji: string; badgeClass: string }
> = {
  buggy: {
    name: "Labadi Buggy GP",
    emoji: "🏎️",
    badgeClass: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  },
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
    badgeClass: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  },
  candy: {
    name: "Alewa & Kube",
    emoji: "🍬",
    badgeClass: "bg-pink-500/20 text-pink-300 border-pink-500/40",
  },
};

const QUICK_BANTER_CHIPS = [
  "🏎️ Labadi Beach Buggy 3-Lap GP — who fits beat my time?",
  "🪨 Who is online for a live Oware duel? Text me!",
  "🎱 Join my 8-Ball Pool table right now!",
  "🎲 Ludo room open — step up!",
  "🍬 Alewa & Kube high-score race, who dey online?",
  "🔥 Chale, sharp game! Who wants next?",
];

const DM_ICEBREAKER_CHIPS = [
  "👋 Yo chale! You dey online for a quick match?",
  "🏎️ Let's race Labadi Buggy GP right now!",
  "🪨 Send me a room code for Oware 1v1!",
  "🎱 Let's run 8-Ball Pool — winner takes all!",
  "🎲 You down for Ghana Ludo?",
  "🔥 Sharp game! Let's run a rematch!",
];

const REACTION_EMOJIS = ["❤️", "🔥", "⚔️", "👑", "😂"];

function normalizeKey(raw: string): string {
  return (
    String(raw || "gamer")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 36) || "gamer"
  );
}

/**
 * Deterministic 1-on-1 DM channel between two real users.
 * Prefers sorted `user_id`s when both users are authenticated, falling back to normalized names.
 */
export function buildDmChannel(
  userA: { user_id?: string | null; name?: string | null },
  userB: { user_id?: string | null; name?: string | null }
): string {
  if (userA.user_id && userB.user_id) {
    const sortedIds = [
      normalizeKey(userA.user_id),
      normalizeKey(userB.user_id),
    ].sort();
    return `dm:${sortedIds[0]}__${sortedIds[1]}`;
  }
  const a = normalizeKey(userA.user_id || userA.name || "usera");
  const b = normalizeKey(userB.user_id || userB.name || "userb");
  const sorted = [a, b].sort();
  return `dm:${sorted[0]}__${sorted[1]}`;
}

function namesMatch(nameA?: string | null, nameB?: string | null): boolean {
  if (!nameA || !nameB) return false;
  const a = nameA.trim().toLowerCase();
  const b = nameB.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const firstA = a.split(/\s+/)[0];
  const firstB = b.split(/\s+/)[0];
  return firstA.length >= 3 && firstA === firstB;
}

function formatRelativeTime(iso: string): string {
  if (!iso) return "just now";
  const diffSec = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (diffSec < 45) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return `${Math.floor(diffSec / 86400)}d`;
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
  defaultTab?: "chat" | "dms" | "gamers" | "room";
  initialDmPartner?: CommunityGamerProfile | null;
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
  initialDmPartner = null,
}: GamerCommunityHubProps) {
  const [activeTab, setActiveTab] = useState<"chat" | "dms" | "gamers" | "room">(
    initialDmPartner
      ? "dms"
      : activeRoomCode && defaultTab === "room"
      ? "room"
      : defaultTab
  );
  const [activeDmPartner, setActiveDmPartner] =
    useState<CommunityGamerProfile | null>(initialDmPartner);
  const [messages, setMessages] = useState<CommunityChatMessage[]>([]);
  const [gamers, setGamers] = useState<CommunityGamerProfile[]>([]);
  const [searchedPlayers, setSearchedPlayers] = useState<CommunityGamerProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);
  const [chatInput, setChatInput] = useState<string>("");
  const [dmInput, setDmInput] = useState<string>("");
  const [gamerSearch, setGamerSearch] = useState<string>("");
  const [dmSearch, setDmSearch] = useState<string>("");
  const [onlyLookingForMatch, setOnlyLookingForMatch] = useState<boolean>(false);
  const [myStatus, setMyStatus] = useState<"online" | "looking_for_match">(
    "looking_for_match"
  );
  const [myFavoriteGame, setMyFavoriteGame] = useState<CommunityGameType>("buggy");
  const [myIgNote, setMyIgNote] = useState<string>(() => {
    try {
      return localStorage.getItem("swiftgram_my_ig_note") || "";
    } catch {
      return "";
    }
  });
  const [editingNote, setEditingNote] = useState<boolean>(false);
  const [showDropChallengePicker, setShowDropChallengePicker] =
    useState<boolean>(false);
  const [challengingGamer, setChallengingGamer] =
    useState<CommunityGamerProfile | null>(null);
  const [taggedTargetUser, setTaggedTargetUser] = useState<{
    user_id?: string | null;
    name: string;
  } | null>(null);
  const [partnerTypingName, setPartnerTypingName] = useState<string | null>(null);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const dmScrollRef = useRef<HTMLDivElement | null>(null);
  const feedInputRef = useRef<HTMLInputElement | null>(null);
  const broadcastChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(
    null
  );
  const typingTimeoutRef = useRef<number | null>(null);
  const lastTypingSentAtRef = useRef<number>(0);

  useEffect(() => {
    if (initialDmPartner) {
      setActiveDmPartner(initialDmPartner);
      setActiveTab("dms");
    }
  }, [initialDmPartner]);

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
    async (
      nextStatus?: "online" | "looking_for_match" | "in_match",
      nextFav?: CommunityGameType,
      customNote?: string
    ) => {
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
            ig_note: customNote !== undefined ? customNote : myIgNote,
          },
        });
      } catch {
        // ignore heartbeat network blip
      }
    },
    [
      activeRoomCode,
      myFavoriteGame,
      myIgNote,
      myStatus,
      playerAvatarId,
      playerLevel,
      playerName,
      playerPhone,
      playerTitle,
    ]
  );

  // Live search of all registered users on the site when typing in DM search or Gamer search
  useEffect(() => {
    const query = (activeTab === "dms" ? dmSearch : gamerSearch).trim();
    if (query.length < 2) {
      setSearchedPlayers([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await supabase.functions.invoke("challenge-arena", {
          body: {
            action: "search_players",
            query,
          },
        });
        if (!cancelled && data?.success && Array.isArray(data.players)) {
          const mapped: CommunityGamerProfile[] = data.players.map((p: any) => ({
            player_key: String(p.user_id || p.full_name),
            user_id: p.user_id,
            display_name: p.full_name || "SwiftData User",
            masked_phone: p.masked_phone || "Verified User",
            raw_phone: p.phone || "",
            avatar_id: "royal_headband",
            player_level: 2,
            player_title: p.is_agent ? "Verified Agent" : "Registered Member",
            favorite_game: "oware",
            status: "online",
            is_online_now: true,
            last_seen_at: new Date().toISOString(),
          }));
          setSearchedPlayers(mapped);
        }
      } catch {
        // ignore search error
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dmSearch, gamerSearch, activeTab]);

  useEffect(() => {
    fetchCommunityHub(false);
    sendPresenceHeartbeat();
    const interval = window.setInterval(() => {
      fetchCommunityHub(true);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [fetchCommunityHub, sendPresenceHeartbeat]);

  // 1) Shared Supabase Realtime Broadcast Bus (<50ms live text + live typing indicator)
  // 2) Postgres Changes subscription for `game_community_messages` & `game_community_presence`
  useEffect(() => {
    const uid = `${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;
    let msgChannel: ReturnType<typeof supabase.channel> | null = null;
    let presChannel: ReturnType<typeof supabase.channel> | null = null;
    let liveBus: ReturnType<typeof supabase.channel> | null = null;

    try {
      liveBus = supabase
        .channel("swiftgram-realtime-live-bus")
        .on("broadcast", { event: "instant_msg" }, (payload: any) => {
          const incoming = payload?.payload as CommunityChatMessage | undefined;
          if (!incoming || !incoming.id) return;
          setMessages((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            return [...prev, incoming];
          });
          const isFromMe =
            (currentUserId && incoming.sender_id === currentUserId) ||
            namesMatch(incoming.sender_name, playerName);
          if (!isFromMe) {
            playTurnNotificationSound(false);
          }
        })
        .on("broadcast", { event: "typing" }, (payload: any) => {
          const info = payload?.payload;
          if (!info) return;
          const isFromMe =
            (currentUserId && info.sender_id === currentUserId) ||
            namesMatch(info.sender_name, playerName);
          if (isFromMe) return;

          const isForMe =
            (currentUserId && info.target_user_id === currentUserId) ||
            namesMatch(info.target_name, playerName);
          if (isForMe) {
            setPartnerTypingName(info.sender_name || "Gamer");
            if (typingTimeoutRef.current) {
              window.clearTimeout(typingTimeoutRef.current);
            }
            typingTimeoutRef.current = window.setTimeout(() => {
              setPartnerTypingName(null);
            }, 3000);
          }
        })
        .subscribe();
      broadcastChannelRef.current = liveBus;
    } catch {
      // ignore broadcast setup error
    }

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
                // Also replace optimistic temp message if it matches sender & text
                const withoutDuplicateTemp = prev.filter(
                  (m) =>
                    !(
                      m.id.startsWith("temp-") &&
                      m.message === incoming.message &&
                      namesMatch(m.sender_name, incoming.sender_name)
                    )
                );
                return [...withoutDuplicateTemp, incoming];
              });
              const isFromMe =
                (currentUserId && incoming.sender_id === currentUserId) ||
                namesMatch(incoming.sender_name, playerName);
              if (!isFromMe) {
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
      broadcastChannelRef.current = null;
      safeRemoveChannel(liveBus);
      safeRemoveChannel(msgChannel);
      safeRemoveChannel(presChannel);
    };
  }, [activeRoomCode, currentUserId, fetchCommunityHub, playerName]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (chatScrollRef.current && (activeTab === "chat" || activeTab === "room")) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages.length, activeTab]);

  useEffect(() => {
    if (dmScrollRef.current && activeTab === "dms" && activeDmPartner) {
      dmScrollRef.current.scrollTop = dmScrollRef.current.scrollHeight;
    }
  }, [messages.length, activeTab, activeDmPartner, partnerTypingName]);

  // Emit live typing event when typing a DM to another real user
  const notifyPartnerTyping = useCallback(
    (partner: CommunityGamerProfile | null) => {
      if (!partner || !broadcastChannelRef.current) return;
      const now = Date.now();
      if (now - lastTypingSentAtRef.current < 1200) return;
      lastTypingSentAtRef.current = now;
      try {
        broadcastChannelRef.current.send({
          type: "broadcast",
          event: "typing",
          payload: {
            sender_id: currentUserId || null,
            sender_name: playerName || "Ghana Champion",
            target_user_id: partner.user_id || null,
            target_name: partner.display_name,
          },
        });
      } catch {
        // ignore
      }
    },
    [currentUserId, playerName]
  );

  // Open a 1-on-1 DM thread with any real user
  const openDirectMessageWith = (gamer: CommunityGamerProfile) => {
    triggerHapticSensor("aim_tick");
    setActiveDmPartner(gamer);
    setActiveTab("dms");
  };

  // Other real users (excluding current user)
  const otherRealGamers = useMemo(() => {
    const combined = [...gamers];
    for (const sp of searchedPlayers) {
      if (
        !combined.some(
          (g) =>
            (g.user_id && sp.user_id && g.user_id === sp.user_id) ||
            namesMatch(g.display_name, sp.display_name)
        )
      ) {
        combined.push(sp);
      }
    }
    return combined.filter((g) => {
      if (currentUserId && g.user_id && g.user_id === currentUserId) return false;
      return true;
    });
  }, [gamers, searchedPlayers, currentUserId]);

  const activeChannel =
    activeTab === "room" && activeRoomCode
      ? `room:${activeRoomCode.toUpperCase()}`
      : "global";

  const visibleMessages = useMemo(() => {
    return messages.filter((m) =>
      activeTab === "room" && activeRoomCode
        ? m.channel === `room:${activeRoomCode.toUpperCase()}`
        : m.channel === "global"
    );
  }, [messages, activeTab, activeRoomCode]);

  // Compute current 1-on-1 DM channel and messages between current user and activeDmPartner
  const activeDmChannel = useMemo(() => {
    if (!activeDmPartner) return null;
    return buildDmChannel(
      { user_id: currentUserId, name: playerName },
      { user_id: activeDmPartner.user_id, name: activeDmPartner.display_name }
    );
  }, [activeDmPartner, playerName, currentUserId]);

  const activeDmMessages = useMemo(() => {
    if (!activeDmPartner) return [];
    const partnerId = activeDmPartner.user_id;
    const partnerName = activeDmPartner.display_name;

    return messages.filter((m) => {
      if (!m.channel.startsWith("dm:")) return false;
      if (activeDmChannel && m.channel === activeDmChannel) return true;

      // Match by authenticated user_ids in either direction
      if (currentUserId && partnerId) {
        if (
          (m.sender_id === currentUserId && m.target_user_id === partnerId) ||
          (m.sender_id === partnerId && m.target_user_id === currentUserId)
        ) {
          return true;
        }
      }

      // Match by sender_name / target_user_name (supports first-name vs full-name)
      const meToPartner =
        ((currentUserId && m.sender_id === currentUserId) ||
          namesMatch(m.sender_name, playerName)) &&
        ((partnerId && m.target_user_id === partnerId) ||
          namesMatch(m.target_user_name, partnerName));

      const partnerToMe =
        ((partnerId && m.sender_id === partnerId) ||
          namesMatch(m.sender_name, partnerName)) &&
        ((currentUserId && m.target_user_id === currentUserId) ||
          namesMatch(m.target_user_name, playerName));

      return meToPartner || partnerToMe;
    });
  }, [messages, activeDmChannel, activeDmPartner, playerName, currentUserId]);

  // Build DM Conversation Inbox list from real DM threads + real site users
  const dmConversations = useMemo(() => {
    const map = new Map<
      string,
      {
        gamer: CommunityGamerProfile;
        lastMessage?: CommunityChatMessage;
      }
    >();

    // 1. Populate all active DM conversations involving current user
    for (const m of messages) {
      if (!m.channel.startsWith("dm:")) continue;
      const isMeSender =
        (currentUserId && m.sender_id === currentUserId) ||
        namesMatch(m.sender_name, playerName);
      const isMeTarget =
        (currentUserId && m.target_user_id === currentUserId) ||
        namesMatch(m.target_user_name, playerName);

      if (!isMeSender && !isMeTarget) continue;

      const otherUserId = isMeSender ? m.target_user_id : m.sender_id;
      const otherName = isMeSender
        ? m.target_user_name || "SwiftData User"
        : m.sender_name;
      if (!otherName) continue;

      const existingGamer = otherRealGamers.find(
        (g) =>
          (otherUserId && g.user_id === otherUserId) ||
          namesMatch(g.display_name, otherName)
      );

      const key = String(
        otherUserId || existingGamer?.user_id || normalizeKey(otherName)
      );
      const gamerProfile: CommunityGamerProfile = existingGamer || {
        player_key: key,
        user_id: otherUserId || null,
        display_name: otherName,
        avatar_id: isMeSender ? "teal_calm" : m.avatar_id || "royal_headband",
        player_level: isMeSender ? 2 : m.sender_level || 1,
        player_title: "Registered Gamer",
        favorite_game: m.favorite_game || "oware",
        status: "online",
        is_online_now: true,
        last_seen_at: m.created_at,
      };

      map.set(key, { gamer: gamerProfile, lastMessage: m });
    }

    // 2. Also list all other real users on the site so you can start a conversation with anyone
    for (const g of otherRealGamers) {
      const key = String(g.user_id || normalizeKey(g.display_name));
      if (!map.has(key)) {
        map.set(key, { gamer: g, lastMessage: undefined });
      }
    }

    const list = Array.from(map.values());
    if (!dmSearch.trim()) return list;
    const q = dmSearch.toLowerCase();
    return list.filter(
      (item) =>
        item.gamer.display_name.toLowerCase().includes(q) ||
        (item.gamer.masked_phone || "").toLowerCase().includes(q) ||
        (item.gamer.favorite_game || "").toLowerCase().includes(q) ||
        (item.lastMessage?.message || "").toLowerCase().includes(q)
    );
  }, [messages, otherRealGamers, playerName, currentUserId, dmSearch]);

  const handleSendMessage = async (
    customText?: string,
    opts?: {
      channelOverride?: string;
      messageType?: "chat" | "challenge_card" | "direct_invite";
      challenge?: any;
      targetUser?: { user_id?: string | null; name: string } | null;
      dmPartner?: CommunityGamerProfile | null;
    }
  ) => {
    const isDmSend = Boolean(
      opts?.channelOverride?.startsWith("dm:") || opts?.dmPartner
    );
    const rawText = customText ?? (isDmSend ? dmInput : chatInput);
    const textToSend = rawText.trim();
    if (!textToSend || sending) return;

    setSending(true);
    if (!customText) {
      if (isDmSend) setDmInput("");
      else setChatInput("");
    }

    const partner = opts?.dmPartner || (isDmSend ? activeDmPartner : null);
    const effectiveTarget =
      opts?.targetUser ||
      (partner
        ? { user_id: partner.user_id, name: partner.display_name }
        : taggedTargetUser);
    const attachedChallenge = opts?.challenge || null;
    const targetChannel =
      opts?.channelOverride ||
      (partner
        ? buildDmChannel(
            { user_id: currentUserId, name: playerName },
            { user_id: partner.user_id, name: partner.display_name }
          )
        : activeChannel);

    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: CommunityChatMessage = {
      id: tempId,
      channel: targetChannel,
      sender_id: currentUserId || null,
      sender_name: playerName || "Ghana Champion",
      avatar_id: playerAvatarId,
      sender_level: playerLevel,
      sender_title: playerTitle,
      favorite_game: myFavoriteGame,
      message_type:
        opts?.messageType ||
        (effectiveTarget && !isDmSend ? "direct_invite" : "chat"),
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
    if (!isDmSend) setTaggedTargetUser(null);
    triggerHapticSensor("aim_tick");

    try {
      const { data } = await supabase.functions.invoke("challenge-arena", {
        body: {
          action: "send_community_message",
          channel: targetChannel,
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
        const persistedRow: CommunityChatMessage = data.message_row;
        setMessages((prev) => {
          const alreadyHasPersisted = prev.some((m) => m.id === persistedRow.id);
          if (alreadyHasPersisted) {
            return prev.filter((m) => m.id !== tempId);
          }
          return prev.map((m) => (m.id === tempId ? persistedRow : m));
        });

        // Broadcast immediately over Supabase Realtime Broadcast Bus so recipient gets it in <50ms!
        try {
          broadcastChannelRef.current?.send({
            type: "broadcast",
            event: "instant_msg",
            payload: persistedRow,
          });
        } catch {
          // ignore broadcast error
        }
      }
    } catch (err) {
      console.warn("[GamerCommunityHub] Send message error:", err);
    } finally {
      setSending(false);
    }
  };

  const handleReactMessage = async (messageId: string, emoji: string) => {
    triggerHapticSensor("aim_tick");

    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const nextReactions = { ...(m.reactions || {}) };
        nextReactions[emoji] = Number(nextReactions[emoji] || 0) + 1;
        return { ...m, reactions: nextReactions };
      })
    );

    if (messageId.startsWith("temp-")) return;

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

  const filteredGamers = otherRealGamers.filter((g) => {
    if (onlyLookingForMatch && g.status !== "looking_for_match") return false;
    if (!gamerSearch.trim()) return true;
    const q = gamerSearch.toLowerCase();
    return (
      g.display_name.toLowerCase().includes(q) ||
      (g.masked_phone || "").toLowerCase().includes(q) ||
      (g.favorite_game || "").toLowerCase().includes(q)
    );
  });

  const lookingForMatchCount = otherRealGamers.filter(
    (g) => g.status === "looking_for_match"
  ).length;

  const dmThreadCount = useMemo(() => {
    return dmConversations.filter((c) => Boolean(c.lastMessage)).length;
  }, [dmConversations]);

  return (
    <div className="flex flex-col h-full max-h-[86vh] bg-[#080c17] text-white rounded-3xl border border-white/15 shadow-[0_25px_70px_rgba(0,0,0,0.9)] overflow-hidden">
      {/* ── Instagram-Style Top App Bar ("SwiftGram • Real Gamers & Live DMs") ── */}
      <div className="px-4 py-3 bg-gradient-to-r from-[#121829] via-[#1a1128] to-[#0f172a] border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-amber-400 via-rose-500 to-purple-600 text-white flex items-center justify-center shadow-lg shrink-0">
            <MessageCircle className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm sm:text-base font-black tracking-tight bg-gradient-to-r from-white via-amber-200 to-pink-200 bg-clip-text text-transparent truncate">
                SwiftGram • Live User Chat &amp; DMs
              </h3>
              <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-black px-2 py-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping mr-1 inline-block" />
                {Math.max(1, gamers.length)} Members
              </Badge>
            </div>
            <p className="text-[11px] text-slate-400 truncate">
              Real-time messaging with real users on SwiftData
            </p>
          </div>
        </div>

        {/* Top-Right IG Action Icons: Start Post | Direct Messages (Paper Plane) | Refresh | Close */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab("chat");
              window.setTimeout(() => feedInputRef.current?.focus(), 80);
            }}
            className="px-2.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-black text-amber-300 flex items-center gap-1.5 cursor-pointer"
            title="Start a Conversation in Feed"
          >
            <PenSquare className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Post</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("dms")}
            className={`relative px-2.5 py-1.5 rounded-xl border text-xs font-black flex items-center gap-1.5 cursor-pointer transition-all ${
              activeTab === "dms"
                ? "bg-gradient-to-r from-pink-500 to-amber-500 text-slate-950 border-amber-300 shadow"
                : "bg-white/[0.06] hover:bg-white/[0.12] border-white/10 text-white"
            }`}
            title="Direct Messages (1-on-1 Real User Text)"
          >
            <SendHorizontal className="w-3.5 h-3.5 -rotate-12" />
            <span>DMs</span>
            {dmThreadCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[9px] font-black">
                {dmThreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => fetchCommunityHub(false)}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white cursor-pointer"
            title="Refresh Feed & DMs"
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

      {/* ── IG Navigation Tabs: Feed | Direct Messages (DMs) | Find Users | Room Chat ── */}
      <div className="px-3 pt-2 pb-2 bg-[#0b1020] border-b border-white/10 flex items-center gap-1.5 shrink-0 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setActiveTab("chat")}
          className={`flex-1 min-w-[105px] py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === "chat"
              ? "bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 shadow"
              : "bg-white/[0.04] text-slate-300 hover:text-white"
          }`}
        >
          <Flame className="w-3.5 h-3.5" />
          <span>Live Feed</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("dms")}
          className={`flex-1 min-w-[125px] py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === "dms"
              ? "bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 text-white shadow"
              : "bg-white/[0.04] text-slate-300 hover:text-white"
          }`}
        >
          <SendHorizontal className="w-3.5 h-3.5 -rotate-12" />
          <span>Direct Messages</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[9px] font-black ${
              activeTab === "dms"
                ? "bg-slate-950 text-amber-300"
                : "bg-pink-500/25 text-pink-300 border border-pink-400/40"
            }`}
          >
            Live 1v1
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("gamers")}
          className={`flex-1 min-w-[110px] py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === "gamers"
              ? "bg-amber-500 text-slate-950 shadow"
              : "bg-white/[0.04] text-slate-300 hover:text-white"
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>All Site Users ({otherRealGamers.length})</span>
        </button>

        {activeRoomCode && (
          <button
            type="button"
            onClick={() => setActiveTab("room")}
            className={`flex-1 min-w-[100px] py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
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

      {/* ── Expandable 1-Tap "Drop Challenge Card" Game Picker ── */}
      {showDropChallengePicker && (
        <div className="p-3 bg-gradient-to-r from-amber-950/60 via-slate-900 to-rose-950/50 border-b border-amber-500/40 space-y-2 shrink-0 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-amber-300 flex items-center gap-1.5">
              <Swords className="w-3.5 h-3.5" /> Pick a Game to Challenge{" "}
              {activeTab === "dms" && activeDmPartner
                ? activeDmPartner.display_name
                : "in Chat"}
              :
            </span>
            <button
              type="button"
              onClick={() => setShowDropChallengePicker(false)}
              className="text-[11px] text-slate-400 hover:text-white"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-1.5">
            {(Object.keys(GAME_LABELS) as CommunityGameType[]).map((gKey) => {
              const g = GAME_LABELS[gKey];
              return (
                <button
                  key={gKey}
                  type="button"
                  onClick={() => {
                    setShowDropChallengePicker(false);
                    onQuickCreateChallenge(
                      gKey,
                      activeTab === "dms" && activeDmPartner
                        ? {
                            user_id: activeDmPartner.user_id,
                            full_name: activeDmPartner.display_name,
                            phone: activeDmPartner.raw_phone,
                          }
                        : null
                    );
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

      {/* ══════════════════════════════════════════════════════════════════════════
          TAB 1 & TAB 4: IG FEED & GLOBAL LOUNGE / ROOM CHAT
         ══════════════════════════════════════════════════════════════════════════ */}
      {(activeTab === "chat" || activeTab === "room") && (
        <>
          {/* Daily Stories Bar + Real Site Users IG Notes Strip */}
          {activeTab === "chat" && (
            <div className="px-3 py-2 bg-[#0a0f1d] border-b border-white/10 space-y-2 shrink-0">
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

              {/* Real Site Users Strip • Tap Anyone to Text (DM) */}
              <div className="pt-1 border-t border-white/5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-black uppercase tracking-wider text-pink-300 flex items-center gap-1">
                    <SendHorizontal className="w-3 h-3 -rotate-12" />
                    Real Site Users • Tap Anyone to Text (DM) Live
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingNote((v) => !v)}
                    className="text-[10px] font-bold text-amber-300 hover:underline cursor-pointer"
                  >
                    {editingNote ? "Close" : "✏️ Set My IG Note"}
                  </button>
                </div>

                {editingNote && (
                  <div className="flex items-center gap-1.5 mb-2">
                    <Input
                      value={myIgNote}
                      onChange={(e) => setMyIgNote(e.target.value.slice(0, 50))}
                      placeholder="Write a short note above your avatar for other users..."
                      className="h-7 text-[11px] bg-slate-950 border-amber-400/40 rounded-xl text-white"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        try {
                          localStorage.setItem("swiftgram_my_ig_note", myIgNote);
                        } catch {
                          // ignore
                        }
                        sendPresenceHeartbeat(myStatus, myFavoriteGame, myIgNote);
                        setEditingNote(false);
                      }}
                      className="h-7 px-3 rounded-xl bg-amber-400 text-slate-950 font-black text-[10px]"
                    >
                      Save Note
                    </Button>
                  </div>
                )}

                {otherRealGamers.length > 0 && (
                  <div className="flex items-center gap-2.5 overflow-x-auto pb-1 no-scrollbar">
                    {otherRealGamers.slice(0, 12).map((g) => {
                      const fav =
                        GAME_LABELS[g.favorite_game] || GAME_LABELS.oware;
                      return (
                        <div
                          key={g.player_key}
                          className="shrink-0 w-[116px] p-2 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 flex flex-col items-center text-center transition-all"
                        >
                          {g.ig_note && (
                            <div className="w-full px-1.5 py-0.5 mb-1 rounded-xl bg-slate-900/95 border border-white/15 text-[9px] text-amber-200 truncate shadow">
                              {g.ig_note}
                            </div>
                          )}

                          <div
                            onClick={() => openDirectMessageWith(g)}
                            className="relative cursor-pointer"
                          >
                            <VerifiedGamerAvatar
                              avatarId={g.avatar_id}
                              seedName={g.display_name}
                              size={40}
                              showVerifiedBadge={true}
                            />
                            <span
                              className={`w-2.5 h-2.5 rounded-full border-2 border-[#0a0f1d] absolute bottom-0 right-0 ${
                                g.is_online_now
                                  ? "bg-emerald-400"
                                  : "bg-amber-400"
                              }`}
                            />
                          </div>

                          <span className="text-[11px] font-black text-white truncate w-full mt-1">
                            {g.display_name}
                          </span>
                          <span className="text-[9px] text-slate-400 truncate w-full">
                            {g.masked_phone || `${fav.emoji} ${fav.name}`}
                          </span>

                          <div className="flex items-center gap-1 w-full mt-1.5">
                            <button
                              type="button"
                              onClick={() => openDirectMessageWith(g)}
                              className="flex-1 py-1 rounded-lg bg-gradient-to-r from-pink-500/30 to-purple-500/30 hover:from-pink-500 hover:to-purple-500 border border-pink-400/40 text-[9px] font-black text-pink-200 hover:text-white transition-all cursor-pointer"
                            >
                              💬 Text
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onQuickCreateChallenge(
                                  (g.favorite_game as CommunityGameType) ||
                                    "oware",
                                  {
                                    user_id: g.user_id,
                                    full_name: g.display_name,
                                    phone: g.raw_phone,
                                  }
                                )
                              }
                              className="px-1.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500 border border-amber-400/40 text-[9px] font-black text-amber-300 hover:text-slate-950 transition-all cursor-pointer"
                              title={`Challenge ${g.display_name}`}
                            >
                              ⚔️
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Scrollable IG Feed & Chat Stream */}
          <div
            ref={chatScrollRef}
            className="flex-1 min-h-[250px] overflow-y-auto p-3 space-y-3"
          >
            {loading && visibleMessages.length === 0 ? (
              <div className="h-44 flex flex-col items-center justify-center text-slate-400 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
                <span className="text-xs font-bold">
                  Loading Real-Time SwiftGram Feed…
                </span>
              </div>
            ) : visibleMessages.length === 0 ? (
              <div className="p-6 rounded-2xl border border-dashed border-white/10 text-center space-y-2 my-4">
                <p className="text-sm font-black text-amber-300">
                  {activeTab === "room"
                    ? `Room #${activeRoomCode} Live Chat`
                    : "Start the First Live Conversation! 💬"}
                </p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Post a message below to all users on the site, or tap any user above to send them a real-time 1-on-1 Direct Message!
                </p>
              </div>
            ) : (
              visibleMessages.map((msg) => {
                const isMe =
                  (currentUserId && msg.sender_id === currentUserId) ||
                  namesMatch(msg.sender_name, playerName);
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

                const senderGamerObj: CommunityGamerProfile = otherRealGamers.find(
                  (g) =>
                    (msg.sender_id && g.user_id === msg.sender_id) ||
                    namesMatch(g.display_name, msg.sender_name)
                ) || {
                  player_key: String(
                    msg.sender_id || `user_${normalizeKey(msg.sender_name)}`
                  ),
                  user_id: msg.sender_id,
                  display_name: msg.sender_name,
                  avatar_id: msg.avatar_id || "royal_headband",
                  player_level: msg.sender_level || 1,
                  player_title: msg.sender_title || "Arena Gamer",
                  favorite_game: msg.favorite_game || "oware",
                  status: "online",
                  is_online_now: true,
                  last_seen_at: msg.created_at,
                };

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
                    className={`rounded-2xl p-3.5 border transition-all space-y-2.5 ${
                      isChallengeCard
                        ? "bg-gradient-to-br from-[#1b2438] via-[#131b2e] to-[#291347]/70 border-amber-400/60 shadow-lg"
                        : isMe
                        ? "bg-gradient-to-r from-amber-500/15 via-slate-900 to-purple-500/15 border-amber-400/35"
                        : "bg-[#111829] border-white/10"
                    }`}
                  >
                    {/* IG Post Header: Avatar + Name + Level + Direct "Message 💬" Button */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          onClick={() =>
                            !isMe && openDirectMessageWith(senderGamerObj)
                          }
                          className={!isMe ? "cursor-pointer" : ""}
                        >
                          <VerifiedGamerAvatar
                            avatarId={msg.avatar_id}
                            seedName={msg.sender_name}
                            size={34}
                            showVerifiedBadge={true}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-black text-white truncate">
                              {msg.sender_name}
                            </span>
                            <span className="px-1.5 py-0.2 rounded bg-amber-500/20 border border-amber-500/40 text-[9px] font-black text-amber-300">
                              Lv.{msg.sender_level || 1}
                            </span>
                            <span
                              className="text-[10px]"
                              title={`Plays ${gMeta.name}`}
                            >
                              {gMeta.emoji}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              • {formatRelativeTime(msg.created_at)}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 truncate">
                            {msg.sender_title || "SwiftData Member"}
                          </p>
                        </div>
                      </div>

                      {!isMe && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              openDirectMessageWith(senderGamerObj)
                            }
                            className="px-2.5 py-1 rounded-full bg-gradient-to-r from-pink-500/25 to-purple-500/25 hover:from-pink-500 hover:to-purple-500 border border-pink-400/40 text-[10px] font-black text-pink-200 hover:text-white flex items-center gap-1 transition-all cursor-pointer"
                          >
                            <SendHorizontal className="w-3 h-3 -rotate-12" />
                            <span>Message</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onQuickCreateChallenge(
                                (senderGamerObj.favorite_game as CommunityGameType) ||
                                  "oware",
                                {
                                  user_id: senderGamerObj.user_id,
                                  full_name: senderGamerObj.display_name,
                                }
                              )
                            }
                            className="px-2.5 py-1 rounded-full bg-amber-500/20 hover:bg-amber-500 border border-amber-400/40 text-[10px] font-black text-amber-300 hover:text-slate-950 transition-all cursor-pointer"
                          >
                            ⚔️ Duel
                          </button>
                        </div>
                      )}
                    </div>

                    {msg.target_user_name && (
                      <Badge className="bg-rose-500/20 text-rose-300 border border-rose-400/40 text-[9px] font-black">
                        🎯 Replying to @{msg.target_user_name}
                      </Badge>
                    )}

                    {/* Post Body Text */}
                    <p className="text-xs sm:text-sm text-slate-100 leading-relaxed break-words">
                      {msg.message}
                    </p>

                    {/* Embedded Interactive Challenge Card inside Post */}
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
                                  )} • Pot: GH₵ ${Number(
                                    msg.prize_pool || 0
                                  ).toFixed(2)}`
                                : "🎁 Free Skill Duel • Earn Arena Data Points"}
                            </p>
                          </div>
                        </div>

                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            if (
                              matchingOpenChallenge &&
                              onJoinChallengeObject
                            ) {
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

                    {/* IG Post Action Bar: Like | Reply in Feed | DM Author | Reactions */}
                    <div className="pt-1 border-t border-white/5 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {REACTION_EMOJIS.map((emo) => {
                          const count = Number(msg.reactions?.[emo] || 0);
                          return (
                            <button
                              key={emo}
                              type="button"
                              onClick={() => handleReactMessage(msg.id, emo)}
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all cursor-pointer ${
                                count > 0
                                  ? "bg-pink-500/20 border border-pink-400/40 text-pink-200"
                                  : "bg-white/[0.04] hover:bg-white/10 text-slate-400"
                              }`}
                            >
                              {emo} {count > 0 ? count : ""}
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setTaggedTargetUser({
                              user_id: msg.sender_id,
                              name: msg.sender_name,
                            });
                            setChatInput(`@${msg.sender_name} `);
                            feedInputRef.current?.focus();
                          }}
                          className="text-[10px] font-bold text-slate-300 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                        >
                          <MessageCircle className="w-3 h-3" />
                          <span>Reply</span>
                        </button>
                        {!isMe && (
                          <button
                            type="button"
                            onClick={() =>
                              openDirectMessageWith(senderGamerObj)
                            }
                            className="text-[10px] font-bold text-pink-300 hover:text-pink-200 flex items-center gap-1 cursor-pointer"
                          >
                            <SendHorizontal className="w-3 h-3 -rotate-12" />
                            <span>DM</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Bottom Composer Bar: Quick Chips + Start Conversation Input */}
          <div className="p-2.5 bg-[#0c1324] border-t border-white/10 space-y-2 shrink-0">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
              <button
                type="button"
                onClick={() => setShowDropChallengePicker((v) => !v)}
                className="px-2.5 py-1 rounded-full bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-[10px] font-black text-amber-300 whitespace-nowrap shrink-0 cursor-pointer"
              >
                ⚔️ + Drop Game Challenge
              </button>
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
                  💬 Replying to <strong>@{taggedTargetUser.name}</strong>
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
              <VerifiedGamerAvatar
                avatarId={playerAvatarId}
                seedName={playerName}
                size={34}
                showVerifiedBadge={false}
              />
              <Input
                ref={feedInputRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={
                  activeTab === "room"
                    ? `Message Room #${activeRoomCode}…`
                    : `Start a conversation as ${playerName || "Ghana Champion"} or @tag a user…`
                }
                className="h-10 flex-1 rounded-2xl bg-slate-950 border-white/15 text-xs text-white"
              />
              <Button
                type="submit"
                disabled={sending || !chatInput.trim()}
                className="h-10 px-4 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-black text-xs gap-1.5 shrink-0"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Post</span>
                  </>
                )}
              </Button>
            </form>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          TAB 2: REAL-TIME 1-ON-1 DIRECT MESSAGES WITH REAL USERS ON THE SITE
         ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "dms" && (
        <div className="flex-1 flex flex-col min-h-[320px] overflow-hidden">
          {!activeDmPartner ? (
            /* ── DM INBOX VIEW (CONVERSATION LIST + SEARCH ANY REGISTERED USER) ── */
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 bg-[#0e1526] border-b border-white/10 space-y-2.5 shrink-0">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs sm:text-sm font-black text-white flex items-center gap-1.5">
                      <SendHorizontal className="w-4 h-4 text-pink-400 -rotate-12" />
                      <span>Direct Messages • Real-Time User Chat</span>
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Search or tap any registered user on SwiftData to text them live in real time
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setActiveTab("gamers")}
                    className="h-8 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-black text-amber-300 gap-1"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>All Users</span>
                  </Button>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <Input
                    value={dmSearch}
                    onChange={(e) => setDmSearch(e.target.value)}
                    placeholder="Search any real user on the site by name or phone number…"
                    className="h-8 pl-8 rounded-xl bg-slate-950 border-white/15 text-xs text-white"
                  />
                </div>

                {/* Real Users Horizontal Quick-Select Row */}
                {otherRealGamers.length > 0 && (
                  <div className="flex items-center gap-3 overflow-x-auto pb-1 no-scrollbar">
                    {otherRealGamers.slice(0, 10).map((g) => (
                      <button
                        key={g.player_key}
                        type="button"
                        onClick={() => openDirectMessageWith(g)}
                        className="flex flex-col items-center shrink-0 group cursor-pointer"
                      >
                        <div className="relative">
                          <VerifiedGamerAvatar
                            avatarId={g.avatar_id}
                            seedName={g.display_name}
                            size={44}
                            showVerifiedBadge={true}
                          />
                          <span
                            className={`w-3 h-3 rounded-full border-2 border-[#0e1526] absolute bottom-0 right-0 ${
                              g.is_online_now
                                ? "bg-emerald-400"
                                : "bg-amber-400"
                            }`}
                          />
                        </div>
                        <span className="text-[10px] font-bold text-slate-200 group-hover:text-amber-300 mt-1 max-w-[72px] truncate">
                          {g.display_name.split(" ")[0]}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Conversation List */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {dmConversations.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    No users found matching your search.
                  </div>
                ) : (
                  dmConversations.map(({ gamer, lastMessage }) => {
                    const fav =
                      GAME_LABELS[gamer.favorite_game] || GAME_LABELS.oware;
                    return (
                      <div
                        key={gamer.player_key}
                        onClick={() => openDirectMessageWith(gamer)}
                        className="p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 hover:border-pink-400/40 flex items-center justify-between gap-3 cursor-pointer transition-all"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="relative shrink-0">
                            <VerifiedGamerAvatar
                              avatarId={gamer.avatar_id}
                              seedName={gamer.display_name}
                              size={46}
                              showVerifiedBadge={true}
                            />
                            <span
                              className={`w-3 h-3 rounded-full border-2 border-[#080c17] absolute bottom-0 right-0 ${
                                gamer.is_online_now
                                  ? "bg-emerald-400"
                                  : "bg-amber-400"
                              }`}
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs sm:text-sm font-black text-white truncate">
                                {gamer.display_name}
                              </span>
                              {gamer.masked_phone && (
                                <span className="text-[10px] text-slate-400">
                                  ({gamer.masked_phone})
                                </span>
                              )}
                              <span className="text-xs">{fav.emoji}</span>
                            </div>
                            <p className="text-xs text-slate-300 truncate mt-0.5">
                              {lastMessage ? (
                                <span className="font-semibold text-white">
                                  {namesMatch(
                                    lastMessage.sender_name,
                                    playerName
                                  )
                                    ? `You: ${lastMessage.message}`
                                    : `${lastMessage.sender_name}: ${lastMessage.message}`}
                                </span>
                              ) : (
                                <span className="text-pink-300/90 font-semibold">
                                  {gamer.ig_note ||
                                    "Tap to start a real-time 1-on-1 chat 💬"}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {lastMessage && (
                            <span className="text-[10px] text-slate-400">
                              {formatRelativeTime(lastMessage.created_at)}
                            </span>
                          )}
                          <span className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-pink-500 to-amber-500 text-slate-950 font-black text-[11px] flex items-center gap-1 shadow">
                            <MessageCircle className="w-3.5 h-3.5" />
                            <span>Text</span>
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            /* ── ACTIVE 1-ON-1 IG DIRECT MESSAGE THREAD VIEW ── */
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* DM Thread Header */}
              <div className="px-3 py-2.5 bg-[#10172a] border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => setActiveDmPartner(null)}
                    className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-slate-200 cursor-pointer"
                    title="Back to DM Inbox"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <div className="relative shrink-0">
                    <VerifiedGamerAvatar
                      avatarId={activeDmPartner.avatar_id}
                      seedName={activeDmPartner.display_name}
                      size={38}
                      showVerifiedBadge={true}
                    />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#10172a] absolute bottom-0 right-0" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs sm:text-sm font-black text-white truncate">
                        {activeDmPartner.display_name}
                      </span>
                      {activeDmPartner.masked_phone && (
                        <span className="text-[10px] text-slate-400">
                          {activeDmPartner.masked_phone}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-emerald-300 font-semibold truncate">
                      {partnerTypingName
                        ? `💬 ${partnerTypingName} is typing…`
                        : "🟢 Live Direct Chat • Real-Time Sync"}
                    </p>
                  </div>
                </div>

                {/* 1-Tap Challenge Button inside DM Thread Header */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setShowDropChallengePicker((v) => !v)}
                    className="h-8 px-3 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-black text-[11px] gap-1 shadow"
                  >
                    <Swords className="w-3.5 h-3.5" />
                    <span>Challenge</span>
                  </Button>
                </div>
              </div>

              {/* DM Messages Scroll Area */}
              <div
                ref={dmScrollRef}
                className="flex-1 min-h-[220px] overflow-y-auto p-3.5 space-y-3"
              >
                {/* Top IG Profile Card inside DM Thread */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 text-center space-y-1.5 my-1">
                  <div className="flex justify-center">
                    <VerifiedGamerAvatar
                      avatarId={activeDmPartner.avatar_id}
                      seedName={activeDmPartner.display_name}
                      size={54}
                      showVerifiedBadge={true}
                    />
                  </div>
                  <p className="text-sm font-black text-white">
                    {activeDmPartner.display_name}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {activeDmPartner.player_title}{" "}
                    {activeDmPartner.masked_phone
                      ? `• ${activeDmPartner.masked_phone}`
                      : ""}
                  </p>
                  <p className="text-[10px] text-pink-300 font-bold">
                    Real-time direct chat — messages appear immediately on {activeDmPartner.display_name}&apos;s screen &amp; send a notification!
                  </p>
                </div>

                {activeDmMessages.map((msg) => {
                  const isMe =
                    (currentUserId && msg.sender_id === currentUserId) ||
                    namesMatch(msg.sender_name, playerName);

                  return (
                    <div
                      key={msg.id}
                      className={`flex items-end gap-2 ${
                        isMe ? "justify-end" : "justify-start"
                      }`}
                    >
                      {!isMe && (
                        <VerifiedGamerAvatar
                          avatarId={activeDmPartner.avatar_id}
                          seedName={activeDmPartner.display_name}
                          size={28}
                          showVerifiedBadge={false}
                        />
                      )}

                      <div
                        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 space-y-1.5 shadow ${
                          isMe
                            ? "bg-gradient-to-r from-purple-600 via-pink-600 to-amber-500 text-white rounded-br-xs"
                            : "bg-[#161f35] border border-white/10 text-slate-100 rounded-bl-xs"
                        }`}
                      >
                        <p className="text-xs sm:text-sm leading-relaxed break-words">
                          {msg.message}
                        </p>

                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <span className="text-[9px] opacity-75">
                            {formatRelativeTime(msg.created_at)}
                          </span>
                          <div className="flex items-center gap-1">
                            {["❤️", "🔥", "😂"].map((emo) => {
                              const count = Number(msg.reactions?.[emo] || 0);
                              return (
                                <button
                                  key={emo}
                                  type="button"
                                  onClick={() => handleReactMessage(msg.id, emo)}
                                  className={`text-[10px] px-1 rounded ${
                                    count > 0
                                      ? "bg-black/30 text-white font-bold"
                                      : "opacity-60 hover:opacity-100"
                                  }`}
                                >
                                  {emo} {count > 0 ? count : ""}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {partnerTypingName && (
                  <div className="flex items-center gap-2 text-xs text-pink-300 font-bold animate-pulse px-2">
                    <span>💬 {partnerTypingName} is typing…</span>
                  </div>
                )}
              </div>

              {/* DM Quick Icebreaker Chips + IG Direct Message Input */}
              <div className="p-2.5 bg-[#0c1324] border-t border-white/10 space-y-2 shrink-0">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                  {DM_ICEBREAKER_CHIPS.map((chip, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() =>
                        handleSendMessage(chip, { dmPartner: activeDmPartner })
                      }
                      className="px-2.5 py-1 rounded-full bg-white/[0.06] hover:bg-pink-500/20 border border-white/10 hover:border-pink-400/40 text-[10px] font-bold text-slate-200 whitespace-nowrap transition-all cursor-pointer shrink-0"
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage(undefined, { dmPartner: activeDmPartner });
                  }}
                  className="flex items-center gap-2"
                >
                  <Input
                    value={dmInput}
                    onChange={(e) => {
                      setDmInput(e.target.value);
                      notifyPartnerTyping(activeDmPartner);
                    }}
                    placeholder={`Message ${activeDmPartner.display_name} live…`}
                    className="h-10 flex-1 rounded-full bg-slate-950 border-white/15 px-4 text-xs text-white"
                  />
                  <Button
                    type="submit"
                    disabled={sending || !dmInput.trim()}
                    className="h-10 px-4 rounded-full bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 hover:opacity-95 text-white font-black text-xs gap-1.5 shrink-0 shadow"
                  >
                    {sending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <SendHorizontal className="w-3.5 h-3.5 -rotate-12" />
                        <span>Send</span>
                      </>
                    )}
                  </Button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          TAB 3: ALL REAL SITE USERS & 1-TAP MESSAGE / CHALLENGE DIRECTORY
         ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "gamers" && (
        <div className="flex-1 flex flex-col min-h-[280px] overflow-hidden">
          {/* Search & Filter Bar */}
          <div className="p-3 bg-[#0e1629] border-b border-white/10 flex flex-wrap items-center gap-2 shrink-0">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
              <Input
                value={gamerSearch}
                onChange={(e) => setGamerSearch(e.target.value)}
                placeholder="Search any real user on the site by name or phone…"
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
                  <span className="text-white">
                    {challengingGamer.display_name}
                  </span>
                  :
                </p>
                <button
                  type="button"
                  onClick={() => setChallengingGamer(null)}
                  className="text-xs text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-7 gap-1.5">
                {(Object.keys(GAME_LABELS) as CommunityGameType[]).map(
                  (gKey) => {
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
                  }
                )}
              </div>
            </div>
          )}

          {/* Real Site Users Directory List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredGamers.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No users matched your search filter.
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
                            isLooking || gamer.is_online_now
                              ? "bg-emerald-400"
                              : "bg-amber-400"
                          }`}
                        />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs sm:text-sm font-black text-white truncate">
                            {gamer.display_name}
                          </span>
                          {gamer.masked_phone && (
                            <span className="text-[10px] text-slate-400">
                              • {gamer.masked_phone}
                            </span>
                          )}
                          <Badge
                            className={`border text-[9px] font-bold px-1.5 py-0 ${fav.badgeClass}`}
                          >
                            {fav.emoji} {fav.name}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                          <span className="text-emerald-300 font-semibold truncate">
                            {gamer.ig_note ||
                              (gamer.is_online_now
                                ? "🟢 Active on SwiftData"
                                : `Registered Member • ${gamer.player_title}`)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => openDirectMessageWith(gamer)}
                        className="h-8 px-3 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 hover:opacity-95 text-white font-black text-[10px] gap-1 shadow"
                      >
                        <SendHorizontal className="w-3 h-3 -rotate-12" />
                        <span>Message</span>
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
                        <span>Challenge</span>
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
 * Instagram-Style Community & Real-Time Direct Message Card on the Main Challenge Arena Lobby
 * Displays real users on the site, pops up live incoming DMs in real time, and lets users start a conversation immediately!
 */
export function GamerCommunityPreviewCard({
  currentUserId,
  playerName = "Ghana Champion",
  playerPhone = "",
  playerAvatarId = "royal_headband",
  playerLevel = 1,
  playerTitle = "Arena Challenger",
  onOpenChat,
  onOpenDirectMessages,
  onOpenMeetGamers,
  onJoinByRoomCode,
  onQuickChallengeGamer,
}: {
  currentUserId?: string | null;
  playerName?: string;
  playerPhone?: string;
  playerAvatarId?: string;
  playerLevel?: number;
  playerTitle?: string;
  onOpenChat: () => void;
  onOpenDirectMessages?: (gamer?: CommunityGamerProfile | null) => void;
  onOpenMeetGamers: () => void;
  onJoinByRoomCode: (roomCode: string) => void;
  onQuickChallengeGamer?: (gamer: CommunityGamerProfile) => void;
}) {
  const [recentMessages, setRecentMessages] = useState<CommunityChatMessage[]>(
    []
  );
  const [onlineGamers, setOnlineGamers] = useState<CommunityGamerProfile[]>([]);
  const [incomingLiveDm, setIncomingLiveDm] =
    useState<CommunityChatMessage | null>(null);
  const [quickText, setQuickText] = useState<string>("");
  const [postingQuick, setPostingQuick] = useState<boolean>(false);

  const loadPreview = useCallback(async () => {
    try {
      const { data } = await supabase.functions.invoke("challenge-arena", {
        body: { action: "get_community_hub" },
      });
      if (data?.success) {
        const allMsgs: CommunityChatMessage[] = data.messages || [];
        const globalOnly = allMsgs.filter((m) => m.channel === "global");
        setRecentMessages(globalOnly.slice(-3));

        const serverGamers: CommunityGamerProfile[] = (
          data.gamers || []
        ).filter(
          (g: CommunityGamerProfile) =>
            !(currentUserId && g.user_id && g.user_id === currentUserId)
        );
        setOnlineGamers(serverGamers.slice(0, 12));
      }
    } catch {
      // ignore preview error
    }
  }, [currentUserId]);

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
            const incoming = payload?.new as CommunityChatMessage | undefined;
            if (!incoming) return;
            if (incoming.channel === "global") {
              setRecentMessages((prev) => [...prev.slice(-2), incoming]);
            } else if (incoming.channel.startsWith("dm:")) {
              const isFromMe =
                (currentUserId && incoming.sender_id === currentUserId) ||
                namesMatch(incoming.sender_name, playerName);
              const isToMe =
                (currentUserId && incoming.target_user_id === currentUserId) ||
                namesMatch(incoming.target_user_name, playerName);
              if (!isFromMe && isToMe) {
                setIncomingLiveDm(incoming);
                playTurnNotificationSound(true);
              }
            }
          }
        )
        .subscribe();
    } catch {
      // ignore realtime channel collision
    }
    return () => safeRemoveChannel(previewChannel);
  }, [loadPreview, currentUserId, playerName]);

  const handleQuickInlinePost = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = quickText.trim();
    if (!text || postingQuick) return;
    setPostingQuick(true);
    setQuickText("");
    triggerHapticSensor("aim_tick");

    const optimistic: CommunityChatMessage = {
      id: `quick-${Date.now()}`,
      channel: "global",
      sender_id: currentUserId || null,
      sender_name: playerName || "Ghana Champion",
      avatar_id: playerAvatarId,
      sender_level: playerLevel,
      sender_title: playerTitle,
      favorite_game: "buggy",
      message_type: "chat",
      message: text,
      reactions: {},
      created_at: new Date().toISOString(),
    };
    setRecentMessages((prev) => [...prev.slice(-2), optimistic]);

    try {
      await supabase.functions.invoke("challenge-arena", {
        body: {
          action: "send_community_message",
          channel: "global",
          sender_name: playerName || "Ghana Champion",
          sender_phone: playerPhone || "",
          avatar_id: playerAvatarId,
          sender_level: playerLevel,
          sender_title: playerTitle,
          favorite_game: "buggy",
          message_type: "chat",
          message: text,
        },
      });
    } catch {
      // ignore
    } finally {
      setPostingQuick(false);
    }
  };

  return (
    <div className="rounded-3xl p-4 sm:p-5 bg-gradient-to-br from-[#12192e] via-[#0d1324] to-[#1f1135] border border-pink-500/35 shadow-[0_18px_50px_rgba(0,0,0,0.65)] space-y-4">
      {/* Live Incoming DM Alert Banner (Appears in real time when another user texts you!) */}
      {incomingLiveDm && (
        <div className="p-3 rounded-2xl bg-gradient-to-r from-pink-600/30 via-purple-600/30 to-amber-500/30 border-2 border-pink-400 flex items-center justify-between gap-2 animate-in fade-in duration-150 shadow-lg">
          <div className="flex items-center gap-2.5 min-w-0">
            <VerifiedGamerAvatar
              avatarId={incomingLiveDm.avatar_id}
              seedName={incomingLiveDm.sender_name}
              size={36}
              showVerifiedBadge={true}
            />
            <div className="min-w-0">
              <p className="text-[11px] font-black text-pink-200 uppercase">
                ✈️ New Live Direct Message from {incomingLiveDm.sender_name}
              </p>
              <p className="text-xs font-bold text-white truncate">
                &ldquo;{incomingLiveDm.message}&rdquo;
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const senderProfile: CommunityGamerProfile = {
                  player_key: String(
                    incomingLiveDm.sender_id || incomingLiveDm.sender_name
                  ),
                  user_id: incomingLiveDm.sender_id,
                  display_name: incomingLiveDm.sender_name,
                  avatar_id: incomingLiveDm.avatar_id || "royal_headband",
                  player_level: incomingLiveDm.sender_level || 1,
                  player_title: incomingLiveDm.sender_title || "Registered Member",
                  favorite_game: incomingLiveDm.favorite_game || "oware",
                  status: "online",
                  is_online_now: true,
                  last_seen_at: incomingLiveDm.created_at,
                };
                setIncomingLiveDm(null);
                if (onOpenDirectMessages) {
                  onOpenDirectMessages(senderProfile);
                } else {
                  onOpenChat();
                }
              }}
              className="h-8 px-3 rounded-xl bg-gradient-to-r from-pink-500 to-amber-500 text-slate-950 font-black text-xs"
            >
              Reply Now →
            </Button>
            <button
              type="button"
              onClick={() => setIncomingLiveDm(null)}
              className="p-1 text-slate-300 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Top IG Brand Header + Direct Messages Inbox Button */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-400 via-rose-500 to-purple-600 text-white flex items-center justify-center shadow-lg">
            <MessageCircle className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-black bg-gradient-to-r from-white via-amber-200 to-pink-200 bg-clip-text text-transparent">
                SwiftGram • Real Users &amp; Live Chat
              </h3>
              <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-black">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping mr-1 inline-block" />
                {Math.max(1, onlineGamers.length)} Users
              </Badge>
            </div>
            <p className="text-xs text-slate-300">
              Tap any real user below to text them 1-on-1 in real time on the site
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() =>
              onOpenDirectMessages ? onOpenDirectMessages(null) : onOpenChat()
            }
            className="h-9 px-3.5 rounded-full bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 hover:opacity-95 text-white font-black text-xs gap-1.5 shadow-lg"
          >
            <SendHorizontal className="w-3.5 h-3.5 -rotate-12" />
            <span>Direct Messages (DMs)</span>
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onOpenChat}
            className="h-9 px-3.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-amber-300 font-black text-xs gap-1.5"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Live Feed</span>
          </Button>
        </div>
      </div>

      {/* 1. Real Site Users Horizontal Strip right on Lobby */}
      {onlineGamers.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-pink-300 flex items-center gap-1.5">
              <span>💬</span>
              <span>
                Real Site Users — Tap &ldquo;Text&rdquo; to Message Anyone Live
              </span>
            </span>
            <button
              type="button"
              onClick={onOpenMeetGamers}
              className="text-[11px] font-bold text-amber-300 hover:underline cursor-pointer"
            >
              Search All Users ({onlineGamers.length}) →
            </button>
          </div>

          <div className="flex items-center gap-2.5 overflow-x-auto pb-1 no-scrollbar">
            {onlineGamers.map((g) => {
              const fav = GAME_LABELS[g.favorite_game] || GAME_LABELS.oware;
              return (
                <div
                  key={g.player_key}
                  className="shrink-0 w-[134px] p-2.5 rounded-2xl bg-slate-950/80 hover:bg-slate-950 border border-white/10 hover:border-pink-400/50 flex flex-col items-center text-center transition-all shadow"
                >
                  {g.ig_note && (
                    <div className="w-full px-2 py-0.5 mb-1.5 rounded-xl bg-white/[0.06] border border-white/10 text-[9px] font-semibold text-amber-200 truncate">
                      {g.ig_note}
                    </div>
                  )}

                  <div
                    onClick={() =>
                      onOpenDirectMessages
                        ? onOpenDirectMessages(g)
                        : onOpenChat()
                    }
                    className="relative cursor-pointer"
                  >
                    <VerifiedGamerAvatar
                      avatarId={g.avatar_id}
                      seedName={g.display_name}
                      size={44}
                      showVerifiedBadge={true}
                    />
                    <span
                      className={`w-3 h-3 rounded-full border-2 border-slate-950 absolute bottom-0 right-0 ${
                        g.is_online_now ? "bg-emerald-400" : "bg-amber-400"
                      }`}
                    />
                  </div>

                  <span className="text-xs font-black text-white truncate w-full mt-1.5">
                    {g.display_name}
                  </span>
                  <span className="text-[9px] text-slate-400 truncate w-full">
                    {g.masked_phone || `${fav.emoji} ${fav.name}`}
                  </span>

                  <div className="flex items-center gap-1 w-full mt-2">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenDirectMessages
                          ? onOpenDirectMessages(g)
                          : onOpenChat()
                      }
                      className="flex-1 py-1.5 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 hover:opacity-95 text-[10px] font-black text-white flex items-center justify-center gap-1 shadow cursor-pointer"
                    >
                      <SendHorizontal className="w-2.5 h-2.5 -rotate-12" />
                      <span>Text</span>
                    </button>
                    {onQuickChallengeGamer && (
                      <button
                        type="button"
                        onClick={() => onQuickChallengeGamer(g)}
                        className="px-2 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500 border border-amber-400/40 text-[10px] font-black text-amber-300 hover:text-slate-950 transition-all cursor-pointer"
                        title={`Challenge ${g.display_name}`}
                      >
                        ⚔️
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. Inline "Start a Conversation" Composer Box directly on the Arena Page */}
      <form
        onSubmit={handleQuickInlinePost}
        className="p-2 rounded-2xl bg-slate-950/90 border border-white/15 flex items-center gap-2 shadow-inner"
      >
        <VerifiedGamerAvatar
          avatarId={playerAvatarId}
          seedName={playerName}
          size={34}
          showVerifiedBadge={false}
        />
        <Input
          value={quickText}
          onChange={(e) => setQuickText(e.target.value)}
          placeholder={`Write a live message as ${playerName} to all users on the site…`}
          className="h-9 flex-1 border-0 bg-transparent text-xs text-white focus-visible:ring-0 px-1"
        />
        <Button
          type="submit"
          size="sm"
          disabled={postingQuick || !quickText.trim()}
          className="h-9 px-4 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-black text-xs gap-1 shrink-0"
        >
          {postingQuick ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </>
          )}
        </Button>
      </form>

      {/* 3. Latest Real-Time User Messages with 1-Tap DM & Reply */}
      {recentMessages.length > 0 && (
        <div className="space-y-1.5">
          {recentMessages.map((m) => (
            <div
              key={m.id}
              className="p-2.5 rounded-2xl bg-slate-950/75 hover:bg-slate-950 border border-white/10 flex items-center justify-between gap-2 transition-all"
            >
              <div
                onClick={onOpenChat}
                className="min-w-0 flex items-center gap-2 flex-1 cursor-pointer"
              >
                <VerifiedGamerAvatar
                  avatarId={m.avatar_id}
                  seedName={m.sender_name}
                  size={26}
                  showVerifiedBadge={true}
                />
                <span className="text-xs font-black text-amber-300 shrink-0">
                  {m.sender_name}:
                </span>
                <p className="text-xs text-slate-200 truncate">{m.message}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {m.room_code && (
                  <button
                    type="button"
                    onClick={() => onJoinByRoomCode(String(m.room_code))}
                    className="px-2.5 py-1 rounded-full bg-emerald-500 text-slate-950 font-black text-[10px] cursor-pointer"
                  >
                    Join #{m.room_code}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (onOpenDirectMessages) {
                      onOpenDirectMessages({
                        player_key: String(
                          m.sender_id || `dm_${normalizeKey(m.sender_name)}`
                        ),
                        user_id: m.sender_id,
                        display_name: m.sender_name,
                        avatar_id: m.avatar_id || "royal_headband",
                        player_level: m.sender_level || 1,
                        player_title: m.sender_title || "Registered Member",
                        favorite_game: m.favorite_game || "oware",
                        status: "online",
                        is_online_now: true,
                        last_seen_at: m.created_at,
                      });
                    } else {
                      onOpenChat();
                    }
                  }}
                  className="px-2.5 py-1 rounded-full bg-pink-500/20 hover:bg-pink-500 border border-pink-400/40 text-pink-200 hover:text-white text-[10px] font-black cursor-pointer"
                >
                  💬 DM
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default GamerCommunityHub;
