import { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import DashboardSidebar from "@/components/DashboardSidebar";
import NotificationPopup from "@/components/NotificationPopup";
import { Menu, User, Wallet, Bell, Search, PlusCircle, AlertTriangle, X, Sun, Moon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { NotificationCenter } from "./NotificationCenter";
import { supabase } from "@/integrations/supabase/client";
import { safeRemoveChannel } from "@/lib/safe-realtime";
import { useNavigate } from "react-router-dom";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const LOW_BALANCE_THRESHOLD = 10; // GHS

import { useConnectivity } from "@/hooks/useConnectivity";
import { Wifi, WifiOff, CloudOff, Eye, EyeOff } from "lucide-react";
import { useMaskedBalance } from "@/hooks/useMaskedBalance";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import CommandPalette from "@/components/CommandPalette";

const DashboardLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { theme, isDark, toggleDark } = useAppTheme();
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const { isOnline, quality } = useConnectivity();
  const { isMasked, toggleMask, maskValue } = useMaskedBalance();
  const { supported, permissionState, subscribeUser, loading: subLoading } = usePushNotifications();
  const [pushDismissed, setPushDismissed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [aiRecommendations, setAiRecommendations] = useState<any[]>([]);

  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);
  const showLowBalanceAlert = isPaidAgent && !alertDismissed && walletBalance < LOW_BALANCE_THRESHOLD && walletBalance >= 0;

  const firstName = profile?.full_name?.split(" ")[0] || "User";

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  useEffect(() => {
    if (!user) return;
    const fetchBalance = async () => {
      const { data, error } = await supabase
        .from("wallets")
        .select("balance")
        .eq("agent_id", user.id)
        .maybeSingle();
      
      if (error) {
        console.error("[Wallet-Debug] Error fetching balance from wallets:", error);
        return;
      }

      if (data) {
        setWalletBalance(Number(data.balance || 0));
      } else {
        setWalletBalance(0);
      }
    };
    fetchBalance();

    const fetchAiRecs = async () => {
      const { data } = await supabase
        .from("ai_recommendations")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_acted_upon", false)
        .order("created_at", { ascending: false });
      if (data) setAiRecommendations(data);
    };
    fetchAiRecs();

    const channel = supabase
      .channel("wallet-balance-header")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "wallets", filter: `agent_id=eq.${user.id}` }, (payload: any) => {
        if (payload.new?.balance !== undefined) {
          const newBal = Number(payload.new.balance);
          const oldBal = Number(payload.old?.balance || 0);
          
          // Play crisp chime if balance increases (credit/sale)
          if (newBal > oldBal) {
            import("@/lib/sound").then(m => m.playSuccessSound());
          }
          
          setWalletBalance(newBal);
        }
      })
      .subscribe();
    return () => { safeRemoveChannel(channel); };
  }, [user]);

  return (
    <div className={cn("flex min-h-screen w-full transition-colors duration-300 bg-transparent")}>
      <DashboardSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      <div className="flex-1 flex flex-col min-w-0 h-[100dvh] overflow-hidden">
        {/* ── Premium Glass Header ── */}
        <div className="px-4 sm:px-6 pt-3 sm:pt-4 pb-2 shrink-0 sticky top-0 z-40">
        <header className="glass-panel-cyber h-16 flex items-center px-4 sm:px-5 gap-4 rounded-[24px]">
          <button
            onClick={() => setSidebarOpen(true)} 
            aria-label="Open sidebar menu"
            title="Open Menu"
            className={cn(
              "md:hidden p-2 rounded-xl transition-all",
              isDark ? "bg-white/5 text-white/70 hover:text-white" : "bg-gray-100 text-gray-900 hover:bg-gray-200"
            )}
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Search/Command Bar (Mockup for Pro feel) */}
          <div 
            onClick={() => setCommandOpen(true)}
            className={cn(
              "hidden lg:flex items-center gap-3 border rounded-xl px-4 py-2 w-72 focus-within:border-primary/50 transition-all cursor-pointer hover:opacity-80",
              isDark ? "bg-white/5 border-white/10 text-white/40" : "bg-gray-100 border-gray-200 text-gray-400"
            )}
          >
            <Search className="w-4 h-4" />
            <span className="text-xs font-medium">Quick Search...</span>
            <div className="flex-1" />
            <kbd className={cn("text-[10px] px-1.5 py-0.5 rounded border", isDark ? "bg-white/10 border-white/10" : "bg-gray-200 border-gray-300 text-gray-500")}>⌘K</kbd>
          </div>

          <div className="flex-1" />

          {/* Action Chips */}
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Connectivity Badge */}
            <div className={cn(
              "hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-widest transition-all",
              !isOnline 
                ? "bg-red-500/10 border-red-500/30 text-red-400" 
                : quality === "poor" || quality === "fair"
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : (isDark ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-emerald-50 border-emerald-200 text-emerald-700")
            )}>
              {!isOnline ? <CloudOff className="w-3 h-3" /> : quality === "poor" ? <WifiOff className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
              <span className="hidden lg:inline">{!isOnline ? "Offline" : quality === "poor" ? "Weak" : "Secure"}</span>
            </div>

            {/* Balance Card */}
            <div className={cn(
              "flex items-center gap-2 border rounded-2xl pl-3 pr-1 py-1 group transition-all",
              isDark ? "bg-white/5 border-white/10 hover:border-primary/30" : "bg-gray-50 border-gray-200 hover:border-primary/50"
            )}>
              <div className="w-7 h-7 rounded-full bg-amber-400/10 flex items-center justify-center">
                <Wallet className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="flex flex-col mr-1">
                <span className={cn("text-[9px] font-black uppercase tracking-widest leading-none mb-0.5", isDark ? "text-white/30" : "text-gray-400")}>Wallet</span>
                <span className={cn("text-sm font-black leading-none flex items-center gap-1", isDark ? "text-white" : "text-gray-900")}>
                  ₵{maskValue(walletBalance)}
                  <button 
                    onClick={(e) => { e.stopPropagation(); toggleMask(); }}
                    className="p-0.5 opacity-40 hover:opacity-100 hover:bg-white/10 rounded transition-all ml-1"
                  >
                    {isMasked ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                  </button>
                </span>
              </div>
              <button
                onClick={() => navigate("/dashboard/wallet")}
                aria-label="Top up wallet balance"
                title="Top up Wallet"
                className="bg-amber-400 text-black p-1.5 rounded-xl hover:bg-amber-300 transition-all shadow-lg shadow-amber-400/20 active:scale-95"
              >
                <PlusCircle className="w-4 h-4" />
              </button>
            </div>

            {/* Theme Toggle */}
            <button
              onClick={toggleDark}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className={cn(
                "p-2.5 rounded-xl border transition-all hover:scale-105 active:scale-95",
                isDark ? "bg-white/5 border-white/10 text-white/70 hover:text-white" : "bg-gray-50 border-gray-200 text-gray-500 hover:text-gray-900"
              )}
              title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {isDark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5" />}
            </button>

            {/* Notification Bell */}
            <NotificationCenter isDark={isDark} />

            <div className="w-px h-8 bg-white/10 mx-1 hidden sm:block" />

            {/* User Profile Trigger */}
            <button 
              onClick={() => navigate("/dashboard/profile")}
              aria-label="View user profile and settings"
              title="My Profile"
              className={cn(
                "flex items-center gap-3 pl-1 pr-1 sm:pr-2 py-1 rounded-2xl transition-all group",
                isDark ? "hover:bg-white/5" : "hover:bg-gray-100"
              )}
            >
              <Avatar className={cn("w-9 h-9 border-2 transition-all", isDark ? "border-white/10 group-hover:border-primary/50" : "border-gray-200 group-hover:border-primary/50")}>
                <AvatarImage src={profile?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id}`} />
                <AvatarFallback className="bg-primary/10 text-xs">{firstName.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col items-start text-left leading-tight">
                <span className={cn("text-[10px] font-bold uppercase tracking-widest", isDark ? "text-white/40" : "text-gray-400")}>{getGreeting()}</span>
                <span className={cn("text-sm font-black", isDark ? "text-white" : "text-gray-900")}>{firstName}</span>
              </div>
            </button>
          </div>
        </header>
        </div>

        {/* ── Low balance alert banner ── */}
        {showLowBalanceAlert && (
          <div className={cn(
            "shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5 transition-all duration-300",
            isDark ? "bg-amber-400/10 border-b border-amber-400/20" : "bg-amber-50 border-b border-amber-200"
          )}>
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <p className={cn("text-xs font-bold transition-colors", isDark ? "text-amber-300" : "text-amber-800")}>
                Low wallet balance — ₵{maskValue(walletBalance)} remaining.{" "}
                <button
                  onClick={() => navigate("/dashboard/wallet")}
                  className={cn("underline underline-offset-2 transition-colors", isDark ? "hover:text-amber-200" : "hover:text-amber-900")}
                >
                  Top up now
                </button>
              </p>
            </div>
            <button
              onClick={() => setAlertDismissed(true)}
              aria-label="Dismiss low balance alert"
              title="Dismiss"
              className="text-amber-400/60 hover:text-amber-300 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Push notification banner ── */}
        {supported && permissionState === "default" && !pushDismissed && (
          <div className={cn(
            "shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5 transition-all duration-300 animate-in slide-in-from-top-4 duration-500",
            isDark ? "bg-indigo-500/10 border-b border-indigo-500/20" : "bg-indigo-50 border-b border-indigo-200"
          )}>
            <div className="flex items-center gap-2.5">
              <Bell className="w-4 h-4 text-indigo-400 shrink-0 animate-bounce" />
              <p className={cn("text-xs font-bold transition-colors", isDark ? "text-indigo-300" : "text-indigo-800")}>
                Want real-time lock-screen alerts for your store sales?{" "}
                <button
                  onClick={subscribeUser}
                  disabled={subLoading}
                  className={cn("underline underline-offset-2 transition-colors font-black", isDark ? "text-white hover:text-indigo-200" : "text-indigo-950 hover:text-indigo-700")}
                >
                  {subLoading ? "Enabling..." : "Enable Notifications"}
                </button>
              </p>
            </div>
            <button
              onClick={() => setPushDismissed(true)}
              aria-label="Dismiss notification alert"
              title="Dismiss"
              className="text-indigo-400/60 hover:text-indigo-300 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── AI Profit Recommender Banner ── */}
        {aiRecommendations.length > 0 && (
          <div className="shrink-0 px-4 sm:px-6 py-3 transition-all duration-300">
            {aiRecommendations.map((rec) => (
              <div key={rec.id} className="p-4 mb-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 backdrop-blur-md relative overflow-hidden flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between shadow-[0_0_30px_-5px_rgba(99,102,241,0.15)]">
                <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.8)]"></div>
                <div className="flex items-start gap-4 z-10">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center shrink-0 border border-indigo-500/30">
                    <span className="text-xl">✨</span>
                  </div>
                  <div>
                    <h3 className="font-black text-indigo-400">{rec.title}</h3>
                    <p className="text-sm mt-1 text-gray-800 dark:text-gray-300 font-medium">
                      {rec.message}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto z-10">
                  <button 
                    onClick={async () => {
                      await supabase.from("ai_recommendations").update({ is_acted_upon: true }).eq("id", rec.id);
                      setAiRecommendations(prev => prev.filter(r => r.id !== rec.id));
                      navigate("/dashboard/pricing");
                    }}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-black text-sm flex-1 sm:flex-none text-center shadow-[0_0_15px_rgba(99,102,241,0.4)] transition-all hover:scale-105"
                  >
                    Update Pricing
                  </button>
                  <button 
                    onClick={async () => {
                      await supabase.from("ai_recommendations").update({ is_acted_upon: true }).eq("id", rec.id);
                      setAiRecommendations(prev => prev.filter(r => r.id !== rec.id));
                    }}
                    className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <main className={cn(
          "flex-1 overflow-y-auto overflow-x-hidden transition-all duration-300",
          isDark ? "bg-black/15" : "bg-white/20"
        )}>
          <div className="max-w-7xl mx-auto w-full">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette open={commandOpen} setOpen={setCommandOpen} />
      <NotificationPopup />
    </div>
  );
};

export default DashboardLayout;

