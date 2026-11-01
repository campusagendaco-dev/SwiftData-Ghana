import { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { playSound, safeVibrate } from "@/lib/sound";
import { Trophy, Swords, Flame, X, ArrowRight, Sparkles } from "lucide-react";

interface LiveChallengeAlert {
  id: string;
  eventKey: string;
  type: "open" | "accepted";
  roomCode: string;
  gameType: "oware" | "ludo" | "dame" | string;
  creatorId?: string | null;
  creatorName: string;
  opponentName?: string | null;
  stakeAmount: number;
  prizePool: number;
}

function getGameTitle(gameType: string): string {
  const g = String(gameType || "oware").toLowerCase();
  if (g === "oware") return "Ghana Oware";
  if (g === "ludo") return "Ghana Ludo";
  if (g === "dame") return "Ghanaian Dame";
  if (g === "pool") return "8-Ball Pool";
  return g.toUpperCase();
}

function fireBrowserNotification(title: string, body: string, url: string) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      const n = new Notification(title, {
        body,
        icon: "/ludo-challenge-icon.png",
        tag: `swiftdata-arena-${Date.now()}`,
      });
      n.onclick = () => {
        window.focus();
        window.location.href = url;
        n.close();
      };
    }
  } catch (_err) {
    // Ignore browser notification restrictions on unsupported webviews
  }
}

