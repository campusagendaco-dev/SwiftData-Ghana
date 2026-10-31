import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAppTheme } from "@/contexts/ThemeContext";
import {
  Crown, Medal, Award, Star, Zap, Users, RefreshCw, ImageDown,
  Clock, Trophy, TrendingUp, AlertCircle, Target, Flame,
  ChevronUp, ChevronDown, Minus, Share2, X, BarChart3,
  Sparkles, ShieldCheck,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import SpinTheWheel from "@/components/SpinTheWheel";
import { toast } from "sonner";

// ── Interfaces ─────────────────────────────────────────────────────────────────
interface LeaderboardEntry {
  rank_position: number;
  agent_name: string;
  day_orders: number;
  week_orders: number;
  month_orders: number;
  week_sales_amount: number;
  streak: number;
  is_current_user: boolean;
}

interface AlltimeEntry {
  rank_position: number;
  agent_name: string;
  total_orders: number;
  total_amount: number;
  is_current_user: boolean;
}

interface RankedEntry extends LeaderboardEntry {
  display_rank: number;
  display_value: number;
}

type Tab = "today" | "week" | "month" | "sales" | "alltime";

// ── Medal config ───────────────────────────────────────────────────────────────
const MEDALS = [
  {
    rank: 1, label: "Market Leader", icon: Crown,
    badgeBg: "bg-amber-400", badgeText: "text-black",
    avatarBg: "bg-amber-400/15 border-amber-400/35", avatarText: "text-amber-400",
    accent: "text-amber-400", pillarH: "h-40",
    pillarBg: "bg-gradient-to-t from-amber-400/20 via-amber-400/8 to-transparent border border-b-0 border-amber-400/20",
    cardBorder: "border-amber-400/25",
    cardBg: "bg-gradient-to-b from-amber-400/8 to-transparent",
  },
  {
    rank: 2, label: "Silver Contender", icon: Medal,
    badgeBg: "bg-slate-400", badgeText: "text-black",
    avatarBg: "bg-slate-400/15 border-slate-400/30", avatarText: "text-slate-300",
    accent: "text-slate-300", pillarH: "h-28",
    pillarBg: "bg-gradient-to-t from-slate-500/15 to-transparent border border-b-0 border-slate-500/15",
    cardBorder: "border-border", cardBg: "",
  },
  {
    rank: 3, label: "Bronze Tier", icon: Award,
    badgeBg: "bg-orange-700", badgeText: "text-white",
    avatarBg: "bg-orange-700/15 border-orange-700/30", avatarText: "text-orange-500",
    accent: "text-orange-500", pillarH: "h-20",
    pillarBg: "bg-gradient-to-t from-orange-700/15 to-transparent border border-b-0 border-orange-700/15",
    cardBorder: "border-border", cardBg: "",
  },
];

const TIERS = [
  { label: "Diamond", min: 100, color: "text-cyan-400",   bg: "bg-cyan-400/10 border-cyan-400/25",   icon: "💎" },
  { label: "Gold",    min: 50,  color: "text-amber-400",  bg: "bg-amber-400/10 border-amber-400/25",  icon: "🥇" },
  { label: "Silver",  min: 25,  color: "text-slate-300",  bg: "bg-slate-400/10 border-slate-400/20",  icon: "🥈" },
  { label: "Bronze",  min: 10,  color: "text-orange-500", bg: "bg-orange-600/10 border-orange-600/20",icon: "🥉" },
  { label: "Starter", min: 1,   color: "text-muted-foreground", bg: "bg-muted border-border", icon: "⭐" },
];

const getTier = (weekOrders: number) =>
  TIERS.find((t) => weekOrders >= t.min) ?? TIERS[TIERS.length - 1];

const initials = (name: string) =>
  name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

const fmtGHS = (n: number) =>
  n >= 1000 ? `₵${(n / 1000).toFixed(1)}k` : `₵${n.toFixed(0)}`;

// ── Countdown hook ─────────────────────────────────────────────────────────────
const useCountdown = () => {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const s = (23 - now.getUTCHours()) * 3600 + (59 - now.getUTCMinutes()) * 60 + (59 - now.getUTCSeconds());
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
      setLabel(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return label;
};

// ── Confetti ──────────────────────────────────────────────────────────────────
const Confetti = ({ active }: { active: boolean }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!active || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = ["#fbbf24", "#f59e0b", "#10b981", "#6366f1", "#ec4899", "#ffffff", "#34d399"];
    const particles = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width, y: -20,
      vx: (Math.random() - 0.5) * 5, vy: Math.random() * 4 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 9 + 4,
      rotation: Math.random() * 360, rotV: (Math.random() - 0.5) * 6,
      alpha: 1,
    }));
    let animId: number;
    const start = Date.now();
    const draw = () => {
      const elapsed = Date.now() - start;
      if (elapsed > 4500) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.rotation += p.rotV;
        if (elapsed > 3000) p.alpha = Math.max(0, p.alpha - 0.015);
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.55);
        ctx.restore();
      });
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); ctx.clearRect(0, 0, canvas.width, canvas.height); };
  }, [active]);
  if (!active) return null;
  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-50" />;
};

