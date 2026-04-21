import { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import DashboardSidebar from "@/components/DashboardSidebar";
import NotificationPopup from "@/components/NotificationPopup";
import { Menu, User, Wallet } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useAppTheme } from "@/contexts/ThemeContext";

const DashboardLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { theme } = useAppTheme();
  const [walletBalance, setWalletBalance] = useState<number>(0);

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
    <div className="flex min-h-screen w-full bg-background">
      <DashboardSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-auto min-w-0">
        {/* Top header bar */}
        <header
          className="text-white h-14 flex items-center px-3 sm:px-4 gap-2 sm:gap-3 shrink-0 sticky top-0 z-30"
          style={{ background: theme.heroHex }}
        >
          <button onClick={() => setSidebarOpen(true)} className="md:hidden text-white/70 hover:text-white mr-1 p-1">
            <Menu className="w-5 h-5" />
          </button>

          {/* Greeting pill */}
          <div className="bg-white/10 rounded-full px-3 py-1 text-sm hidden sm:block truncate max-w-[200px]">
            {getGreeting()}, {firstName} 👋
          </div>
          {/* Mobile: just name */}
          <div className="sm:hidden text-sm font-semibold truncate">{firstName}</div>

          <div className="flex-1" />

          {/* Balance chip */}
          <div className="flex items-center gap-1.5 sm:gap-2 bg-white/10 rounded-full pl-2.5 sm:pl-3 pr-1 py-1">
            <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400 shrink-0" />
            <span className="text-xs sm:text-sm font-semibold">₵{walletBalance.toFixed(2)}</span>
            <button
              onClick={() => navigate("/dashboard/wallet")}
              className="bg-amber-400 text-black text-[11px] sm:text-xs font-bold px-2 py-0.5 rounded-full hover:bg-amber-300 transition-colors whitespace-nowrap"
            >
              Top Up
            </button>
          </div>

          {/* User avatar */}
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
            <User className="w-4 h-4 text-white/70" />
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      <NotificationPopup />
    </div>
  );
};

export default DashboardLayout;
