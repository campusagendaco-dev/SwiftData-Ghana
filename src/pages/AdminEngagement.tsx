import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Gift, Users, TrendingUp, Calendar, Search, 
  UserPlus, Award, Clock, ArrowRight, Star,
  ChevronRight, Activity, Filter, Download,
  RefreshCw, Loader2, Sparkles, Trophy, Globe
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getSafeAvatarUrl } from "@/lib/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface EngagementStats {
  total_claims_today: number;
  total_referrals_today: number;
  active_streaks: number;
  top_referrer: { name: string; count: number } | null;
}

interface RecentClaim {
  user_id: string;
  full_name: string;
  email: string;
  last_check_in: string;
  last_spin_at: string;
  check_in_streak: number;
}

interface ReferralLink {
  referrer_name: string;
  referrer_email: string;
  invitee_name: string;
  invitee_email: string;
  joined_at: string;
}

const AdminEngagement = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<EngagementStats>({
    total_claims_today: 0,
    total_referrals_today: 0,
    active_streaks: 0,
    top_referrer: null
  });
  const [recentClaims, setRecentClaims] = useState<RecentClaim[]>([]);
  const [referrals, setReferrals] = useState<ReferralLink[]>([]);
  const [topReferrers, setTopReferrers] = useState<{name: string, email: string, count: number}[]>([]);
  const [locationStats, setLocationStats] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // 1. Fetch Today's Claims & Spins
      const { data: claimsData } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, last_check_in, last_spin_at, check_in_streak")
        .or(`last_check_in.gte.${today},last_spin_at.gte.${today}`)
        .order("last_check_in", { ascending: false });

      setRecentClaims(claimsData || []);

      // 2. Fetch Referrals
      const { data: profilesWithRefs } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, referred_by, created_at")
        .not("referred_by", "is", null)
        .order("created_at", { ascending: false });

      // Build referral mapping
      if (profilesWithRefs) {
        const referrersMap = new Map<string, {name: string, email: string, count: number}>();
        const { data: allProfiles } = await supabase.from("profiles").select("user_id, full_name, email");
        const profileLookup = new Map(allProfiles?.map(p => [p.user_id, p]) || []);

        const mappedRefs = profilesWithRefs.map(p => {
          const referrer = profileLookup.get(p.referred_by || "");
          
          if (referrer) {
            const current = referrersMap.get(p.referred_by || "") || { name: referrer.full_name, email: referrer.email, count: 0 };
            referrersMap.set(p.referred_by || "", { ...current, count: current.count + 1 });
          }

          return {
            referrer_name: referrer?.full_name || "Unknown",
            referrer_email: referrer?.email || "—",
            invitee_name: p.full_name || "New User",
            invitee_email: p.email,
            joined_at: p.created_at
          };
        });

        setReferrals(mappedRefs);
        setTopReferrers(Array.from(referrersMap.values()).sort((a, b) => b.count - a.count).slice(0, 5));

        const refsToday = mappedRefs.filter(r => r.joined_at.split('T')[0] === today).length;

        setStats({
          total_claims_today: claimsData?.length || 0,
          total_referrals_today: refsToday,
          active_streaks: (claimsData || []).filter(c => c.check_in_streak > 1).length,
          top_referrer: Array.from(referrersMap.values()).sort((a, b) => b.count - a.count)[0] || null
        });
      }

      // 4. Fetch Location Stats
      const { data: locationData } = await supabase
        .from("profiles")
        .select("last_location")
        .not("last_location", "is", null);

      const locs: Record<string, number> = {};
      locationData?.forEach(l => {
        if (l.last_location) {
          const city = (l.last_location as string).split(",")[0].trim();
          locs[city] = (locs[city] || 0) + 1;
        }
      });
      setLocationStats(locs);

    } catch (error: any) {
      toast({ title: "Fetch Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="w-10 h-10 text-amber-500 animate-spin" />
        <p className="text-white/40 text-sm font-bold animate-pulse uppercase tracking-widest">Gathering Engagement Data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-amber-400 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-400/20">
              <Sparkles className="w-6 h-6 text-black" />
            </div>
            <h1 className="text-3xl font-black italic tracking-tighter text-white">ENGAGEMENT HUB</h1>
          </div>
          <p className="text-white/40 text-sm">Monitor daily claims, referral loops, and platform loyalty.</p>
        </div>
        <div className="flex items-center gap-2">
           <Button onClick={fetchData} className="bg-white/5 border-white/10 hover:bg-white/10 text-white rounded-xl gap-2">
              <RefreshCw className="w-4 h-4" /> Refresh
           </Button>
           <Button className="bg-amber-400 hover:bg-amber-300 text-black font-black rounded-xl gap-2">
              <Download className="w-4 h-4" /> Export Report
           </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Claims Today", value: stats.total_claims_today, icon: Gift, color: "text-amber-400", bg: "bg-amber-400/10" },
          { label: "New Referrals", value: stats.total_referrals_today, icon: UserPlus, color: "text-blue-400", bg: "bg-blue-400/10" },
          { label: "Active Streaks", value: stats.active_streaks, icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-400/10" },
          { label: "Top Promoter", value: stats.top_referrer?.count || 0, sub: stats.top_referrer?.name, icon: Trophy, color: "text-purple-400", bg: "bg-purple-400/10" },
        ].map((stat, i) => (
          <div key={i} className="bg-white/5 border border-white/5 rounded-3xl p-5 relative overflow-hidden group hover:border-white/10 transition-all">
            <div className={cn("absolute -right-4 -top-4 w-20 h-20 blur-3xl opacity-20", stat.color.replace('text', 'bg'))} />
            <stat.icon className={cn("w-5 h-5 mb-3", stat.color)} />
            <p className="text-2xl font-black text-white">{stat.value}</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-white/40">{stat.label}</p>
            {stat.sub && <p className="text-[10px] text-white/20 mt-1 truncate">{stat.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Claims */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-amber-400" />
              <h2 className="text-xl font-black text-white">Daily Claims Activity</h2>
            </div>
            <Badge variant="outline" className="bg-amber-400/5 text-amber-400 border-amber-400/20">
              {recentClaims.length} Claims Today
            </Badge>
          </div>

          <div className="bg-white/5 border border-white/5 rounded-3xl overflow-hidden">
             {recentClaims.length === 0 ? (
               <div className="p-12 text-center opacity-20">
                 <Clock className="w-10 h-10 mx-auto mb-2" />
                 <p className="text-sm font-bold">No claims recorded yet today.</p>
               </div>
             ) : (
               <div className="divide-y divide-white/5">
                 {recentClaims.map((claim) => (
                   <div key={claim.user_id} className="p-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center gap-3">
                         <Avatar className="w-10 h-10 border border-white/10">
                            <AvatarImage src={getSafeAvatarUrl(undefined, claim.user_id || claim.full_name)} />
                            <AvatarFallback>{claim.full_name?.charAt(0)}</AvatarFallback>
                         </Avatar>
                         <div>
                            <p className="text-sm font-bold text-white">{claim.full_name}</p>
                            <p className="text-[10px] text-white/30 italic">
                               {claim.last_check_in?.startsWith(new Date().toISOString().split('T')[0]) ? "Claimed bonus" : ""}
                               {claim.last_check_in?.startsWith(new Date().toISOString().split('T')[0]) && claim.last_spin_at?.startsWith(new Date().toISOString().split('T')[0]) ? " & " : ""}
                               {claim.last_spin_at?.startsWith(new Date().toISOString().split('T')[0]) ? "Spun wheel" : ""}
                            </p>
                         </div>
                      </div>
                      <div className="text-right">
                         <div className="flex items-center gap-1.5 justify-end">
                            <span className="text-xs font-black text-amber-400">DAY {claim.check_in_streak}</span>
                            <Trophy className="w-3 h-3 text-amber-400" />
                         </div>
                         <p className="text-[10px] text-white/20">Active {new Date(claim.last_check_in || claim.last_spin_at).toLocaleTimeString()}</p>
                      </div>
                   </div>
                 ))}
               </div>
             )}
          </div>
        </div>

        {/* Right Column: Referrals & Leaders */}
        <div className="space-y-8">
           <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-purple-400" />
                <h2 className="text-xl font-black text-white">Top Referrers</h2>
              </div>
              <div className="space-y-2">
                 {topReferrers.map((ref, i) => (
                   <div key={i} className="bg-white/5 border border-white/5 rounded-2xl p-4 flex items-center justify-between group">
                      <div className="flex items-center gap-3">
                         <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center font-black text-purple-400 text-xs">
                            #{i+1}
                         </div>
                         <div className="min-w-0">
                            <p className="text-sm font-bold text-white truncate">{ref.name}</p>
                            <p className="text-[10px] text-white/30 truncate">{ref.email}</p>
                         </div>
                      </div>
                      <div className="text-right">
                         <p className="text-lg font-black text-white">{ref.count}</p>
                         <p className="text-[9px] font-black uppercase tracking-widest text-white/30">Referrals</p>
                      </div>
                   </div>
                 ))}
              </div>
           </div>

           <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-400" />
                <h2 className="text-xl font-black text-white">Recent Joins</h2>
              </div>
              <div className="space-y-3">
                 {referrals.slice(0, 5).map((ref, i) => (
                   <div key={i} className="flex items-start gap-3 border-l-2 border-blue-500/20 pl-4 py-1">
                      <div className="min-w-0 flex-1">
                         <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-white">{ref.invitee_name}</span>
                            <span className="text-[10px] text-white/20">invited by</span>
                            <span className="text-xs font-bold text-blue-400">{ref.referrer_name}</span>
                         </div>
                         <p className="text-[9px] text-white/30 mt-0.5">{new Date(ref.joined_at).toLocaleDateString()} · {new Date(ref.joined_at).toLocaleTimeString()}</p>
                      </div>
                   </div>
                 ))}
              </div>
           </div>

           {/* Location Insights */}
           <Card className="bg-white/3 border-white/5 overflow-hidden">
             <CardHeader className="bg-white/3 border-b border-white/5 py-3">
               <div className="flex items-center gap-2">
                 <Globe className="w-4 h-4 text-blue-400" />
                 <CardTitle className="text-sm font-black uppercase tracking-widest text-white/80">Location Insights</CardTitle>
               </div>
             </CardHeader>
             <div className="p-4 space-y-4">
               {Object.entries(locationStats)
                 .sort((a, b) => b[1] - a[1])
                 .slice(0, 8)
                 .map(([city, count], idx) => (
                   <div key={city} className="flex items-center justify-between">
                     <div className="flex items-center gap-3">
                       <span className="text-[10px] font-black text-white/20 w-4">{idx + 1}</span>
                       <span className="text-xs font-bold text-white/70">{city}</span>
                     </div>
                     <div className="flex items-center gap-2">
                       <div className="w-24 h-1.5 rounded-full bg-white/5 overflow-hidden">
                         <div 
                           className="h-full bg-blue-500/50 rounded-full" 
                           style={{ width: `${(count / (Object.values(locationStats)[0] || 1) * 100)}%` }} 
                         />
                       </div>
                       <span className="text-[10px] font-black text-blue-400">{count}</span>
                     </div>
                   </div>
                 ))}
             </div>
           </Card>
        </div>
      </div>
    </div>
  );
};

export default AdminEngagement;
