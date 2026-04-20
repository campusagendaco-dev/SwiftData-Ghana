import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet, ShoppingCart, TrendingUp, Home, ArrowDownToLine, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface DashboardStats {
  walletBalance: number;
  totalOrders: number;
  totalDeposited: number;
  totalSalesAmount: number;
  subAgentEarnings: number;
}

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState<DashboardStats>({
    walletBalance: 0,
    totalOrders: 0,
    totalDeposited: 0,
    totalSalesAmount: 0,
    subAgentEarnings: 0,
  });

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      const [walletRes, ordersRes] = await Promise.all([
        supabase.from("wallets").select("balance").eq("agent_id", user.id).single(),
        supabase
          .from("orders")
          .select("amount, order_type, status, profit")
          .eq("agent_id", user.id)
          .in("status", ["paid", "processing", "fulfilled", "fulfillment_failed"]),
      ]);

      const balance = walletRes.data ? Number(walletRes.data.balance) : 0;
      const paidishOrders = (ordersRes.data ?? []).filter((o: any) => ["paid", "processing", "fulfilled", "fulfillment_failed"].includes(o.status));
      const depositedOrders = paidishOrders.filter((o: any) => o.order_type === "wallet_topup");
      const dataOrders = paidishOrders.filter((o: any) => o.order_type === "data");
      const subAgentActivationOrders = paidishOrders.filter((o: any) => o.order_type === "sub_agent_activation");

      const totalDeposited = depositedOrders.reduce((sum: number, order: any) => sum + Number(order.amount || 0), 0);
      const totalSalesAmount = dataOrders.reduce((sum: number, order: any) => sum + Number(order.amount || 0), 0);
      const subAgentEarnings = subAgentActivationOrders.reduce((sum: number, order: any) => sum + Number(order.profit || 0), 0);

      setStats({
        walletBalance: balance,
        totalOrders: paidishOrders.length,
        totalDeposited,
        totalSalesAmount,
        subAgentEarnings,
      });
    };

    fetchData();

    const walletChannel = supabase
      .channel("dashboard-wallet")
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `agent_id=eq.${user.id}` }, (p: any) => {
        if (p.new?.balance !== undefined) setStats((prev) => ({ ...prev, walletBalance: Number(p.new.balance) }));
      })
      .subscribe();

    const ordersChannel = supabase
      .channel("dashboard-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `agent_id=eq.${user.id}` }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(walletChannel);
      supabase.removeChannel(ordersChannel);
    };
  }, [user]);

  const statItems = [
    { label: "Wallet Balance", value: `GH₵ ${stats.walletBalance.toFixed(2)}`, icon: Wallet },
    { label: "Total Orders", value: String(stats.totalOrders), icon: ShoppingCart },
    { label: "Total Deposited", value: `GH₵ ${stats.totalDeposited.toFixed(2)}`, icon: ArrowDownToLine },
    { label: "Total Sales Amount", value: `GH₵ ${stats.totalSalesAmount.toFixed(2)}`, icon: ArrowUpRight },
    { label: "Sub-Agent Earnings", value: `GH₵ ${stats.subAgentEarnings.toFixed(2)}`, icon: TrendingUp },
  ];

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      {/* Title row */}
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <Home className="w-5 h-5 text-gray-600" />
        <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">Open now</span>
      </div>

      {/* Balance card */}
      <div className="bg-[#1a1a2e] rounded-2xl p-5 mb-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <p className="text-white/50 text-xs mb-1">Wallet Balance</p>
          <p className="text-white text-3xl font-bold">GH₵ {stats.walletBalance.toFixed(2)}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-white/50 text-xs mb-1">Total Deposited</p>
          <p className="text-white text-2xl font-bold">GH₵ {stats.totalDeposited.toFixed(2)}</p>
        </div>
        <button
          onClick={() => navigate("/dashboard/wallet")}
          className="border border-amber-400 text-amber-400 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-amber-400 hover:text-black transition-colors self-start sm:self-center"
        >
          Top Up Wallet
        </button>
      </div>
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {statItems.map((s) => (
          <div key={s.label} className="bg-amber-400 rounded-xl p-3">
            <s.icon className="w-4 h-4 text-black/60 mb-1" />
            <p className="text-black font-bold text-lg leading-tight">{s.value}</p>
            <p className="text-black/60 text-xs">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl p-4 md:p-5">
        <p className="text-sm text-muted-foreground mb-3">
          Overview now focuses on transaction health. Use Buy Data pages for package purchases.
        </p>
        <button
          onClick={() => navigate("/dashboard/buy-data/mtn")}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-300 transition-colors"
        >
          Go To Buy Data
          <TrendingUp className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default Dashboard;
