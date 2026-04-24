import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAppTheme } from "@/contexts/ThemeContext";
import {
  Trophy, Medal, Award, TrendingUp, AlertCircle,
  Target, Crown, Star, Zap, Users, BarChart3, RefreshCw,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface LeaderboardEntry {
  rank_position: number;
  agent_name: string;
  day_orders: number;
  week_orders: number;
  is_current_user: boolean;
}

// ── Medal config ───────────────────────────────────────────────────────────────
const MEDALS = [
  {
    rank: 1,
    label: "Market Leader",
    icon: Crown,
    ring:  "ring-amber-400/40",
    avatar: "bg-amber-400/15 border-amber-400/30",
    avatarText: "text-amber-400",
    badge: "bg-amber-400 text-black",
    glow:  "shadow-amber-400/20",
    accent: "text-amber-400",
    border: "border-amber-400/25",
    bg:    "bg-amber-400/5",
    pillar: "h-44",
  },
  {
    rank: 2,
    label: "Silver Contender",
    icon: Medal,
    ring:  "ring-slate-400/40",
    avatar: "bg-slate-400/15 border-slate-400/30",
    avatarText: "text-slate-400",
    badge: "bg-slate-400 text-black",
    glow:  "shadow-slate-400/20",
    accent: "text-slate-400",
    border: "border-slate-400/20",
    bg:    "bg-slate-400/5",
    pillar: "h-32",
  },
  {
    rank: 3,
    label: "Bronze Tier",
    icon: Award,
    ring:  "ring-orange-700/40",
    avatar: "bg-orange-700/15 border-orange-700/30",
    avatarText: "text-orange-600",
    badge: "bg-orange-700 text-white",
    glow:  "shadow-orange-700/15",
    accent: "text-orange-600",
    border: "border-orange-700/20",
    bg:    "bg-orange-700/5",
    pillar: "h-24",
  },
];

// ── Avatar initials ────────────────────────────────────────────────────────────
const initials = (name: string) =>
  name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

// ── Bar width for weekly column ────────────────────────────────────────────────
const relWidth = (val: number, max: number) =>
  max > 0 ? Math.max(6, Math.round((val / max) * 100)) : 6;

const DashboardLeaderboard = () => {
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isDark } = useAppTheme();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: result, error: rpcError } = await supabase.rpc("get_agent_leaderboard");
      if (rpcError) throw rpcError;
      setData(result || []);
    } catch (err: any) {
      setError(err.message || "Could not load leaderboard.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const topThree = data.slice(0, 3);
  const rest     = data.slice(3);
  const maxWeekly = Math.max(...data.map((d) => d.week_orders), 1);
  const totalDay  = data.reduce((s, d) => s + d.day_orders, 0);
  const currentUser = data.find((d) => d.is_current_user);

  // ── Shared class shorthands ──────────────────────────────────────────────────
  const card   = isDark ? "bg-white/[0.025] border-white/6" : "bg-white border-gray-200 shadow-sm";
  const muted  = isDark ? "text-white/35"  : "text-gray-400";
  const head   = isDark ? "text-white"     : "text-gray-900";
  const sub    = isDark ? "text-white/50"  : "text-gray-500";
  const divider= isDark ? "border-white/6" : "border-gray-100";
  const rowHov = isDark ? "hover:bg-white/[0.025]" : "hover:bg-gray-50";
  const thBg   = isDark ? "bg-black/30"   : "bg-gray-50";

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto pb-16">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}
        </div>
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-4 px-4">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className={`text-xl font-black ${head}`}>Leaderboard Unavailable</h2>
        <p className={`text-sm ${muted}`}>{error}</p>
        <button onClick={load}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-400 text-black font-bold text-sm hover:bg-amber-300 transition-all">
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-16">

      {/* ── Hero header ──────────────────────────────────────────────────── */}
      <div className={`relative overflow-hidden rounded-2xl border p-6 md:p-8 ${card}`}>
        {/* Ambient */}
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-amber-400/8 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-indigo-500/6 rounded-full blur-2xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            {/* Live pill */}
            <div className="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest">Live Rankings</span>
            </div>
            <h1 className={`text-3xl md:text-4xl font-black tracking-tight mb-1 ${head}`}>
              Agent Leaderboard
            </h1>
            <p className={`text-sm ${sub}`}>
              Real-time rankings across the SwiftData reseller network.
            </p>
          </div>

          {/* Quick stats */}
          <div className={`flex items-center gap-5 px-6 py-4 rounded-2xl border shrink-0 ${isDark ? "bg-white/[0.03] border-white/6" : "bg-gray-50 border-gray-200"}`}>
            <div className="text-center">
              <p className={`text-2xl font-black ${head}`}>{data.length}</p>
              <p className={`text-[10px] font-bold uppercase tracking-widest mt-0.5 ${muted}`}>Agents</p>
            </div>
            <div className={`w-px h-8 ${isDark ? "bg-white/8" : "bg-gray-200"}`} />
            <div className="text-center">
              <p className="text-2xl font-black text-amber-500">{totalDay}</p>
              <p className={`text-[10px] font-bold uppercase tracking-widest mt-0.5 ${muted}`}>Orders Today</p>
            </div>
            {currentUser && (
              <>
                <div className={`w-px h-8 ${isDark ? "bg-white/8" : "bg-gray-200"}`} />
                <div className="text-center">
                  <p className="text-2xl font-black text-indigo-500">#{currentUser.rank_position}</p>
                  <p className={`text-[10px] font-bold uppercase tracking-widest mt-0.5 ${muted}`}>Your Rank</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Podium (top 3) ───────────────────────────────────────────────── */}
      {topThree.length > 0 && (
        <div>
          <p className={`text-[10px] font-black uppercase tracking-[0.2em] mb-5 ${muted}`}>Top Performers</p>

          {/* Podium columns — order: 2, 1, 3 */}
          <div className="grid grid-cols-3 gap-3 items-end">
            {[
              topThree[1] ? { entry: topThree[1], medal: MEDALS[1] } : null,
              topThree[0] ? { entry: topThree[0], medal: MEDALS[0] } : null,
              topThree[2] ? { entry: topThree[2], medal: MEDALS[2] } : null,
            ].map((item, colIdx) => {
              if (!item) return <div key={colIdx} />;
              const { entry, medal } = item;
              const isFirst = medal.rank === 1;
              return (
                <div key={entry.agent_name} className="flex flex-col items-center">
                  {/* Card */}
                  <div className={`w-full relative rounded-2xl border p-4 md:p-6 text-center transition-all hover:scale-[1.02] ${
                    isFirst
                      ? `bg-gradient-to-b from-amber-400/10 to-transparent border-amber-400/25 shadow-xl shadow-amber-400/10`
                      : `${card}`
                  }`}>
                    {/* Glow blob */}
                    {isFirst && (
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-24 h-12 bg-amber-400/20 rounded-full blur-2xl pointer-events-none" />
                    )}

                    {/* Rank badge */}
                    <div className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black mb-3 ${medal.badge} shadow-lg`}>
                      {medal.rank}
                    </div>

                    {/* Avatar */}
                    <div className={`mx-auto mb-3 flex items-center justify-center font-black rounded-2xl border ring-2 ${medal.ring} ${medal.avatar} ${
                      isFirst ? "w-16 h-16 text-lg" : "w-12 h-12 text-sm"
                    } ${medal.avatarText}`}>
                      {initials(entry.agent_name)}
                    </div>

                    {/* Name */}
                    <p className={`font-black truncate text-sm md:text-base ${head}`}>
                      {entry.agent_name}
                    </p>
                    {entry.is_current_user && (
                      <span className="inline-flex items-center gap-1 mt-1 text-[9px] font-black text-indigo-500 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-2 py-0.5">
                        <Star className="w-2.5 h-2.5 fill-indigo-500" /> You
                      </span>
                    )}
                    <p className={`text-[9px] font-bold uppercase tracking-widest mt-0.5 ${medal.accent} hidden md:block`}>
                      {medal.label}
                    </p>

                    {/* Stats */}
                    <div className={`mt-3 pt-3 border-t grid grid-cols-2 gap-2 ${divider}`}>
                      <div>
                        <p className={`${isFirst ? "text-xl" : "text-lg"} font-black ${head}`}>{entry.day_orders}</p>
                        <p className={`text-[9px] font-bold uppercase tracking-widest ${muted}`}>Today</p>
                      </div>
                      <div>
                        <p className={`${isFirst ? "text-xl" : "text-lg"} font-black ${head}`}>{entry.week_orders}</p>
                        <p className={`text-[9px] font-bold uppercase tracking-widest ${muted}`}>Week</p>
                      </div>
                    </div>
                  </div>

                  {/* Podium pillar */}
                  <div className={`w-full mt-2 rounded-t-xl flex items-end justify-center pb-2 ${medal.pillar} ${
                    isFirst
                      ? "bg-gradient-to-t from-amber-400/20 to-amber-400/5 border border-b-0 border-amber-400/15"
                      : isDark ? "bg-white/[0.03] border border-b-0 border-white/5" : "bg-gray-100 border border-b-0 border-gray-200"
                  }`}>
                    <span className={`text-xs font-black ${medal.accent} opacity-60`}>{medal.rank === 1 ? "🏆" : medal.rank === 2 ? "🥈" : "🥉"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Full rankings table ───────────────────────────────────────────── */}
      <div className={`rounded-2xl border overflow-hidden ${card}`}>
        {/* Table header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${divider} ${isDark ? "bg-white/[0.01]" : "bg-gray-50/80"}`}>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-amber-500" />
            <h2 className={`font-black text-base ${head}`}>Full Rankings</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${isDark ? "bg-white/[0.03] border-white/8 text-white/40" : "bg-gray-100 border-gray-200 text-gray-500"}`}>
              {data.length} agents
            </span>
            <button onClick={load}
              className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-all hover:scale-105 ${isDark ? "bg-white/[0.03] border-white/8 text-white/40 hover:text-white" : "bg-gray-100 border-gray-200 text-gray-500 hover:text-gray-900"}`}>
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {data.length === 0 ? (
          <div className="py-20 text-center space-y-3">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto border ${isDark ? "bg-white/[0.03] border-white/6" : "bg-gray-50 border-gray-200"}`}>
              <Target className={`w-7 h-7 ${muted}`} />
            </div>
            <p className={`text-sm font-semibold ${muted}`}>No ranked agents yet — be the first!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className={`text-[10px] font-black uppercase tracking-[0.2em] border-b ${divider} ${thBg}`}>
                  <th className={`px-5 py-3 text-left w-16 ${muted}`}>Rank</th>
                  <th className={`px-5 py-3 text-left ${muted}`}>Agent</th>
                  <th className={`px-5 py-3 text-center ${muted}`}>Today</th>
                  <th className={`px-5 py-3 text-left hidden sm:table-cell ${muted}`} style={{ minWidth: 160 }}>Weekly Progress</th>
                  <th className={`px-5 py-3 text-right ${muted}`}>Weekly</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${divider}`}>
                {data.map((row) => {
                  const isTop3 = row.rank_position <= 3;
                  const medal  = MEDALS[row.rank_position - 1];
                  const barW   = relWidth(row.week_orders, maxWeekly);
                  return (
                    <tr
                      key={`${row.agent_name}-${row.rank_position}`}
                      className={`group transition-colors ${
                        row.is_current_user
                          ? isDark ? "bg-indigo-500/8 hover:bg-indigo-500/12" : "bg-indigo-50 hover:bg-indigo-50"
                          : rowHov
                      }`}
                    >
                      {/* Rank */}
                      <td className="px-5 py-4">
                        {isTop3 ? (
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-black ${medal.badge}`}>
                            {row.rank_position}
                          </span>
                        ) : (
                          <span className={`text-sm font-black ${muted}`}>#{row.rank_position}</span>
                        )}
                      </td>

                      {/* Agent */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black shrink-0 border ${
                            row.is_current_user
                              ? "bg-indigo-500 text-white border-indigo-400/40 shadow-lg shadow-indigo-500/20"
                              : isTop3
                                ? `${medal.avatar} ${medal.avatarText}`
                                : isDark ? "bg-white/[0.04] text-white/50 border-white/8" : "bg-gray-100 text-gray-500 border-gray-200"
                          }`}>
                            {initials(row.agent_name)}
                          </div>
                          <div>
                            <p className={`text-sm font-bold flex items-center gap-1.5 ${head}`}>
                              {row.agent_name}
                              {row.is_current_user && (
                                <span className="text-[9px] font-black text-indigo-500 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-1.5 py-0.5">You</span>
                              )}
                            </p>
                            <p className={`text-[10px] ${muted}`}>
                              {isTop3 ? medal.label : "Verified Partner"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Today */}
                      <td className="px-5 py-4 text-center">
                        <span className={`text-sm font-black ${row.day_orders > 0 ? "text-amber-500" : muted}`}>
                          {row.day_orders}
                        </span>
                      </td>

                      {/* Weekly progress bar */}
                      <td className="px-5 py-4 hidden sm:table-cell">
                        <div className={`h-2 rounded-full overflow-hidden ${isDark ? "bg-white/5" : "bg-gray-100"}`}>
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${
                              row.is_current_user ? "bg-indigo-500" :
                              isTop3 && medal.rank === 1 ? "bg-amber-400" :
                              isTop3 && medal.rank === 2 ? "bg-slate-400" :
                              isTop3 ? "bg-orange-600" : "bg-emerald-500"
                            }`}
                            style={{ width: `${barW}%` }}
                          />
                        </div>
                      </td>

                      {/* Weekly count */}
                      <td className="px-5 py-4 text-right">
                        <span className={`text-sm font-bold ${head}`}>{row.week_orders}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Motivation footer ─────────────────────────────────────────────── */}
      <div className={`relative overflow-hidden rounded-2xl border p-6 md:p-8 ${card}`}>
        <div className="absolute -top-8 -right-8 w-40 h-40 bg-amber-400/6 rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0">
            <Zap className="w-6 h-6 text-amber-500" />
          </div>
          <div className="flex-1">
            <h4 className={`font-black text-base mb-1 ${head}`}>Climb the Rankings</h4>
            <p className={`text-sm leading-relaxed ${sub}`}>
              Top agents unlock exclusive wholesale pricing and custom store domains.
              Focus on consistent daily volume to secure a podium spot.
            </p>
          </div>
          <div className={`flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-xl border shrink-0 ${isDark ? "bg-white/[0.03] border-white/8 text-white/50" : "bg-gray-50 border-gray-200 text-gray-500"}`}>
            <Users className="w-3.5 h-3.5" />
            {data.length} competing
          </div>
        </div>
      </div>

    </div>
  );
};

export default DashboardLeaderboard;
