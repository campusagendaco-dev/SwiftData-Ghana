import { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import DashboardSidebar from "@/components/DashboardSidebar";
import NotificationPopup from "@/components/NotificationPopup";
import { Menu, User, Wallet, MessageCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

const DashboardLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [supportChannelLink, setSupportChannelLink] = useState<string>("");

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

  useEffect(() => {
    let active = true;

    const loadSupportChannel = async () => {
      const { data } = await supabase.functions.invoke("system-settings", {
        body: { action: "get" },
      });

      if (!active) return;
      const link = String(data?.support_channel_link || "").trim();
      setSupportChannelLink(link);
    };

    loadSupportChannel();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex min-h-screen w-full bg-gray-50">
      <DashboardSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-auto min-w-0">
        {/* Top header bar */}
        <header className="bg-[#162316] text-white h-14 flex items-center px-4 gap-3 shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="md:hidden text-white/70 hover:text-white mr-1">
            <Menu className="w-5 h-5" />
          </button>
          {/* Greeting pill */}
          <div className="bg-white/10 rounded-full px-3 py-1 text-sm hidden sm:block">
            {getGreeting()}, {firstName} 👋
          </div>
          <div className="flex-1" />
          {/* Balance chip */}
          <div className="flex items-center gap-2 bg-white/10 rounded-full pl-3 pr-1 py-1">
            <Wallet className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold">GH₵ {walletBalance.toFixed(2)}</span>
            <button
              onClick={() => navigate("/dashboard/wallet")}
              className="bg-amber-400 text-black text-xs font-bold px-2 py-0.5 rounded-full hover:bg-amber-300 transition-colors"
            >
              Top Up
            </button>
          </div>
          {/* User avatar */}
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
            <User className="w-4 h-4 text-white/70" />
          </div>
        </header>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>

      {supportChannelLink && (
        <a
          href={supportChannelLink}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open WhatsApp channel"
          className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-3 text-sm font-bold text-white shadow-lg transition-transform hover:scale-105 hover:bg-[#1fb85a]"
        >
          <MessageCircle className="h-5 w-5" />
          WhatsApp
        </a>
      )}

      <NotificationPopup />
    </div>
  );
};

export default DashboardLayout;
