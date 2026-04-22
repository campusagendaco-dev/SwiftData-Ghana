import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Trophy, Medal, Star, TrendingUp, AlertCircle } from "lucide-react";
import { useAppTheme } from "@/contexts/ThemeContext";

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

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Medal className="w-6 h-6 text-yellow-400 drop-shadow-md" />;
      case 2:
        return <Medal className="w-6 h-6 text-gray-300 drop-shadow-md" />;
      case 3:
        return <Medal className="w-6 h-6 text-amber-600 drop-shadow-md" />;
      default:
        return <span className="w-6 text-center font-bold text-muted-foreground">{rank}</span>;
    }
  };

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl mx-auto flex justify-center items-center h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl mx-auto">
        <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg p-6 flex flex-col items-center justify-center text-center">
          <AlertCircle className="w-10 h-10 mb-2 opacity-80" />
          <h2 className="text-lg font-bold">Leaderboard Unavailable</h2>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl mx-auto pb-24">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10">
          <Trophy className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Agent Leaderboard</h1>
          <p className="text-sm text-muted-foreground mt-1">See how you rank among other agents this week</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-3 border-none bg-gradient-to-br from-secondary/50 to-background shadow-md">
          <CardHeader className="pb-3 border-b border-white/5">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-amber-400" />
              Top Performers
            </CardTitle>
            <CardDescription>
              Rankings are based on the number of fulfilled orders today and this week.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {data.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No data available for today yet. Make a sale to be the first!
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {/* Header row */}
                <div className="grid grid-cols-12 gap-2 p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-black/20">
                  <div className="col-span-2 sm:col-span-1 text-center">Rank</div>
                  <div className="col-span-5 sm:col-span-6">Agent</div>
                  <div className="col-span-2 text-center">Today</div>
                  <div className="col-span-3 text-center">This Week</div>
                </div>

                {/* Data rows */}
                {data.map((row) => (
                  <div 
                    key={row.agent_name + row.rank_position} 
                    className={`grid grid-cols-12 gap-2 p-4 items-center transition-colors ${
                      row.is_current_user 
                        ? "bg-primary/5 hover:bg-primary/10 border-l-4 border-l-primary" 
                        : "hover:bg-white/5 border-l-4 border-l-transparent"
                    }`}
                  >
                    <div className="col-span-2 sm:col-span-1 flex justify-center items-center">
                      {getRankIcon(row.rank_position)}
                    </div>
                    <div className="col-span-5 sm:col-span-6 font-medium flex items-center gap-2 truncate">
                      {row.is_current_user && <Star className="w-3.5 h-3.5 text-primary fill-primary hidden sm:block shrink-0" />}
                      <span className="truncate">{row.agent_name}</span>
                      {row.is_current_user && (
                        <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full uppercase tracking-wider ml-2 shrink-0">
                          You
                        </span>
                      )}
                    </div>
                    <div className="col-span-2 text-center font-semibold text-white/90">
                      {row.day_orders}
                    </div>
                    <div className="col-span-3 text-center text-muted-foreground">
                      {row.week_orders}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default DashboardLeaderboard;
