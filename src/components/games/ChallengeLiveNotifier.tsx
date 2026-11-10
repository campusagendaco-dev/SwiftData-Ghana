import { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { safeVibrate } from "@/lib/sound";
import { ui as arenaUi } from "@/lib/audio/arenaAudio";
import { getGameMeta } from "@/components/games/hub/gameCatalog";
import { Trophy, X, ArrowRight } from "lucide-react";

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
  if (g === "slash") return "Chale Slash";
  if (g === "candy") return "Alewa & Kube Crush";
  if (g === "buggy") return "Beach Buggy Racing";
  return g.toUpperCase();
}

function isRowPrivateAndNotForUser(row: any, currentUserId?: string | null): boolean {
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  if (!meta.is_private) return false;
  if (!currentUserId) return true;
  if (row.creator_id === currentUserId || row.opponent_id === currentUserId) return false;
  if (meta.invited_user_id && meta.invited_user_id === currentUserId) return false;
  return true;
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
          .select("id,room_code,game_type,mode,creator_id,creator_name,opponent_id,opponent_name,stake_amount,prize_pool,status,current_turn,metadata,created_at,updated_at")
          .eq("mode", "p2p")
          .in("status", ["open", "in_progress"])
          .gte("updated_at", twelveHoursAgo)
          .order("updated_at", { ascending: false })
          .limit(5);

        if (!mounted || !Array.isArray(rows) || rows.length === 0) return;

        // Prefer showing an open public challenge created by someone else, or a recently accepted match
        for (const row of rows) {
          if (isRowPrivateAndNotForUser(row, user?.id)) continue;
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
            arenaUi.invite();
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
            arenaUi.invite();
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
          if (isRowPrivateAndNotForUser(row, user?.id)) return;

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

          arenaUi.invite();
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
          if (isRowPrivateAndNotForUser(row, user?.id)) return;

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

            arenaUi.invite();
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

  // Hide if already inside the Challenge Arena (which has its own Live Public Lobby & Private Invite Modal)
  if (location.pathname.startsWith("/challenges")) return null;

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

  const meta = getGameMeta(alert.gameType);
  const accent = meta?.accent || "#f59e0b";
  const isOpen = alert.type === "open";
  const headline = isOpen
    ? `${alert.creatorName} wants a ${gameLabel} match`
    : `${alert.opponentName} accepted ${isCreatorAlert ? "your" : `${alert.creatorName}'s`} challenge`;
  const cta = isOpen ? "Accept challenge" : isCreatorAlert ? "Play your turn" : "Watch live";

  return (
    <div className="fixed top-3 sm:top-auto sm:bottom-6 left-3 right-3 sm:left-6 sm:right-auto sm:w-[380px] z-[95] animate-in slide-in-from-top-4 sm:slide-in-from-bottom-4 fade-in duration-300">
      <div
        className="relative overflow-hidden rounded-2xl bg-[#0b1220]/95 border border-white/10 p-3.5 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)]"
        style={{ boxShadow: `0 0 0 1px ${accent}55, 0 18px 50px -12px rgba(0,0,0,0.85)` }}
      >
        <div className="flex items-start gap-3">
          <span
            className="h-11 w-11 shrink-0 rounded-xl flex items-center justify-center text-2xl"
            style={{ background: `${accent}22`, boxShadow: `inset 0 0 0 1px ${accent}55` }}
            aria-hidden
          >
            {meta?.emoji || "⚔️"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: accent }}>
              {isOpen ? "Live challenge" : "Match is live"} · #{alert.roomCode}
            </p>
            <p className="text-[14px] font-extrabold text-white leading-snug mt-0.5">{headline}</p>
            {alert.prizePool > 0 ? (
              <p className="text-[12px] text-slate-400 mt-0.5 flex items-center gap-1">
                <Trophy className="w-3.5 h-3.5 text-amber-300" />
                Win <strong className="text-emerald-300">GH₵ {alert.prizePool.toFixed(2)}</strong>
                {isOpen && alert.stakeAmount > 0 && <span> · stake GH₵ {alert.stakeAmount.toFixed(2)}</span>}
              </p>
            ) : (
              <p className="text-[12px] text-slate-400 mt-0.5">Free match · earn Arena Points</p>
            )}
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="h-7 w-7 shrink-0 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 flex items-center justify-center"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={handleAction}
            className="flex-1 h-10 rounded-xl text-slate-950 font-extrabold text-[13px] inline-flex items-center justify-center gap-1.5 transition hover:brightness-110"
            style={{ background: accent }}
          >
            {cta} <ArrowRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="h-10 px-3.5 rounded-xl border border-white/10 text-[13px] font-bold text-slate-300 hover:text-white hover:bg-white/5"
          >
            Later
          </button>
        </div>
        {/* auto-dismiss countdown */}
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/5">
          <div className="h-full arena-countdown-bar" style={{ background: accent }} onAnimationEnd={handleDismiss} />
        </div>
      </div>
    </div>
  );
}

export default ChallengeLiveNotifier;