export function ChallengeLiveNotifier() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [alert, setAlert] = useState<LiveChallengeAlert | null>(null);
  const seenEventsRef = useRef<Set<string>>(new Set());

  const markSeen = (key: string) => {
    seenEventsRef.current.add(key);
    try {
      const raw = sessionStorage.getItem("sd_arena_seen_alerts");
      const arr: string[] = raw ? JSON.parse(raw) : [];
      if (!arr.includes(key)) {
        arr.push(key);
        sessionStorage.setItem("sd_arena_seen_alerts", JSON.stringify(arr.slice(-40)));
      }
    } catch (_e) {
      // ignore storage errors
    }
  };

  const hasSeen = (key: string): boolean => {
    if (seenEventsRef.current.has(key)) return true;
    try {
      const raw = sessionStorage.getItem("sd_arena_seen_alerts");
      const arr: string[] = raw ? JSON.parse(raw) : [];
      return arr.includes(key);
    } catch (_e) {
      return false;
    }
  };

  // 1. On App Open: Check for active open challenges or newly accepted live matches
  useEffect(() => {
    let mounted = true;
    const timer = setTimeout(async () => {
      try {
        const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
        const { data: rows } = await (supabase as any)
          .from("game_challenges")
          .select("*")
          .eq("mode", "p2p")
          .in("status", ["open", "in_progress"])
          .gte("updated_at", twelveHoursAgo)
          .order("updated_at", { ascending: false })
          .limit(5);

        if (!mounted || !Array.isArray(rows) || rows.length === 0) return;

        // Prefer showing an open challenge created by someone else, or a recently accepted match
        for (const row of rows) {
          if (row.status === "open") {
            if (user?.id && row.creator_id === user.id) continue;
            const eventKey = `open:${row.id}`;
            if (hasSeen(eventKey)) continue;

            setAlert({
              id: row.id,
              eventKey,
              type: "open",
              roomCode: row.room_code,
              gameType: row.game_type,
              creatorId: row.creator_id,
              creatorName: row.creator_name || "Ghana Champion",
              stakeAmount: Number(row.stake_amount || 0),
              prizePool: Number(row.prize_pool || 0),
            });
            playSound("/sounds/notification_system.mp3", 0.35);
            safeVibrate([150, 80, 150]);
            break;
          } else if (row.status === "in_progress" && row.opponent_name) {
            // Show newly accepted match if it started in the last 20 minutes
            const updatedAgeMs = Date.now() - new Date(row.updated_at).getTime();
            if (updatedAgeMs > 20 * 60 * 1000) continue;
            const eventKey = `accepted:${row.id}`;
            if (hasSeen(eventKey)) continue;

            setAlert({
              id: row.id,
              eventKey,
              type: "accepted",
              roomCode: row.room_code,
              gameType: row.game_type,
              creatorId: row.creator_id,
              creatorName: row.creator_name || "Challenger 1",
              opponentName: row.opponent_name || "Challenger 2",
              stakeAmount: Number(row.stake_amount || 0),
              prizePool: Number(row.prize_pool || 0),
            });
            playSound("/sounds/notification_system.mp3", 0.35);
            safeVibrate([150, 80, 150]);
            break;
          }
        }
      } catch (_err) {
        // Ignore if table is initializing
      }
    }, 2200);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [user?.id]);

  // 2. Real-Time Subscription to Open Challenge Creations & Challenge Acceptances
  useEffect(() => {
    const channel = supabase
      .channel(`global-challenge-notifier-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "game_challenges" },
        (payload: any) => {
          const row = payload.new;
          if (!row || row.mode !== "p2p" || row.status !== "open") return;
          if (user?.id && row.creator_id === user.id) return;

          const eventKey = `open:${row.id}`;
          if (hasSeen(eventKey)) return;

          const gameLabel = getGameTitle(row.game_type);
          const stake = Number(row.stake_amount || 0);
          const prize = Number(row.prize_pool || 0);

          setAlert({
            id: row.id,
            eventKey,
            type: "open",
            roomCode: row.room_code,
            gameType: row.game_type,
            creatorId: row.creator_id,
            creatorName: row.creator_name || "Ghana Champion",
            stakeAmount: stake,
            prizePool: prize,
          });

          playSound("/sounds/notification_system.mp3", 0.45);
          safeVibrate([200, 100, 200]);
          fireBrowserNotification(
            `⚔️ Open ${gameLabel} Challenge (Win GH₵ ${prize.toFixed(2)})!`,
            `${row.creator_name} just posted Room #${row.room_code} (Stake: GH₵ ${stake.toFixed(2)}). Click to accept now!`,
            `/challenges?room=${row.room_code}`
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "game_challenges" },
        (payload: any) => {
          const row = payload.new;
          const oldRow = payload.old;
          if (!row || row.mode !== "p2p") return;

          // Trigger only when status transitions to in_progress with an opponent
          if (row.status === "in_progress" && row.opponent_name && oldRow?.status !== "in_progress") {
            const eventKey = `accepted:${row.id}`;
            if (hasSeen(eventKey)) return;

            const gameLabel = getGameTitle(row.game_type);
            const stake = Number(row.stake_amount || 0);
            const prize = Number(row.prize_pool || 0);
            const isCreator = Boolean(user?.id && row.creator_id === user.id);

            setAlert({
              id: row.id,
              eventKey,
              type: "accepted",
              roomCode: row.room_code,
              gameType: row.game_type,
              creatorId: row.creator_id,
              creatorName: row.creator_name || "Challenger 1",
              opponentName: row.opponent_name || "Challenger 2",
              stakeAmount: stake,
              prizePool: prize,
            });

            playSound("/sounds/notification_system.mp3", 0.5);
            safeVibrate([250, 100, 250]);
            fireBrowserNotification(
              isCreator
                ? `🚨 ${row.opponent_name} Accepted Your ${gameLabel} Challenge!`
                : `🔥 Challenge Accepted: ${row.creator_name} vs ${row.opponent_name}!`,
              isCreator
                ? `Room #${row.room_code} is LIVE! Play your turn now for GH₵ ${prize.toFixed(2)}!`
                : `${row.opponent_name} accepted ${row.creator_name}'s ${gameLabel} duel for GH₵ ${prize.toFixed(2)}!`,
              `/challenges?room=${row.room_code}`
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  if (!alert) return null;

  // Hide if already viewing that exact room on /challenges
  const isAlreadyInRoom =
    location.pathname.includes("challenges") &&
    location.search.toUpperCase().includes(alert.roomCode.toUpperCase());
  if (isAlreadyInRoom) return null;

  const gameLabel = getGameTitle(alert.gameType);
  const isCreatorAlert = Boolean(user?.id && alert.creatorId && user.id === alert.creatorId);

  const handleDismiss = () => {
    markSeen(alert.eventKey);
    setAlert(null);
  };

  const handleAction = () => {
    markSeen(alert.eventKey);
    const targetRoom = alert.roomCode;
    setAlert(null);
    navigate(`/challenges?room=${encodeURIComponent(targetRoom)}`);
  };

  return (
    <div className="fixed bottom-20 sm:bottom-6 left-4 right-4 sm:left-6 sm:right-auto sm:w-[400px] z-[95] animate-in slide-in-from-bottom-5 fade-in duration-300">
      <div className="relative overflow-hidden rounded-3xl bg-slate-950/95 backdrop-blur-2xl border-2 border-amber-500/50 shadow-[0_20px_60px_rgba(0,0,0,0.85)] p-4">
        {/* Top glowing accent bar */}
        <div
          className={`absolute top-0 inset-x-0 h-1 bg-gradient-to-r ${
            alert.type === "open"
              ? "from-amber-400 via-orange-500 to-emerald-400"
              : "from-emerald-400 via-teal-400 to-amber-400"
          }`}
        />

        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss challenge alert"
          className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-start gap-3.5 pr-6">
          {/* Game Artwork Thumbnail */}
          <div className="relative shrink-0">
            {alert.gameType === "ludo" ? (
              <img
                src="/ludo-challenge-icon.png"
                alt="Ghana Ludo"
                className="w-13 h-13 rounded-2xl object-cover border border-amber-400/50 shadow-lg"
              />
            ) : alert.gameType === "oware" ? (
              <img
                src="/oware-challenge-icon.jpg"
                alt="Ghana Oware"
                className="w-13 h-13 rounded-2xl object-cover border border-amber-400/50 shadow-lg"
              />
            ) : alert.gameType === "pool" ? (
              <img
                src="/pool-challenge-icon.jpg"
                alt="8-Ball Pool"
                className="w-13 h-13 rounded-2xl object-cover border border-sky-400/50 shadow-lg"
              />
            ) : (
              <div className="w-13 h-13 rounded-2xl bg-gradient-to-br from-emerald-500/30 to-slate-900 border border-emerald-400/50 flex items-center justify-center text-2xl shadow-lg">
                ♟️
              </div>
            )}
            <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center shadow">
              {alert.type === "open" ? <Swords className="w-3 h-3" /> : <Flame className="w-3 h-3" />}
            </span>
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${
                  alert.type === "open"
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                    : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                }`}
              >
                <Sparkles className="w-2.5 h-2.5" />
                {alert.type === "open"
                  ? "Open Challenge Live"
                  : isCreatorAlert
                  ? "Your Challenge Accepted!"
                  : "Challenge Accepted & Live"}
              </span>
              <span className="text-[10px] font-mono font-bold text-slate-400">
                Room #{alert.roomCode}
              </span>
            </div>

            {alert.type === "open" ? (
              <>
                <p className="text-xs sm:text-sm font-black text-white leading-snug">
                  {alert.creatorName} invited players to a{" "}
                  <span className="text-amber-400">{gameLabel}</span> duel!
                </p>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-slate-300">
                    Stake: <strong className="text-amber-300 font-mono">GH₵ {alert.stakeAmount.toFixed(2)}</strong>
                  </span>
                  <span className="text-slate-600">•</span>
                  <span className="text-emerald-400 font-black font-mono flex items-center gap-1">
                    <Trophy className="w-3 h-3" /> Win GH₵ {alert.prizePool.toFixed(2)}
                  </span>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs sm:text-sm font-black text-white leading-snug">
                  <span className="text-emerald-400">{alert.opponentName}</span> accepted{" "}
                  <span className="text-amber-300">{isCreatorAlert ? "your" : `${alert.creatorName}'s`}</span>{" "}
                  {gameLabel} challenge!
                </p>
                <p className="text-[11px] text-slate-300">
                  Winner Pot:{" "}
                  <strong className="text-emerald-400 font-mono">GH₵ {alert.prizePool.toFixed(2)}</strong> • Match is LIVE now!
                </p>
              </>
            )}
          </div>
        </div>

        <div className="mt-3.5 flex items-center gap-2">
          <button
            type="button"
            onClick={handleAction}
            className={`flex-1 py-2.5 px-4 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 shadow-lg transition-all cursor-pointer ${
              alert.type === "open"
                ? "bg-gradient-to-r from-amber-400 via-orange-500 to-amber-500 text-slate-950 hover:opacity-95"
                : "bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-500 text-slate-950 hover:opacity-95"
            }`}
          >
            {alert.type === "open"
              ? `⚔️ Accept Challenge (#${alert.roomCode})`
              : isCreatorAlert
              ? `🚨 Play Your Turn Now (#${alert.roomCode})`
              : `🔥 View Live Arena (#${alert.roomCode})`}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-bold text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChallengeLiveNotifier;

