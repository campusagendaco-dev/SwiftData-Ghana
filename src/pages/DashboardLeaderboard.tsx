import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Trophy, Medal, Star, TrendingUp, AlertCircle, Award, Target, Flame } from "lucide-react";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface LeaderboardEntry {
  rank_position: number;
  agent_name: string;
  day_orders: number;
  week_orders: number;
  is_current_user: boolean;
}

const DashboardLeaderboard = () => {
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { theme } = useAppTheme();

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const { data: result, error: rpcError } = await supabase.rpc("get_agent_leaderboard");
        
        if (rpcError) {
          throw rpcError;
        }
        
        setData(result || []);
      } catch (err: any) {
        setError(err.message || "Could not load leaderboard data. Please make sure the latest database updates are applied.");
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, []);

  const topThree = data.slice(0, 3);
  const others = data.slice(3);

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-5xl mx-auto flex flex-col gap-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl mx-auto">
        <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-2xl p-8 flex flex-col items-center justify-center text-center">
          <AlertCircle className="w-12 h-12 mb-4 opacity-80" />
          <h2 className="text-xl font-black">Leaderboard Unavailable</h2>
          <p className="text-sm mt-1 opacity-80">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#060612] text-white p-4 sm:p-6 lg:p-8 space-y-10 max-w-5xl mx-auto pb-32">
      {/* ── Background Mesh ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-600/10 blur-[120px]" />
        <div className="absolute bottom-[10%] right-[-10%] w-[30%] h-[30%] rounded-full bg-purple-600/10 blur-[100px]" />
      </div>

      {/* ── Header Section ── */}
      <div className="relative group p-1 rounded-[2.5rem] bg-gradient-to-br from-indigo-500/20 via-transparent to-purple-500/10 border border-white/5 overflow-hidden">
        <div className="absolute inset-0 bg-white/[0.01] backdrop-blur-3xl" />
        <div className="relative z-10 p-8 sm:p-12 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Badge className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 font-black uppercase tracking-[0.2em] px-3 py-0.5 rounded-full text-[9px]">
                Global Rankings
              </Badge>
              <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500">Live</span>
              </div>
            </div>
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-none">
              Top Performance <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-indigo-300">Leaderboard</span>
            </h1>
            <p className="text-white/40 font-medium text-base max-w-md leading-relaxed">
              Real-time rankings of our elite reseller network. Scale your sales volume to secure your spot among the best in Ghana.
            </p>
          </div>
          <div className="flex items-center gap-6 bg-white/[0.03] border border-white/10 p-6 rounded-[1.5rem] backdrop-blur-xl">
            <div className="text-center space-y-1">
              <p className="text-3xl font-black text-white">{data.length}</p>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/20">Active Agents</p>
            </div>
            <div className="w-px h-10 bg-white/10" />
            <div className="text-center space-y-1">
              <p className="text-3xl font-black text-white">{data.reduce((acc, curr) => acc + curr.day_orders, 0)}</p>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/20">Daily Volume</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── The Podium (Top 3) ── */}
      {topThree.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-end px-4">
          {/* Rank 2 (Silver) */}
          {topThree[1] && (
            <div className="order-2 lg:order-1 group relative p-1 rounded-[3rem] bg-white/[0.03] border border-white/5 transition-all duration-500 hover:scale-[1.02] active:scale-[0.98]">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gray-400/5 blur-3xl rounded-full" />
              <div className="relative p-8 text-center space-y-6">
                <div className="relative inline-block">
                  <div className="w-20 h-20 rounded-3xl bg-gray-400/10 flex items-center justify-center text-gray-400 border border-gray-400/20 shadow-2xl">
                    <Award className="w-10 h-10" />
                  </div>
                  <div className="absolute -top-3 -right-3 bg-gray-400 text-black text-xs font-black w-8 h-8 rounded-full flex items-center justify-center shadow-xl ring-4 ring-[#060612]">2</div>
                </div>
                <div>
                  <h3 className="text-2xl font-black text-white truncate px-2">{topThree[1].agent_name}</h3>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mt-1">Silver Contender</p>
                </div>
                <div className="grid grid-cols-2 gap-4 py-6 border-t border-white/5">
                  <div className="space-y-1">
                    <p className="text-2xl font-black text-white">{topThree[1].day_orders}</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-white/20">Today</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-2xl font-black text-white">{topThree[1].week_orders}</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-white/20">Weekly</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Rank 1 (Gold) */}
          {topThree[0] && (
            <div className="order-1 lg:order-2 group relative p-1 rounded-[3rem] bg-gradient-to-b from-amber-400/20 to-transparent border border-amber-400/30 transition-all duration-500 hover:scale-[1.05] z-10 shadow-2xl">
              <div className="absolute top-0 right-0 w-48 h-48 bg-amber-400/10 blur-[80px] rounded-full" />
              <div className="relative p-8 text-center space-y-6 bg-black/40 rounded-[2.8rem] backdrop-blur-3xl">
                <div className="relative inline-block">
                  <div className="w-24 h-24 rounded-[1.8rem] bg-amber-400/10 flex items-center justify-center text-amber-400 border-2 border-amber-400/20 shadow-[0_0_40px_rgba(245,158,11,0.2)]">
                    <Trophy className="w-12 h-12" />
                  </div>
                  <div className="absolute -top-3 -right-3 bg-amber-400 text-black text-xs font-black w-10 h-10 rounded-full flex items-center justify-center shadow-2xl ring-4 ring-black">1</div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-center gap-3">
                    <h3 className="text-2xl font-black text-white truncate max-w-[180px]">{topThree[0].agent_name}</h3>
                    {topThree[0].is_current_user && <Star className="w-5 h-5 text-amber-400 fill-amber-400" />}
                  </div>
                  <Badge className="bg-amber-400/20 text-amber-400 border-amber-400/30 font-black uppercase tracking-[0.2em] px-3 py-0.5 text-[8px] rounded-full">
                    Elite Reseller
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 py-6 border-y border-white/10">
                  <div className="space-y-1">
                    <p className="text-3xl font-black text-white">{topThree[0].day_orders}</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-white/30">Orders Today</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-3xl font-black text-white">{topThree[0].week_orders}</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-white/30">Orders Weekly</p>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2 text-emerald-400">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Market Leader</span>
                </div>
              </div>
            </div>
          )}

          {/* Rank 3 (Bronze) */}
          {topThree[2] && (
            <div className="order-3 group relative p-1 rounded-[3rem] bg-white/[0.03] border border-white/5 transition-all duration-500 hover:scale-[1.02] active:scale-[0.98]">
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber-700/5 blur-3xl rounded-full" />
              <div className="relative p-8 text-center space-y-6">
                <div className="relative inline-block">
                  <div className="w-20 h-20 rounded-3xl bg-amber-700/10 flex items-center justify-center text-amber-700 border border-amber-700/20 shadow-2xl">
                    <Medal className="w-10 h-10" />
                  </div>
                  <div className="absolute -top-3 -right-3 bg-amber-700 text-white text-xs font-black w-8 h-8 rounded-full flex items-center justify-center shadow-xl ring-4 ring-[#060612]">3</div>
                </div>
                <div>
                  <h3 className="text-2xl font-black text-white truncate px-2">{topThree[2].agent_name}</h3>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700 mt-1">Bronze Tier</p>
                </div>
                <div className="grid grid-cols-2 gap-4 py-6 border-t border-white/5">
                  <div className="space-y-1">
                    <p className="text-2xl font-black text-white">{topThree[2].day_orders}</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-white/20">Today</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-2xl font-black text-white">{topThree[2].week_orders}</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-white/20">Weekly</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── All Other Agents ── */}
      <div className="rounded-[3rem] bg-white/[0.02] border border-white/10 overflow-hidden backdrop-blur-3xl shadow-3xl">
        <div className="px-10 py-8 border-b border-white/10 flex items-center justify-between bg-white/[0.01]">
          <h2 className="text-2xl font-black text-white flex items-center gap-3">
            < Award className="w-7 h-7 text-indigo-400" />
            Active Contenders
          </h2>
          <Badge className="bg-white/5 text-white/40 border-white/10 font-black uppercase tracking-[0.2em] px-4 py-1.5 rounded-xl">
            {others.length} Agents Ranked
          </Badge>
        </div>

        <div className="overflow-x-auto">
          {others.length === 0 ? (
            <div className="p-20 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto">
                <Target className="w-8 h-8 text-white/20" />
              </div>
              <p className="text-white/20 font-black uppercase tracking-widest text-sm">Join the competition today</p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="bg-black/40 text-[10px] font-black uppercase tracking-[0.3em] text-white/20">
                  <th className="px-10 py-6 w-24">Rank</th>
                  <th className="px-10 py-6">Agent Profile</th>
                  <th className="px-10 py-6 text-center">Daily</th>
                  <th className="px-10 py-6 text-center">Weekly</th>
                  <th className="px-10 py-6 text-right pr-16">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {others.map((row) => (
                  <tr 
                    key={row.agent_name + row.rank_position} 
                    className={`group transition-all duration-300 ${row.is_current_user ? "bg-indigo-500/10" : "hover:bg-white/[0.03]"}`}
                  >
                    <td className="px-10 py-8">
                      <span className="text-xl font-black text-white/20 group-hover:text-white/60 transition-colors">#{row.rank_position}</span>
                    </td>
                    <td className="px-10 py-8">
                      <div className="flex items-center gap-5">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-black transition-transform group-hover:scale-110 ${
                          row.is_current_user ? "bg-indigo-500 text-white shadow-[0_0_20px_rgba(99,102,241,0.4)]" : "bg-white/5 text-white/40 border border-white/10"
                        }`}>
                          {row.agent_name.charAt(0)}
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-lg font-black text-white flex items-center gap-2">
                            {row.agent_name}
                            {row.is_current_user && (
                              <Badge className="bg-indigo-500/20 text-indigo-400 border-indigo-500/20 text-[8px] font-black uppercase tracking-tighter">You</Badge>
                            )}
                          </p>
                          <p className="text-[10px] font-black uppercase tracking-widest text-white/20">Verified Partner</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-10 py-8 text-center">
                      <span className="text-2xl font-black text-white">{row.day_orders}</span>
                    </td>
                    <td className="px-10 py-8 text-center">
                      <span className="text-xl font-black text-white/30">{row.week_orders}</span>
                    </td>
                    <td className="px-10 py-8 text-right pr-16">
                      <div className="flex items-center justify-end gap-2 text-emerald-500">
                        <TrendingUp className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Rising</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      
      {/* ── Pro Tips Footer ── */}
      <div className="relative rounded-[3rem] bg-gradient-to-r from-indigo-500/10 to-transparent border border-white/10 p-10 flex flex-col md:flex-row items-center gap-10 overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-full bg-indigo-500/5 blur-3xl rounded-full" />
        <div className="w-20 h-20 rounded-[2rem] bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20 shrink-0">
          <Target className="w-10 h-10" />
        </div>
        <div className="flex-1 text-center md:text-left space-y-3 relative z-10">
          <h4 className="text-2xl font-black text-white">Dominate the Market</h4>
          <p className="text-white/40 font-medium leading-relaxed max-w-2xl">
            Top performing agents get exclusive access to wholesale bulk pricing and custom store sub-domains. Focus on high-volume days to climb the global rankings.
          </p>
        </div>
        <Button className="shrink-0 bg-white text-black font-black h-14 px-10 rounded-2xl hover:scale-105 active:scale-95 transition-all shadow-2xl">
          Get Sales Strategy
        </Button>
      </div>
    </div>
  );
};

export default DashboardLeaderboard;