// ── Comparison modal ───────────────────────────────────────────────────────────
const CompareModal = ({
  entry, currentUser, onClose, isDark,
}: {
  entry: RankedEntry;
  currentUser: RankedEntry | undefined;
  onClose: () => void;
  isDark: boolean;
}) => {
  const head = isDark ? "text-white" : "text-gray-900";
  const muted = isDark ? "text-white/40" : "text-gray-400";
  const cardBg = isDark ? "bg-white/[0.03] border-white/[0.06]" : "bg-gray-50 border-gray-200";

  const rows = [
    { label: "Today",     a: currentUser?.day_orders ?? 0,          b: entry.day_orders },
    { label: "This Week", a: currentUser?.week_orders ?? 0,         b: entry.week_orders },
    { label: "This Month",a: currentUser?.month_orders ?? 0,        b: entry.month_orders },
    { label: "Streak 🔥", a: currentUser?.streak ?? 0,              b: entry.streak },
    { label: "Wk Sales",  a: currentUser?.week_sales_amount ?? 0,   b: entry.week_sales_amount, currency: true },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-4 sm:pb-0" onClick={onClose}>
      <div
        className={`w-full max-w-sm rounded-3xl border p-5 space-y-4 ${isDark ? "bg-[#0c1022] border-white/[0.08]" : "bg-white border-gray-200 shadow-xl"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className={`font-black text-base ${head}`}>Head-to-Head</h3>
          <button type="button" onClick={onClose} className={`w-8 h-8 rounded-xl flex items-center justify-center ${isDark ? "bg-white/5 hover:bg-white/10 text-white/50" : "bg-gray-100 hover:bg-gray-200 text-gray-500"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className={`w-10 h-10 rounded-2xl bg-indigo-500 flex items-center justify-center text-white font-black text-sm mx-auto mb-1`}>
              {initials(currentUser?.agent_name ?? "Me")}
            </div>
            <p className={`text-[10px] font-black truncate ${head}`}>{currentUser?.agent_name ?? "You"}</p>
            <p className={`text-[9px] ${muted}`}>#{currentUser?.display_rank}</p>
          </div>
          <div className="flex items-center justify-center">
            <span className="text-xs font-black text-white/20">VS</span>
          </div>
          <div>
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-sm mx-auto mb-1 border ${
              entry.display_rank === 1 ? "bg-amber-400/15 border-amber-400/35 text-amber-400"
              : entry.display_rank === 2 ? "bg-slate-400/15 border-slate-400/30 text-slate-300"
              : entry.display_rank === 3 ? "bg-orange-700/15 border-orange-700/30 text-orange-500"
              : isDark ? "bg-white/[0.04] border-white/[0.06] text-white/40" : "bg-gray-100 border-gray-200 text-gray-500"
            }`}>
              {initials(entry.agent_name)}
            </div>
            <p className={`text-[10px] font-black truncate ${head}`}>{entry.agent_name}</p>
            <p className={`text-[9px] ${muted}`}>#{entry.display_rank}</p>
          </div>
        </div>

        {/* Stat rows */}
        <div className={`rounded-2xl border divide-y ${isDark ? "border-white/[0.06] divide-white/[0.04]" : "border-gray-100 divide-gray-100"}`}>
          {rows.map(({ label, a, b, currency }) => {
            const youWin = a > b, tied = a === b;
            return (
              <div key={label} className="grid grid-cols-3 items-center px-3 py-2.5 gap-2 text-center">
                <span className={`font-black text-sm ${youWin ? "text-emerald-400" : tied ? head : muted}`}>
                  {currency ? fmtGHS(a) : a}
                </span>
                <span className={`text-[10px] font-bold ${muted}`}>{label}</span>
                <span className={`font-black text-sm ${!youWin && !tied ? "text-emerald-400" : tied ? head : muted}`}>
                  {currency ? fmtGHS(b) : b}
                </span>
              </div>
            );
          })}
        </div>

        <p className={`text-[10px] text-center ${muted}`}>
          Green = leading. Names of other agents are anonymised for privacy.
        </p>
      </div>
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────
const DashboardLeaderboard = () => {
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [alltimeData, setAlltimeData] = useState<AlltimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [alltimeLoading, setAlltimeLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [comparing, setComparing] = useState<RankedEntry | null>(null);
  const [confettiActive, setConfettiActive] = useState(false);
  const [rankChanges, setRankChanges] = useState<{ today: number | null; week: number | null }>({ today: null, week: null });
  const shareCardRef = useRef<HTMLDivElement>(null);
  const { isDark } = useAppTheme();
  const countdown = useCountdown();

  const RANK_KEY = "sd_lb_rank";

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const { data: result, error: rpcError } = await supabase.rpc("get_agent_leaderboard");
      if (rpcError) throw rpcError;
      const entries: LeaderboardEntry[] = (result || []).map((r: any) => ({
        ...r,
        month_orders: r.month_orders ?? 0,
        week_sales_amount: r.week_sales_amount ?? 0,
        streak: r.streak ?? 0,
      }));
      setData(entries);
      setLastRefreshed(new Date());

      // ── Rank change detection ──────────────────────────────────────────────
      const me = entries.find((e) => e.is_current_user);
      if (me) {
        const stored = JSON.parse(localStorage.getItem(RANK_KEY) || "{}");
        const todayRank = me.rank_position;
        const weekRank  = entries
          .slice()
          .sort((a, b) => b.week_orders - a.week_orders)
          .findIndex((e) => e.is_current_user) + 1;

        setRankChanges({
          today: stored.today ? todayRank - stored.today : null,
          week:  stored.week  ? weekRank  - stored.week  : null,
        });

        // Notify if rank improved
        const improved = (stored.today && todayRank < stored.today) || (stored.week && weekRank < stored.week);
        if (improved && silent) {
          toast.success(`You climbed the rankings! 🚀`, {
            description: `You're now #${todayRank} today${weekRank < (stored.week ?? weekRank) ? ` and #${weekRank} this week` : ""}.`,
          });
          import("@/utils/safeBrowserNotification").then(({ showSafeBrowserNotification }) => {
            void showSafeBrowserNotification("SwiftData – You climbed! 🏆", {
              body: `You're now ranked #${todayRank} on the leaderboard.`,
              icon: "/logo.png",
              url: "/dashboard/leaderboard",
            });
          });
        }

        localStorage.setItem(RANK_KEY, JSON.stringify({ today: todayRank, week: weekRank }));

        // Confetti if #1
        if (me.rank_position === 1 && !silent) setTimeout(() => setConfettiActive(true), 600);
      }
    } catch (err: any) {
      setError(err.message || "Could not load leaderboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadAlltime = useCallback(async () => {
    if (alltimeData.length > 0) return;
    setAlltimeLoading(true);
    try {
      const { data: result, error } = await supabase.rpc("get_alltime_leaderboard");
      if (error) throw error;
      setAlltimeData(result || []);
    } catch (e: any) {
      toast.error("Could not load Hall of Fame", { description: e.message });
    } finally {
      setAlltimeLoading(false);
    }
  }, [alltimeData.length]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 5 min
  useEffect(() => {
    const id = setInterval(() => load(true), 5 * 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Confetti auto-off
  useEffect(() => {
    if (confettiActive) {
      const id = setTimeout(() => setConfettiActive(false), 5000);
      return () => clearTimeout(id);
    }
  }, [confettiActive]);

  useEffect(() => {
    if (tab === "alltime") loadAlltime();
  }, [tab, loadAlltime]);

  // ── Ranked list for active tab ───────────────────────────────────────────────
  const ranked: RankedEntry[] = (() => {
    if (tab === "alltime") return [];
    const sorters: Record<Tab, (a: LeaderboardEntry, b: LeaderboardEntry) => number> = {
      today:  (a, b) => b.day_orders - a.day_orders   || b.week_orders - a.week_orders,
      week:   (a, b) => b.week_orders - a.week_orders  || b.day_orders - a.day_orders,
      month:  (a, b) => b.month_orders - a.month_orders|| b.week_orders - a.week_orders,
      sales:  (a, b) => b.week_sales_amount - a.week_sales_amount || b.week_orders - a.week_orders,
      alltime: () => 0,
    };
    return data
      .slice()
      .sort(sorters[tab])
      .map((entry, i) => ({
        ...entry,
        display_rank: i + 1,
        display_value: tab === "today" ? entry.day_orders
          : tab === "week"  ? entry.week_orders
          : tab === "month" ? entry.month_orders
          : entry.week_sales_amount,
      }));
  })();

  const topThree    = ranked.slice(0, 3);
  const restRanked  = ranked.slice(3);
  const maxValue    = Math.max(...ranked.map((d) => d.display_value), 1);
  const totalToday  = data.reduce((s, d) => s + d.day_orders, 0);
  const totalWeek   = data.reduce((s, d) => s + d.week_orders, 0);
  const totalMonth  = data.reduce((s, d) => s + d.month_orders, 0);
  const currentUser = ranked.find((d) => d.is_current_user);
  const currentAlltime = alltimeData.find((d) => d.is_current_user);

  // ── Motivational stats ───────────────────────────────────────────────────────
  const ordersFromNext = currentUser && currentUser.display_rank > 1
    ? ranked[currentUser.display_rank - 2]?.display_value - currentUser.display_value
    : 0;
  const ordersFromPodium = currentUser && currentUser.display_rank > 3
    ? (ranked[2]?.display_value ?? 0) - currentUser.display_value
    : 0;
  const pctOfNetwork = totalToday > 0 && currentUser
    ? Math.round((currentUser.day_orders / totalToday) * 100)
    : 0;
  const podiumProgress = currentUser && currentUser.display_rank > 3 && ranked[2]
    ? Math.min(100, Math.round((currentUser.display_value / ranked[2].display_value) * 100))
    : 0;

  // ── WhatsApp share ───────────────────────────────────────────────────────────
  const shareWhatsApp = () => {
    if (!currentUser) return;
    const tier = getTier(currentUser.week_orders);
    const text = encodeURIComponent(
      `🏆 I'm ranked #${currentUser.display_rank} on the SwiftData Ghana Agent Leaderboard!\n\n` +
      `📊 Today: ${currentUser.day_orders} orders (${pctOfNetwork}% of network today)\n` +
      `📈 This week: ${currentUser.week_orders} orders\n` +
      (currentUser.streak > 0 ? `🔥 ${currentUser.streak}-day streak!\n` : "") +
      `${tier.icon} Tier: ${tier.label}\n\n` +
      `Join the SwiftData reseller network 👉 swiftdatagh.shop`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  // ── Download share card ──────────────────────────────────────────────────────
  const downloadCard = useCallback(async () => {
    if (!shareCardRef.current || !currentUser) return;
    setDownloading(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(shareCardRef.current, { backgroundColor: null, scale: 2, useCORS: true, logging: false });
      const link = document.createElement("a");
      link.download = `swiftdata-rank-${currentUser.display_rank}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (e) { console.error("Capture failed:", e); }
    finally { setDownloading(false); }
  }, [currentUser]);

  // ── Request notification permission ─────────────────────────────────────────
  const requestNotifPermission = async () => {
    if (!("Notification" in window)) return toast.error("Notifications not supported on this browser.");
    const perm = await Notification.requestPermission();
    if (perm === "granted") toast.success("Rank alerts enabled!", { description: "We'll notify you when your rank changes." });
    else toast.error("Permission denied. Enable notifications in browser settings.");
  };

  // ── Theme shorthands ─────────────────────────────────────────────────────────
  const card    = isDark ? "bg-white/[0.025] border-white/[0.06]" : "bg-white border-gray-200 shadow-sm";
  const muted   = isDark ? "text-white/35"  : "text-gray-400";
  const head    = isDark ? "text-white"     : "text-gray-900";
  const sub     = isDark ? "text-white/50"  : "text-gray-500";
  const divider = isDark ? "divide-white/[0.05]" : "divide-gray-100";
  const rowBase = isDark ? "hover:bg-white/[0.02]" : "hover:bg-gray-50/80";

  // ── Tab config ───────────────────────────────────────────────────────────────
  const TABS: { key: Tab; label: string; icon: any; total?: string }[] = [
    { key: "today",   label: "Today",      icon: Flame,      total: `${totalToday} orders` },
    { key: "week",    label: "This Week",  icon: TrendingUp, total: `${totalWeek} orders` },
    { key: "month",   label: "This Month", icon: BarChart3,  total: `${totalMonth} orders` },
    { key: "sales",   label: "Sales Vol.", icon: Zap,        total: "by GHS" },
    { key: "alltime", label: "Hall of Fame", icon: Trophy,   total: "" },
  ];

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="space-y-5 max-w-5xl mx-auto pb-16 px-4 sm:px-0">
      <Skeleton className="h-32 w-full rounded-3xl" />
      <Skeleton className="h-10 w-72 rounded-2xl" />
      <div className="grid grid-cols-3 gap-3">{[0,1,2].map(i => <Skeleton key={i} className="h-64 rounded-2xl" />)}</div>
      <Skeleton className="h-96 w-full rounded-2xl" />
    </div>
  );

  if (error) return (
    <div className="max-w-sm mx-auto mt-16 text-center space-y-4 px-4">
      <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
        <AlertCircle className="w-8 h-8 text-red-500" />
      </div>
      <p className={`text-sm ${muted}`}>{error}</p>
      <button type="button" onClick={() => load()}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-400 text-black font-bold text-sm">
        <RefreshCw className="w-4 h-4" /> Retry
      </button>
    </div>
  );

  return (
    <div className="space-y-5 max-w-5xl mx-auto pb-16 px-4 sm:px-0">
      <Confetti active={confettiActive} />
      {comparing && currentUser && (
        <CompareModal entry={comparing} currentUser={currentUser} onClose={() => setComparing(null)} isDark={isDark} />
      )}

      {/* ── Hero header ─────────────────────────────────────────────────────── */}
      <div className={`relative overflow-hidden rounded-3xl border p-5 md:p-7 ${card}`}>
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-amber-400/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-56 h-56 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row md:items-start justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-500 text-[10px] font-black uppercase tracking-widest">Live Rankings</span>
            </div>
            <h1 className={`text-3xl md:text-4xl font-black tracking-tight mb-1 ${head}`}>Agent Leaderboard</h1>
            <p className={`text-sm ${sub}`}>Real-time rankings across the SwiftData reseller network.</p>
          </div>

          <div className={`grid grid-cols-3 divide-x rounded-2xl border shrink-0 ${isDark ? "bg-white/[0.02] border-white/[0.06] divide-white/[0.06]" : "bg-gray-50 border-gray-200 divide-gray-200"}`}>
            {[
              { label: "Agents",    value: data.length,  color: head },
              { label: "Today",     value: totalToday,   color: "text-amber-400" },
              { label: "This Week", value: totalWeek,    color: "text-indigo-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="px-4 py-3 text-center">
                <p className={`text-2xl font-black ${color}`}>{value}</p>
                <p className={`text-[10px] font-bold uppercase tracking-widest mt-0.5 ${muted}`}>{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative mt-4 pt-4 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock className={`w-3.5 h-3.5 ${muted}`} />
            <span className={`text-xs ${muted}`}>Daily reset in</span>
            <span className="text-xs font-black text-amber-400 tabular-nums">{countdown}</span>
          </div>
          <div className="flex items-center gap-2">
            {lastRefreshed && <span className={`text-[10px] ${muted}`}>Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
            <button type="button" onClick={requestNotifPermission}
              className={`text-[10px] font-bold px-3 py-1.5 rounded-xl border transition-all ${isDark ? "bg-white/[0.03] border-white/[0.06] text-white/40 hover:text-white" : "bg-gray-100 border-gray-200 text-gray-400 hover:text-gray-700"}`}>
              Enable Alerts
            </button>
            <button type="button" onClick={() => load(true)} disabled={refreshing} aria-label="Refresh"
              className={`w-8 h-8 rounded-xl flex items-center justify-center border transition-all hover:scale-105 disabled:opacity-40 ${isDark ? "bg-white/[0.03] border-white/[0.06] text-white/40 hover:text-white" : "bg-gray-100 border-gray-200 text-gray-400"}`}>
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-black whitespace-nowrap transition-all shrink-0 ${
              tab === key
                ? "bg-amber-400 text-black shadow-md shadow-amber-400/20"
                : `border ${isDark ? "bg-white/[0.02] border-white/[0.06] text-white/40 hover:text-white" : "bg-white border-gray-200 text-gray-400 hover:text-gray-700"}`
            }`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* ── Your rank snapshot ───────────────────────────────────────────────── */}
      {currentUser && tab !== "alltime" && (
        <div className={`relative overflow-hidden rounded-2xl border p-4 sm:p-5 ${isDark ? "bg-indigo-500/8 border-indigo-500/20" : "bg-indigo-50 border-indigo-200"}`}>
          <div className="absolute -right-8 -top-8 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="relative flex flex-wrap items-center gap-4">
            {/* Avatar + name */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-indigo-500 flex items-center justify-center text-white font-black text-base shrink-0 shadow-lg shadow-indigo-500/25">
                {initials(currentUser.agent_name)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`font-black text-sm truncate ${head}`}>{currentUser.agent_name}</p>
                  {(() => { const tier = getTier(currentUser.week_orders); return (
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${tier.bg} ${tier.color}`}>
                      {tier.icon} {tier.label}
                    </span>
                  ); })()}
                  {currentUser.streak >= 3 && (
                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400">
                      🔥 {currentUser.streak}d streak
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {pctOfNetwork > 0 && (
                    <span className={`text-[10px] ${muted}`}>{pctOfNetwork}% of today's network orders</span>
                  )}
                  {rankChanges.today !== null && rankChanges.today !== 0 && tab === "today" && (
                    <span className={`flex items-center gap-0.5 text-[10px] font-bold ${rankChanges.today < 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {rankChanges.today < 0 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {Math.abs(rankChanges.today)} since last visit
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Rank */}
            <div className="text-right shrink-0">
              <p className="text-3xl font-black text-indigo-400">#{currentUser.display_rank}</p>
              <p className={`text-[10px] font-bold ${muted}`}>
                {tab === "sales" ? fmtGHS(currentUser.display_value) : `${currentUser.display_value} ${tab === "today" ? "today" : tab === "week" ? "this week" : "this month"}`}
              </p>
            </div>
          </div>

          {/* Motivational stats row */}
          <div className="relative mt-4 pt-4 border-t border-indigo-500/15 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* X orders from next rank */}
            {ordersFromNext > 0 && (
              <div className={`rounded-xl p-3 ${isDark ? "bg-white/[0.04]" : "bg-white/60"}`}>
                <p className={`text-[10px] font-bold uppercase tracking-widest ${muted} mb-1`}>To Beat #{currentUser.display_rank - 1}</p>
                <p className="text-lg font-black text-amber-400">{tab === "sales" ? fmtGHS(ordersFromNext) : `+${ordersFromNext}`}</p>
                <p className={`text-[10px] ${muted}`}>{tab === "sales" ? "more in sales" : "more orders needed"}</p>
              </div>
            )}
            {/* To podium */}
            {ordersFromPodium > 0 && (
              <div className={`rounded-xl p-3 ${isDark ? "bg-white/[0.04]" : "bg-white/60"}`}>
                <p className={`text-[10px] font-bold uppercase tracking-widest ${muted} mb-1`}>To Podium (#3)</p>
                <div className="space-y-1.5">
                  <p className="text-lg font-black text-emerald-400">{tab === "sales" ? fmtGHS(ordersFromPodium) : `+${ordersFromPodium}`} away</p>
                  <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? "bg-white/[0.06]" : "bg-gray-100"}`}>
                    <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${podiumProgress}%` }} />
                  </div>
                  <p className={`text-[10px] ${muted}`}>{podiumProgress}% of the way there</p>
                </div>
              </div>
            )}
            {/* Share */}
            <div className={`rounded-xl p-3 flex flex-col justify-between ${isDark ? "bg-white/[0.04]" : "bg-white/60"}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest ${muted} mb-2`}>Share Your Rank</p>
              <div className="flex gap-2">
                <button type="button" onClick={shareWhatsApp}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-black text-[11px] transition-all active:scale-95">
                  <Share2 className="w-3.5 h-3.5" /> WhatsApp
                </button>
                <button type="button" onClick={downloadCard} disabled={downloading}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-black text-[11px] transition-all active:scale-95 border ${isDark ? "border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.04]" : "border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50"}`}>
                  {downloading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ImageDown className="w-3.5 h-3.5" />}
                  PNG
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Podium (top 3) ──────────────────────────────────────────────────── */}
      {tab !== "alltime" && topThree.length > 0 && (
        <div>
          <p className={`text-[10px] font-black uppercase tracking-[0.2em] mb-4 flex items-center gap-2 ${muted}`}>
            <Trophy className="w-3 h-3" /> Top Performers
          </p>
          <div className="grid grid-cols-3 gap-2 sm:gap-4 items-end">
            {([1, 0, 2] as const).map((srcIdx) => {
              const entry = topThree[srcIdx];
              if (!entry) return <div key={srcIdx} />;
              const medal = MEDALS[entry.display_rank - 1];
              const isFirst = entry.display_rank === 1;
              return (
                <div key={entry.display_rank} className="flex flex-col items-center">
                  {isFirst && <Crown className="w-5 h-5 text-amber-400 mb-1 drop-shadow-[0_0_10px_rgba(251,191,36,0.7)]" />}
                  <div
                    className={`w-full relative rounded-2xl border p-3 sm:p-5 text-center cursor-pointer transition-all hover:scale-[1.02] shadow-lg ${medal.cardBg} ${medal.cardBorder}`}
                    onClick={() => setComparing(entry)}
                  >
                    {isFirst && <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-28 h-12 bg-amber-400/25 rounded-full blur-2xl pointer-events-none" />}
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black mb-2 shadow-md ${medal.badgeBg} ${medal.badgeText}`}>
                      {entry.display_rank}
                    </span>
                    <div className={`mx-auto mb-2 flex items-center justify-center font-black rounded-2xl border ring-2 ring-offset-1 ring-offset-transparent ${medal.avatarBg} ${medal.avatarText} ${isFirst ? "w-14 h-14 text-lg ring-amber-400/30" : `w-11 h-11 text-sm ${isDark ? "ring-white/10" : "ring-gray-200"}`}`}>
                      {initials(entry.agent_name)}
                    </div>
                    <p className={`font-black truncate text-xs sm:text-sm ${head}`}>{entry.agent_name}</p>
                    {entry.is_current_user && (
                      <span className="inline-flex items-center gap-1 mt-1 text-[9px] font-black text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-2 py-0.5">
                        <Star className="w-2.5 h-2.5 fill-indigo-400" /> You
                      </span>
                    )}
                    {entry.streak >= 3 && (
                      <p className="text-[10px] mt-0.5 text-orange-400 font-bold">🔥 {entry.streak}d</p>
                    )}
                    <div className={`mt-3 pt-2.5 border-t ${isDark ? "border-white/[0.06]" : "border-gray-100"}`}>
                      <p className={`font-black ${isFirst ? "text-2xl" : "text-xl"} ${medal.accent}`}>
                        {tab === "sales" ? fmtGHS(entry.display_value) : entry.display_value}
                      </p>
                      <p className={`text-[9px] font-bold uppercase tracking-widest ${muted}`}>
                        {tab === "today" ? "today" : tab === "week" ? "this week" : tab === "month" ? "this month" : "wk sales"}
                      </p>
                    </div>
                  </div>
                  <div className={`w-full mt-1.5 rounded-t-xl flex items-end justify-center pb-1.5 ${medal.pillarH} ${medal.pillarBg}`}>
                    <span className="text-sm">{entry.display_rank === 1 ? "🥇" : entry.display_rank === 2 ? "🥈" : "🥉"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <SpinTheWheel />

      {/* ── Reward tiers ────────────────────────────────────────────────────── */}
      {tab !== "alltime" && (
        <div className={`rounded-2xl border overflow-hidden ${card}`}>
          <div className={`px-5 py-3.5 border-b flex items-center gap-2 ${isDark ? "border-white/[0.06] bg-white/[0.01]" : "border-gray-100 bg-gray-50/60"}`}>
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            <h2 className={`font-black text-sm ${head}`}>Weekly Reward Tiers</h2>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
            {TIERS.map((tier) => {
              const isCurrentTier = currentUser ? getTier(currentUser.week_orders).label === tier.label : false;
              return (
                <div key={tier.label} className={`rounded-xl border p-3 text-center transition-all ${tier.bg} ${isCurrentTier ? "ring-2 ring-offset-1 ring-offset-transparent ring-indigo-400/50" : ""}`}>
                  <p className="text-xl mb-1">{tier.icon}</p>
                  <p className={`font-black text-xs ${tier.color}`}>{tier.label}</p>
                  <p className={`text-[10px] mt-0.5 ${muted}`}>{tier.min}+ orders/wk</p>
                  {isCurrentTier && <p className="text-[9px] font-black text-indigo-400 mt-1">← You</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Hall of Fame (all-time tab) ──────────────────────────────────────── */}
      {tab === "alltime" && (
        <div className={`rounded-2xl border overflow-hidden ${card}`}>
          <div className={`px-5 py-4 border-b flex items-center gap-2 ${isDark ? "border-white/[0.06] bg-white/[0.01]" : "border-gray-100 bg-gray-50/60"}`}>
            <Trophy className="w-4 h-4 text-amber-400" />
            <h2 className={`font-black text-sm ${head}`}>All-Time Hall of Fame</h2>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ml-auto ${isDark ? "bg-white/[0.04] border-white/[0.06] text-white/30" : "bg-gray-100 border-gray-200 text-gray-400"}`}>
              Every order ever fulfilled
            </span>
          </div>
          {alltimeLoading ? (
            <div className="p-8 space-y-3">
              {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
            </div>
          ) : alltimeData.length === 0 ? (
            <div className="py-16 text-center"><p className={`text-sm ${muted}`}>No data yet.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={`text-[10px] font-black uppercase tracking-[0.15em] ${isDark ? "bg-black/20 text-white/25" : "bg-gray-50 text-gray-400"}`}>
                    <th className="px-5 py-3 text-left w-14">Rank</th>
                    <th className="px-5 py-3 text-left">Agent</th>
                    <th className="px-5 py-3 text-right">All-Time Orders</th>
                    <th className="px-5 py-3 text-right hidden sm:table-cell">Total Volume</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${divider}`}>
                  {alltimeData.map((row) => {
                    const isTop3 = row.rank_position <= 3;
                    const medal  = isTop3 ? MEDALS[row.rank_position - 1] : null;
                    return (
                      <tr key={`at-${row.rank_position}`}
                        className={`transition-colors ${row.is_current_user ? isDark ? "bg-indigo-500/8 hover:bg-indigo-500/12" : "bg-indigo-50" : rowBase}`}>
                        <td className="px-5 py-3.5">
                          {isTop3 ? (
                            <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-black ${medal!.badgeBg} ${medal!.badgeText}`}>{row.rank_position}</span>
                          ) : (
                            <span className={`text-sm font-black ${muted}`}>#{row.rank_position}</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black shrink-0 border ${
                              row.is_current_user ? "bg-indigo-500 text-white border-indigo-500/30"
                              : isTop3 ? `${medal!.avatarBg} ${medal!.avatarText}`
                              : isDark ? "bg-white/[0.04] text-white/40 border-white/[0.06]" : "bg-gray-100 text-gray-500 border-gray-200"
                            }`}>{initials(row.agent_name)}</div>
                            <div>
                              <p className={`font-bold flex items-center gap-1.5 ${head}`}>
                                {row.agent_name}
                                {row.is_current_user && <span className="text-[9px] font-black text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-1.5 py-0.5">You</span>}
                              </p>
                              <p className={`text-[10px] ${muted}`}>{isTop3 ? medal!.label : "Verified Partner"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className={`font-black ${isTop3 ? medal!.accent : head}`}>{row.total_orders.toLocaleString()}</span>
                        </td>
                        <td className="px-5 py-3.5 text-right hidden sm:table-cell">
                          <span className={`font-medium ${muted}`}>{fmtGHS(Number(row.total_amount))}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Full rankings table ──────────────────────────────────────────────── */}
      {tab !== "alltime" && (
        <div className={`rounded-2xl border overflow-hidden ${card}`}>
          <div className={`px-5 py-3.5 border-b flex items-center justify-between ${isDark ? "border-white/[0.06] bg-white/[0.01]" : "border-gray-100 bg-gray-50/60"}`}>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-400" />
              <h2 className={`font-black text-sm ${head}`}>Full Rankings</h2>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${isDark ? "bg-white/[0.04] border-white/[0.06] text-white/30" : "bg-gray-100 border-gray-200 text-gray-400"}`}>
                {data.length} agents
              </span>
            </div>
            <p className={`text-[10px] font-medium ${muted} hidden sm:block`}>
              Click any row to compare
            </p>
          </div>

          {ranked.length === 0 ? (
            <div className="py-20 text-center space-y-3">
              <Target className={`w-8 h-8 mx-auto ${muted}`} />
              <p className={`text-sm ${muted}`}>No agents ranked yet — be the first!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={`text-[10px] font-black uppercase tracking-[0.15em] ${isDark ? "bg-black/20 text-white/25" : "bg-gray-50 text-gray-400"}`}>
                    <th className="px-5 py-3 text-left w-16">Rank</th>
                    <th className="px-5 py-3 text-left">Agent</th>
                    <th className="px-5 py-3 text-right">
                      {tab === "today" ? "Today" : tab === "week" ? "This Week" : tab === "month" ? "Month" : "Wk Sales"}
                    </th>
                    <th className="px-5 py-3 text-left hidden sm:table-cell" style={{ minWidth: 130 }}>Progress</th>
                    <th className="px-5 py-3 text-right hidden md:table-cell">
                      {tab === "today" ? "Week" : "Today"}
                    </th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${divider}`}>
                  {ranked.map((row) => {
                    const isTop3 = row.display_rank <= 3;
                    const medal  = isTop3 ? MEDALS[row.display_rank - 1] : null;
                    const pct    = maxValue > 0 ? Math.max(3, Math.round((row.display_value / maxValue) * 100)) : 3;
                    const secondary = tab === "today" ? row.week_orders : row.day_orders;
                    const barColor = row.is_current_user ? "bg-indigo-500"
                      : row.display_rank === 1 ? "bg-amber-400"
                      : row.display_rank === 2 ? "bg-slate-400"
                      : row.display_rank === 3 ? "bg-orange-600"
                      : "bg-emerald-500/60";

                    // Rank change indicator
                    const prevRank = rankChanges.today;
                    const rankDiff = row.is_current_user && prevRank !== null ? row.display_rank - prevRank : null;

                    return (
                      <tr key={`${row.agent_name}-${row.display_rank}`}
                        className={`group transition-colors cursor-pointer ${
                          row.is_current_user
                            ? isDark ? "bg-indigo-500/8 hover:bg-indigo-500/12" : "bg-indigo-50 hover:bg-indigo-50/80"
                            : rowBase
                        }`}
                        onClick={() => setComparing(row)}
                      >
                        {/* Rank */}
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1.5">
                            {isTop3 ? (
                              <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-black shadow-sm ${medal!.badgeBg} ${medal!.badgeText}`}>
                                {row.display_rank}
                              </span>
                            ) : (
                              <span className={`text-sm font-black ${muted}`}>#{row.display_rank}</span>
                            )}
                            {rankDiff !== null && rankDiff !== 0 && (
                              <span className={`text-[9px] font-bold flex items-center ${rankDiff < 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {rankDiff < 0 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                {Math.abs(rankDiff)}
                              </span>
                            )}
                            {rankDiff === 0 && row.is_current_user && <Minus className={`w-3 h-3 ${muted}`} />}
                          </div>
                        </td>

                        {/* Agent */}
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black shrink-0 border ${
                              row.is_current_user ? "bg-indigo-500 text-white border-indigo-500/30 shadow-lg shadow-indigo-500/20"
                              : isTop3 ? `${medal!.avatarBg} ${medal!.avatarText}`
                              : isDark ? "bg-white/[0.04] text-white/40 border-white/[0.06]" : "bg-gray-100 text-gray-500 border-gray-200"
                            }`}>
                              {initials(row.agent_name)}
                            </div>
                            <div>
                              <p className={`font-bold flex items-center gap-1.5 flex-wrap ${head}`}>
                                {row.agent_name}
                                {row.is_current_user && <span className="text-[9px] font-black text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-1.5 py-0.5">You</span>}
                                {row.streak >= 3 && <span className="text-[9px] font-bold text-orange-400">🔥{row.streak}d</span>}
                              </p>
                              <p className={`text-[10px] ${muted}`}>
                                {isTop3 ? medal!.label : getTier(row.week_orders).icon + " " + getTier(row.week_orders).label}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Primary value */}
                        <td className="px-5 py-3.5 text-right">
                          <span className={`font-black ${row.display_value > 0 ? (isTop3 ? medal!.accent : "text-emerald-400") : muted}`}>
                            {tab === "sales" ? fmtGHS(row.display_value) : row.display_value}
                          </span>
                        </td>

                        {/* Progress bar */}
                        <td className="px-5 py-3.5 hidden sm:table-cell">
                          <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? "bg-white/[0.05]" : "bg-gray-100"}`}>
                            <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${pct}%` }} />
                          </div>
                        </td>

                        {/* Secondary */}
                        <td className="px-5 py-3.5 text-right hidden md:table-cell">
                          <span className={`font-medium ${muted}`}>{secondary}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Achievement share card ───────────────────────────────────────────── */}
      {currentUser && tab !== "alltime" && (
        <div className="space-y-3">
          <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${muted}`}>Your Achievement Card</p>
          <div ref={shareCardRef} style={{ borderRadius: 24, overflow: "hidden", display: "inline-block", width: "100%" }}>
            <div style={{ background: "linear-gradient(135deg,#060611 0%,#0c1125 55%,#060611 100%)", padding: "2rem", position: "relative", fontFamily: "system-ui,-apple-system,sans-serif" }}>
              <div style={{ position: "absolute", top: -50, right: -50, width: 180, height: 180, background: "rgba(251,191,36,0.07)", borderRadius: "50%", filter: "blur(70px)", pointerEvents: "none" }} />
              <div style={{ position: "absolute", bottom: -40, left: -30, width: 140, height: 140, background: "rgba(99,102,241,0.07)", borderRadius: "50%", filter: "blur(60px)", pointerEvents: "none" }} />
              <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                {/* Brand */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{ width: 30, height: 30, background: "#fbbf24", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 15, fontWeight: 900, color: "#000" }}>S</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#fbbf24", letterSpacing: "0.06em" }}>SwiftData Ghana</span>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: "0.15em", textTransform: "uppercase" }}>Agent Network</span>
                </div>
                {/* Main row */}
                <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
                  <div style={{ width: 76, height: 76, borderRadius: 22, flexShrink: 0, background: currentUser.display_rank <= 3 ? "rgba(251,191,36,0.12)" : "rgba(99,102,241,0.12)", border: `2px solid ${currentUser.display_rank <= 3 ? "rgba(251,191,36,0.3)" : "rgba(99,102,241,0.3)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 900, color: currentUser.display_rank <= 3 ? "#fbbf24" : "#818cf8" }}>
                    {initials(currentUser.agent_name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 22, fontWeight: 900, color: "#fff", margin: 0, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{currentUser.agent_name}</p>
                    <p style={{ fontSize: 11, fontWeight: 700, margin: "5px 0 0", textTransform: "uppercase", letterSpacing: "0.12em", color: currentUser.display_rank <= 3 ? "#fbbf24" : "#6ee7b7" }}>
                      {currentUser.display_rank === 1 ? "🏆 Market Leader" : currentUser.display_rank === 2 ? "🥈 Silver Contender" : currentUser.display_rank === 3 ? "🥉 Bronze Tier" : `${getTier(currentUser.week_orders).icon} ${getTier(currentUser.week_orders).label}`}
                    </p>
                    {currentUser.streak >= 3 && <p style={{ fontSize: 10, fontWeight: 700, color: "#f97316", margin: "4px 0 0" }}>🔥 {currentUser.streak}-day streak</p>}
                  </div>
                  <div style={{ width: 60, height: 60, borderRadius: 18, flexShrink: 0, background: currentUser.display_rank <= 3 ? "#fbbf24" : "rgba(99,102,241,0.15)", border: currentUser.display_rank <= 3 ? "none" : "2px solid rgba(99,102,241,0.4)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 22, fontWeight: 900, color: currentUser.display_rank <= 3 ? "#000" : "#818cf8", lineHeight: 1 }}>#{currentUser.display_rank}</span>
                    <span style={{ fontSize: 8, fontWeight: 700, color: currentUser.display_rank <= 3 ? "rgba(0,0,0,0.55)" : "rgba(129,140,248,0.6)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Rank</span>
                  </div>
                </div>
                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.6rem" }}>
                  {[
                    { label: "Today",   value: currentUser.day_orders,       color: "#fbbf24" },
                    { label: "Week",    value: currentUser.week_orders,      color: "#6ee7b7" },
                    { label: "Month",   value: currentUser.month_orders,     color: "#818cf8" },
                    { label: "Wk Sales",value: fmtGHS(currentUser.week_sales_amount), color: "#f472b6" },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "0.6rem", textAlign: "center" }}>
                      <p style={{ fontSize: 18, fontWeight: 900, color, margin: 0, lineHeight: 1 }}>{value}</p>
                      <p style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.28)", margin: "3px 0 0", textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</p>
                    </div>
                  ))}
                </div>
                {/* Footer */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.85rem" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.18)", letterSpacing: "0.08em" }}>swiftdatagh.shop</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#22c55e", textTransform: "uppercase", letterSpacing: "0.1em" }}>Active Agent</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── All-time you card ────────────────────────────────────────────────── */}
      {tab === "alltime" && currentAlltime && (
        <div className={`relative overflow-hidden rounded-2xl border p-4 flex items-center gap-4 ${isDark ? "bg-amber-400/5 border-amber-400/15" : "bg-amber-50 border-amber-200"}`}>
          <div className="w-12 h-12 rounded-2xl bg-amber-400/15 border border-amber-400/25 flex items-center justify-center text-amber-400 font-black text-base shrink-0">
            {initials(currentAlltime.agent_name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black uppercase tracking-widest text-amber-400 mb-0.5">Your All-Time Stats</p>
            <p className={`font-black text-sm ${head}`}>{currentAlltime.agent_name}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-black text-amber-400">#{currentAlltime.rank_position}</p>
            <p className={`text-[10px] ${muted}`}>{currentAlltime.total_orders.toLocaleString()} orders · {fmtGHS(Number(currentAlltime.total_amount))}</p>
          </div>
        </div>
      )}

      {/* ── Motivation footer ────────────────────────────────────────────────── */}
      <div className={`relative overflow-hidden rounded-2xl border p-5 ${card}`}>
        <div className="absolute -top-10 -right-10 w-48 h-48 bg-amber-400/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-10 h-10 rounded-2xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex-1">
            <h4 className={`font-black text-sm mb-1 ${head}`}>Climb the Rankings</h4>
            <p className={`text-xs leading-relaxed ${sub}`}>
              Top agents unlock exclusive wholesale pricing and custom store domains. Consistent daily volume beats big single-day spikes — build your streak.
            </p>
          </div>
          <div className={`flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-xl border shrink-0 ${isDark ? "bg-white/[0.03] border-white/[0.06] text-white/40" : "bg-gray-50 border-gray-200 text-gray-500"}`}>
            <Users className="w-3.5 h-3.5" /> {data.length} competing
          </div>
        </div>
      </div>

    </div>
  );
};

export default DashboardLeaderboard;
