import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  User, Store, ShieldCheck, Trophy, 
  TrendingUp, ShoppingCart, Award, Calendar, Activity,
  ChevronRight, BadgeCheck, Copy, Target, Star, Database, RefreshCw, Zap, Heart,
  Settings, Phone, Trash2, AlertTriangle, Loader2
} from "lucide-react";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getFunctionErrorMessage } from "@/lib/function-errors";

interface ProfileStats {
  total_fulfilled_orders: number;
  total_sales_volume: number;
  total_own_profit: number;
  rank_position?: number;
}

const DashboardProfile = () => {
  const { user, profile } = useAuth();
  const { theme } = useAppTheme();
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    if (!user) return;

    const fetchProfileData = async () => {
      try {
        const { data: statsData } = await supabase
          .from("user_sales_stats")
          .select("*")
          .eq("user_id", user.id)
          .single();

        const { data: leaderboardData } = await supabase.rpc("get_agent_leaderboard");
        const myRank = leaderboardData?.find((entry: any) => entry.is_current_user)?.rank_position;

        setStats({
          total_fulfilled_orders: statsData?.total_fulfilled_orders || 0,
          total_sales_volume: statsData?.total_sales_volume || 0,
          total_own_profit: statsData?.total_own_profit || 0,
          rank_position: myRank
        });
      } catch (error) {
        console.error("Error fetching profile stats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchProfileData();
  }, [user]);

  const handleDeleteAccount = async () => {
    if (!user) return;
    
    const confirmDelete = window.confirm(
      "Are you absolutely sure you want to delete your account? This action is PERMANENT and cannot be undone. All your data, including order history and wallet balance, will be lost."
    );
    
    if (!confirmDelete) return;
    
    const secondConfirm = window.confirm(
      "Final Confirmation: This is your last chance to cancel. Proceed with deletion?"
    );
    
    if (!secondConfirm) return;

    setDeletingAccount(true);
    try {
      const { error } = await supabase.functions.invoke("delete-account");
      if (error) throw error;
      
      toast.success("Account deleted successfully");
      await supabase.auth.signOut();
      window.location.href = "/";
    } catch (e: any) {
      const errorMsg = await getFunctionErrorMessage(e, "Could not delete account. Please contact support.");
      toast.error(errorMsg);
      setDeletingAccount(false);
    }
  };

  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved || profile?.api_access_enabled);
  const accountType = profile?.api_access_enabled
    ? "API Partner"
    : isPaidAgent 
      ? (profile?.is_sub_agent ? "Sub-Agent" : "Direct Agent") 
      : "Regular Customer";
  
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const accountId = (profile as any)?.topup_reference || "PENDING";

  return (
    <div className="min-h-screen pb-6">
      <div className="relative h-48 sm:h-64 bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 overflow-hidden">
        <div className="absolute inset-0 bg-black/20" />
        <div className="absolute inset-0 backdrop-blur-[2px]" />
        <div className="absolute top-[-10%] left-[-5%] w-64 h-64 bg-white/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-[-20%] right-[-5%] w-80 h-80 bg-blue-400/20 rounded-full blur-3xl animate-pulse delay-700" />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-20 sm:-mt-24 relative z-10">
        <div className="flex flex-col md:flex-row gap-8">
          <div className="w-full md:w-80 space-y-6">
            <Card className="border-none bg-card/80 backdrop-blur-xl shadow-2xl overflow-hidden ring-1 ring-white/10">
              <CardContent className="p-6 flex flex-col items-center text-center">
                <div className="relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full blur opacity-40 group-hover:opacity-75 transition duration-500"></div>
                  <Avatar className="w-24 h-24 sm:w-32 sm:h-32 border-4 border-card relative">
                    <AvatarImage src={profile?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id}`} />
                    <AvatarFallback className="text-2xl bg-primary/10">
                      {profile?.full_name?.charAt(0) || "U"}
                    </AvatarFallback>
                  </Avatar>
                  {isPaidAgent && (
                    <div className={`absolute bottom-1 right-1 p-1.5 rounded-full border-4 border-card shadow-lg ${
                      profile?.api_access_enabled ? "bg-cyan-500 text-white" : "bg-blue-500 text-white"
                    }`}>
                      <BadgeCheck className="w-4 h-4" />
                    </div>
                  )}
                </div>

                <div className="mt-4 space-y-1">
                  <h2 className="text-xl font-black tracking-tight">{profile?.full_name || "New User"}</h2>
                  <p className="text-sm text-muted-foreground font-medium">{user?.email}</p>
                </div>

                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Badge variant="outline" className={`${
                    profile?.api_access_enabled 
                      ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-500" 
                      : "bg-primary/5 border-primary/20 text-primary"
                  } px-3 py-1 text-[10px] uppercase tracking-wider font-bold`}>
                    {accountType}
                  </Badge>
                  {profile?.onboarding_complete && (
                    <Badge variant="outline" className="bg-green-500/5 border-green-500/20 text-green-500 px-3 py-1 text-[10px] uppercase tracking-wider font-bold">
                      Verified
                    </Badge>
                  )}
                </div>

                <div className="w-full mt-6 pt-6 border-t border-white/5 space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4" /> Account ID
                    </span>
                    <button 
                      onClick={() => copyToClipboard(`DH-${accountId}`, "Account ID")}
                      className="font-mono font-bold hover:text-primary transition-colors flex items-center gap-1.5"
                    >
                      DH-{accountId}
                      <Copy className="w-3 h-3 opacity-50" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Calendar className="w-4 h-4" /> Joined
                    </span>
                    <span className="font-semibold">
                      {new Date(profile?.created_at || "").toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                </div>

                <Button onClick={() => window.location.href = '/dashboard/settings'} variant="outline" className="w-full mt-6 bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 font-bold">
                  <Settings className="w-4 h-4 mr-2" />
                  Edit Profile
                </Button>
              </CardContent>
            </Card>

            <Card className="border-none bg-indigo-600/10 border border-indigo-500/20 shadow-sm overflow-hidden">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-600/20">
                    <Zap className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Activity Level</p>
                    <p className="text-sm font-black">Professional</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px] font-bold uppercase">
                    <span className="text-muted-foreground">Progression</span>
                    <span className="text-indigo-400">85%</span>
                  </div>
                  <Progress value={85} className="h-1.5 bg-indigo-600/20" />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex-1 space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Total Orders", value: stats?.total_fulfilled_orders, icon: ShoppingCart, color: "blue" },
                { label: "Sales Volume", value: `₵${stats?.total_sales_volume.toFixed(0)}`, icon: TrendingUp, color: "amber" },
                { label: "Total Profit", value: `₵${stats?.total_own_profit.toFixed(0)}`, icon: Award, color: "green" },
                { label: "Global Rank", value: stats?.rank_position ? `#${stats.rank_position}` : "—", icon: Trophy, color: "purple" },
              ].map((item, i) => (
                <Card key={i} className="border-none bg-card/40 backdrop-blur-sm shadow-sm hover:shadow-md transition-all group overflow-hidden relative">
                  <div className="absolute -right-2 -bottom-2 w-16 h-16 opacity-5 group-hover:opacity-10 transition-opacity">
                    <item.icon className="w-full h-full" />
                  </div>
                  <CardContent className="p-4 flex flex-col gap-1">
                    <div className={`p-2 rounded-lg w-fit mb-1 bg-${item.color}-500/10 text-${item.color}-500`}>
                      <item.icon className="w-4 h-4" />
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{item.label}</p>
                    {loading ? <Skeleton className="h-6 w-16 mt-1" /> : <p className="text-lg font-black">{item.value}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>

            <Tabs defaultValue="overview" className="space-y-6">
              <TabsList className="bg-card/50 backdrop-blur-sm border border-white/5 p-1">
                <TabsTrigger value="overview" className="font-bold px-6">Overview</TabsTrigger>
                <TabsTrigger value="performance" className="font-bold px-6">Performance</TabsTrigger>
                <TabsTrigger value="payments" className="font-bold px-6">Payments</TabsTrigger>
                <TabsTrigger value="provider" className="font-bold px-6">Provider History</TabsTrigger>
                <TabsTrigger value="store" className="font-bold px-6">My Store</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6 focus-visible:outline-none">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="border-none bg-card shadow-sm">
                    <CardHeader className="pb-4">
                      <CardTitle className="text-lg font-bold flex items-center gap-2">
                        <User className="w-5 h-5 text-primary" />
                        Account Details
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      {[
                        { label: "Store Name", value: profile?.store_name || "Not set", icon: Store },
                        { label: "Phone", value: profile?.phone || "Not set", icon: Phone },
                        { label: "WhatsApp", value: profile?.whatsapp_number || "Not set", icon: Activity },
                        { label: "Referral ID", value: profile?.topup_reference || "N/A", icon: Target },
                      ].map((item) => (
                        <div key={item.label} className="group">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1.5">
                            <item.icon className="w-3 h-3" />
                            {item.label}
                          </p>
                          <p className="text-sm font-bold truncate group-hover:text-primary transition-colors">{item.value}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card className="border-none bg-gradient-to-br from-purple-600/10 to-indigo-600/5 shadow-md relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                      <Trophy className="w-24 h-24" />
                    </div>
                    <CardHeader>
                      <CardTitle className="text-lg font-bold flex items-center gap-2">
                        <Star className="w-5 h-5 text-amber-400" />
                        Leaderboard Status
                      </CardTitle>
                      <CardDescription>Your current standing among all agents</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="flex items-end gap-3">
                        <p className="text-5xl font-black leading-none bg-gradient-to-br from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                          {stats?.rank_position ? `#${stats.rank_position}` : "N/A"}
                        </p>
                        <p className="text-xs text-muted-foreground font-bold uppercase pb-1">Current Ranking</p>
                      </div>
                      <div className="space-y-2">
                        <div className="w-full bg-white/5 rounded-full h-2">
                          <div 
                            className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full shadow-[0_0_12px_rgba(99,102,241,0.5)] transition-all duration-1000" 
                            style={{ width: stats?.rank_position ? `${Math.max(15, 100 - (stats.rank_position * 2))}%` : '5%' }} 
                          />
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">Reach the <b>Top 10</b> to unlock rewards.</p>
                      </div>
                      <Button onClick={() => window.location.href = '/dashboard/leaderboard'} variant="secondary" className="w-full font-bold group">
                        Explore Leaderboard <ChevronRight className="w-4 h-4 ml-2" />
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="payments" className="focus-visible:outline-none">
                <Card className="border-none bg-card shadow-sm overflow-hidden">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-emerald-500" />
                      Saved Payment Methods
                    </CardTitle>
                    <CardDescription>Securely tokenized cards for one-click checkout and auto-topup.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {profile?.paystack_saved_authorizations && (profile.paystack_saved_authorizations as any[]).length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(profile.paystack_saved_authorizations as any[]).map((auth, idx) => (
                          <div 
                            key={auth.signature || idx} 
                            className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500/5 to-purple-500/5 border border-indigo-500/10 hover:border-indigo-500/30 transition-all group relative"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-white/5 rounded-lg border border-white/10 group-hover:bg-indigo-500/10 transition-colors">
                                  <Star className={`w-5 h-5 ${auth.brand === 'visa' ? 'text-blue-400' : 'text-orange-400'}`} />
                                </div>
                                <div>
                                  <p className="text-sm font-black capitalize">{auth.brand || 'Card'} •••• {auth.last4}</p>
                                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                    Expires {auth.exp_month}/{auth.exp_year}
                                  </p>
                                </div>
                              </div>
                              <Button 
                                size="icon" 
                                variant="ghost" 
                                className="h-8 w-8 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all"
                                onClick={async () => {
                                  if (!confirm("Remove this payment method?")) return;
                                  try {
                                    const { error } = await supabase.functions.invoke("paystack-manage-cards", {
                                      body: { action: "delete", signature: auth.signature }
                                    });
                                    if (error) throw error;
                                    toast.success("Card removed successfully");
                                    window.location.reload();
                                  } catch (err) {
                                    toast.error("Failed to remove card");
                                  }
                                }}
                              >
                                <Zap className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                            <div className="mt-4 flex items-center justify-between">
                               <Badge variant="outline" className="bg-emerald-500/5 text-emerald-500 border-emerald-500/10 text-[9px] uppercase font-bold py-0">
                                 Active Token
                               </Badge>
                               <span className="text-[9px] font-bold text-muted-foreground">{auth.bank || 'Verified'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-12 text-center space-y-4 bg-indigo-500/5 rounded-2xl border border-dashed border-indigo-500/20">
                        <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto">
                          <Heart className="w-8 h-8 text-indigo-400 opacity-50" />
                        </div>
                        <div className="max-w-xs mx-auto">
                          <p className="text-sm font-bold">No saved cards yet</p>
                          <p className="text-xs text-muted-foreground mt-1">Cards are automatically saved when you make your first purchase for faster checkout next time.</p>
                        </div>
                      </div>
                    )}

                    <div className="pt-4 border-t border-white/5">
                      <div className="flex items-center gap-3 p-4 bg-amber-500/5 border border-amber-500/10 rounded-xl">
                        <ShieldCheck className="w-5 h-5 text-amber-500 shrink-0" />
                        <p className="text-[10px] font-medium leading-relaxed text-amber-200/80 uppercase tracking-wide">
                          Your payment details are never stored on our servers. We use <b>Paystack Secure Tokenization</b> to keep your data encrypted and safe.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="performance" className="focus-visible:outline-none">
                <Card className="border-none bg-card shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-green-500" />
                      Sales Analytics
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-8 py-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                      <div className="text-center space-y-2">
                        <p className="text-3xl font-black">₵{stats?.total_own_profit.toFixed(2)}</p>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Lifetime Profit</p>
                      </div>
                      <div className="text-center space-y-2 border-x border-white/5">
                        <p className="text-3xl font-black">{stats?.total_fulfilled_orders}</p>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Successful Trades</p>
                      </div>
                      <div className="text-center space-y-2">
                        <p className="text-3xl font-black">₵{stats?.total_sales_volume.toFixed(0)}</p>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Turnover Volume</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="provider" className="focus-visible:outline-none">
                <Card className="border-none bg-card shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <Database className="w-5 h-5 text-indigo-500" />
                      DataMart Provider Logs
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-2xl border border-white/5 overflow-hidden">
                       <div className="bg-white/5 px-4 py-3 grid grid-cols-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                          <span>Reference</span>
                          <span>Service</span>
                          <span>Status</span>
                          <span className="text-right">Time</span>
                       </div>
                       <div className="divide-y divide-white/5">
                          <div className="px-6 py-12 text-center space-y-3">
                             <Activity className="w-6 h-6 text-primary animate-pulse mx-auto" />
                             <p className="text-sm font-bold">Syncing Provider Records...</p>
                          </div>
                       </div>
                    </div>
                    <Button 
                      variant="outline" 
                      className="w-full font-bold border-dashed border-2" 
                      onClick={async () => {
                        toast.info("Global Sync Started... Clearing backlog");
                        try {
                          await supabase.functions.invoke("datamart-sync");
                          toast.success("Sync Complete! All orders updated.");
                          window.location.reload();
                        } catch (err) {
                          toast.error("Sync failed. Try again later.");
                        }
                      }}
                    >
                      <RefreshCw className="w-4 h-4 mr-2" /> Force Full Audit Sync
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="store" className="focus-visible:outline-none">
                <Card className="border-none bg-card shadow-sm overflow-hidden">
                  <div className="h-32 bg-gradient-to-r from-blue-600 to-indigo-700 relative flex items-center justify-center">
                    <Store className="w-24 h-24 text-white opacity-10" />
                  </div>
                  <CardContent className="p-8 -mt-12">
                    <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 mb-6">
                      <div className="w-20 h-20 rounded-2xl bg-card border-4 border-card shadow-xl flex items-center justify-center shrink-0">
                        <Store className="w-10 h-10 text-primary" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-black">{profile?.store_name || "Your Store"}</h3>
                        <p className="text-xs text-muted-foreground font-medium truncate">swiftdata.gh/store/{profile?.slug || "setup-pending"}</p>
                        {(profile as any)?.custom_domain && (
                          <p className="text-xs text-primary font-bold mt-1 flex items-center gap-1.5">
                            <Zap className="w-3 h-3" /> Custom Domain: {(profile as any).custom_domain}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                      <Button 
                        disabled={!profile?.slug} 
                        onClick={() => window.open((profile as any)?.custom_domain ? `https://${(profile as any).custom_domain}` : `/store/${profile?.slug}`, '_blank')} 
                        className="font-bold h-12 rounded-xl"
                      >
                        Visit Store
                      </Button>
                      <Button onClick={() => window.location.href = '/dashboard/my-store'} variant="secondary" className="font-bold h-12 rounded-xl">Store Settings</Button>
                    </div>

                    <div className="pt-6 border-t border-border">
                      <h4 className="text-sm font-bold flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-amber-500" />
                        Custom Domain Mapping
                      </h4>
                      <p className="text-xs text-muted-foreground mb-4 max-w-lg">
                        Map your own domain (e.g., bundles.mybrand.com) to your storefront. 
                        You must point a CNAME record to our servers for this to work.
                      </p>
                      <div className="flex items-center gap-3">
                        <input 
                          type="text" 
                          id="custom_domain_input"
                          defaultValue={(profile as any)?.custom_domain || ""}
                          placeholder="e.g. data.mycompany.com"
                          className="flex-1 h-10 border border-input bg-background rounded-lg px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary text-foreground max-w-sm"
                        />
                        <Button 
                          variant="outline" 
                          className="h-10 px-4 font-bold border-primary/20 hover:bg-primary/10 text-primary"
                          onClick={async () => {
                            const val = (document.getElementById("custom_domain_input") as HTMLInputElement).value;
                            const { error } = await supabase.from("profiles").update({ custom_domain: val || null }).eq("user_id", user?.id);
                            if (error) {
                              toast.error(error.message?.includes("unique") ? "Domain already in use" : "Failed to save domain");
                            } else {
                              toast.success("Custom domain updated!");
                            }
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
        
        {/* Danger Zone */}
        <div className="mt-12 pt-8 border-t border-red-500/10">
          <Card className="border-none bg-red-500/5 ring-1 ring-red-500/20">
            <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
              <div className="space-y-1">
                <h3 className="text-lg font-black text-red-500 flex items-center gap-2 justify-center sm:justify-start">
                  <AlertTriangle className="w-5 h-5" />
                  Danger Zone
                </h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  Permanently delete your account and all associated data. This action cannot be undone.
                </p>
              </div>
              <Button 
                onClick={handleDeleteAccount}
                disabled={deletingAccount}
                variant="destructive" 
                className="bg-red-600 hover:bg-red-700 font-bold px-8 h-12 rounded-xl shadow-lg shadow-red-600/20"
              >
                {deletingAccount ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Deleting...</>
                ) : (
                  <><Trash2 className="w-4 h-4 mr-2" /> Delete My Account</>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default DashboardProfile;
