import { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import DashboardSidebar from "@/components/DashboardSidebar";
import NotificationPopup from "@/components/NotificationPopup";
import { Menu, User, Wallet, Bell, Search, PlusCircle, AlertTriangle, X, Sun, Moon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const LOW_BALANCE_THRESHOLD = 10; // GHS

import { useConnectivity } from "@/hooks/useConnectivity";
import { Wifi, WifiOff, CloudOff } from "lucide-react";

const DashboardLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { theme, isDark, toggleDark } = useAppTheme();
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const { isOnline, quality } = useConnectivity();

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
      const { data } = await supabase
        .from("wallets")
        .select("balance")
        .eq("agent_id", user.id)
        .single();
      if (data) setWalletBalance(Number(data.balance));
    };
    fetchBalance();

    const channel = supabase
      .channel("wallet-balance-header")
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `agent_id=eq.${user.id}` }, (payload: any) => {
        if (payload.new?.balance !== undefined) setWalletBalance(Number(payload.new.balance));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  return (
    <div className={cn("flex min-h-screen w-full transition-colors duration-300", isDark ? "bg-[#030703]" : "bg-gray-50")}>
      <DashboardSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* ── Premium Glass Header ── */}
        <header className={cn(
          "h-16 flex items-center px-4 sm:px-6 gap-4 shrink-0 sticky top-0 z-40 backdrop-blur-xl border-b transition-all duration-300",
          isDark ? "bg-black/40 border-white/5" : "bg-white/70 border-gray-200"
        )}>
          <button 
            onClick={() => setSidebarOpen(true)} 
            className="md:hidden p-2 rounded-xl bg-white/5 text-white/70 hover:text-white transition-all"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Search/Command Bar (Mockup for Pro feel) */}
          <div className={cn(
            "hidden lg:flex items-center gap-3 border rounded-xl px-4 py-2 w-72 focus-within:border-primary/50 transition-all cursor-text",
            isDark ? "bg-white/5 border-white/10 text-white/40" : "bg-gray-100 border-gray-200 text-gray-400"
          )}>
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
                <span className={cn("text-sm font-black leading-none", isDark ? "text-white" : "text-gray-900")}>₵{walletBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <button
                onClick={() => navigate("/dashboard/wallet")}
                className="bg-amber-400 text-black p-1.5 rounded-xl hover:bg-amber-300 transition-all shadow-lg shadow-amber-400/20 active:scale-95"
              >
                <PlusCircle className="w-4 h-4" />
              </button>
            </div>

            {/* Theme Toggle */}
            <button
              onClick={toggleDark}
              className={cn(
                "p-2.5 rounded-xl border transition-all hover:scale-105 active:scale-95",
                isDark ? "bg-white/5 border-white/10 text-white/70 hover:text-white" : "bg-gray-50 border-gray-200 text-gray-500 hover:text-gray-900"
              )}
              title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {isDark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5" />}
            </button>

            {/* Notification Bell */}
            <button className={cn(
              "relative p-2.5 rounded-xl border transition-all group",
              isDark ? "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20" : "bg-gray-50 border-gray-200 hover:bg-gray-100 hover:border-gray-300"
            )}>
              <Bell className={cn("w-5 h-5 transition-colors", isDark ? "text-white/70 group-hover:text-white" : "text-gray-500 group-hover:text-gray-900")} />
              <span className={cn("absolute top-2 right-2.5 w-2 h-2 rounded-full border-2", isDark ? "bg-red-500 border-[#0d140d]" : "bg-red-500 border-white")}></span>
            </button>

            <div className="w-px h-8 bg-white/10 mx-1 hidden sm:block" />

            {/* User Profile Trigger */}
            <button 
              onClick={() => navigate("/dashboard/profile")}
              className={cn(
                "flex items-center gap-3 pl-1 pr-1 sm:pr-2 py-1 rounded-2xl transition-all group",
                isDark ? "hover:bg-white/5" : "hover:bg-gray-100"
              )}
            >
              <Avatar className={cn("w-9 h-9 border-2 transition-all", isDark ? "border-white/10 group-hover:border-primary/50" : "border-gray-200 group-hover:border-primary/50")}>
                <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id}`} />
                <AvatarFallback className="bg-primary/10 text-xs">{firstName.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col items-start text-left leading-tight">
                <span className={cn("text-[10px] font-bold uppercase tracking-widest", isDark ? "text-white/40" : "text-gray-400")}>{getGreeting()}</span>
                <span className={cn("text-sm font-black", isDark ? "text-white" : "text-gray-900")}>{firstName}</span>
              </div>
            </button>
          </div>
        </header>

        {/* ── Low balance alert banner ── */}
        {showLowBalanceAlert && (
          <div className={cn(
            "shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5 transition-all duration-300",
            isDark ? "bg-amber-400/10 border-b border-amber-400/20" : "bg-amber-50 border-b border-amber-200"
          )}>
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs font-bold text-amber-300">
                Low wallet balance — ₵{walletBalance.toFixed(2)} remaining.{" "}
                <button
                  onClick={() => navigate("/dashboard/wallet")}
                  className="underline underline-offset-2 hover:text-amber-200 transition-colors"
                >
                  Top up now
                </button>
              </p>
            </div>
            <button
              onClick={() => setAlertDismissed(true)}
              className="text-amber-400/60 hover:text-amber-300 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <main className={cn(
          "flex-1 overflow-y-auto overflow-x-hidden transition-all duration-300",
          isDark ? "bg-gradient-to-br from-[#030703] to-[#0d140d]" : "bg-white"
        )}>
          <div className="max-w-7xl mx-auto w-full">
            <Outlet />
          </div>
        </main>
      </div>

      <NotificationPopup />
    </div>
  );
};

export default DashboardLayout;

