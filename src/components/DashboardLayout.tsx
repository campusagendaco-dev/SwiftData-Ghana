import { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import DashboardSidebar from "@/components/DashboardSidebar";
import NotificationPopup from "@/components/NotificationPopup";
import { Menu, User, Wallet, Bell, Search, PlusCircle, AlertTriangle, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const LOW_BALANCE_THRESHOLD = 10; // GHS

const DashboardLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { theme } = useAppTheme();
  const [walletBalance, setWalletBalance] = useState<number>(0);

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
    <div className="flex min-h-screen w-full bg-[#030703]">
      <DashboardSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* ── Premium Glass Header ── */}
        <header className="h-16 flex items-center px-4 sm:px-6 gap-4 shrink-0 sticky top-0 z-40 bg-black/40 backdrop-blur-xl border-b border-white/5">
          <button 
            onClick={() => setSidebarOpen(true)} 
            className="md:hidden p-2 rounded-xl bg-white/5 text-white/70 hover:text-white transition-all"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Search/Command Bar (Mockup for Pro feel) */}
          <div className="hidden lg:flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-2 w-72 focus-within:border-primary/50 transition-all cursor-text text-white/40">
            <Search className="w-4 h-4" />
            <span className="text-xs font-medium">Quick Search...</span>
            <div className="flex-1" />
            <kbd className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded border border-white/10">⌘K</kbd>
          </div>

          <div className="flex-1" />

          {/* Action Chips */}
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Balance Card */}
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl pl-3 pr-1 py-1 group hover:border-primary/30 transition-all">
              <div className="w-7 h-7 rounded-full bg-amber-400/10 flex items-center justify-center">
                <Wallet className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="flex flex-col mr-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-white/30 leading-none mb-0.5">Wallet</span>
                <span className="text-sm font-black text-white leading-none">₵{walletBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <button
                onClick={() => navigate("/dashboard/wallet")}
                className="bg-amber-400 text-black p-1.5 rounded-xl hover:bg-amber-300 transition-all shadow-lg shadow-amber-400/20 active:scale-95"
              >
                <PlusCircle className="w-4 h-4" />
              </button>
            </div>

            {/* Notification Bell */}
            <button className="relative p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all group">
              <Bell className="w-5 h-5 text-white/70 group-hover:text-white transition-colors" />
              <span className="absolute top-2 right-2.5 w-2 h-2 bg-red-500 rounded-full border-2 border-[#0d140d]"></span>
            </button>

            <div className="w-px h-8 bg-white/10 mx-1 hidden sm:block" />

            {/* User Profile Trigger */}
            <button 
              onClick={() => navigate("/dashboard/profile")}
              className="flex items-center gap-3 pl-1 pr-1 sm:pr-2 py-1 rounded-2xl hover:bg-white/5 transition-all group"
            >
              <Avatar className="w-9 h-9 border-2 border-white/10 group-hover:border-primary/50 transition-all">
                <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.id}`} />
                <AvatarFallback className="bg-primary/10 text-xs">{firstName.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col items-start text-left leading-tight">
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{getGreeting()}</span>
                <span className="text-sm font-black text-white">{firstName}</span>
              </div>
            </button>
          </div>
        </header>

        {/* ── Low balance alert banner ── */}
        {showLowBalanceAlert && (
          <div className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5 bg-amber-400/10 border-b border-amber-400/20">
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

        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-gradient-to-br from-[#030703] to-[#0d140d]">
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

