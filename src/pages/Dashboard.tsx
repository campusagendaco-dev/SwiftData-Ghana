import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet, ShoppingCart, TrendingUp, Database, Home, X, Phone } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { basePackages } from "@/lib/data";

interface DashboardStats {
  walletBalance: number;
  ordersToday: number;
  amountToday: number;
  gbToday: number;
}

const NETWORKS = ["MTN", "Telecel", "AT iShare"] as const;
type Network = typeof NETWORKS[number];

const NETWORK_API_NAME: Record<Network, string> = {
  MTN: "MTN",
  Telecel: "Telecel",
  "AT iShare": "AirtelTigo",
};

const Dashboard = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [stats, setStats] = useState<DashboardStats>({ walletBalance: 0, ordersToday: 0, amountToday: 0, gbToday: 0 });
  const [activeNetwork, setActiveNetwork] = useState<Network>("MTN");
  const [buyDialog, setBuyDialog] = useState<{ open: boolean; pkg?: { size: string; price: number } }>({ open: false });
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [agentMarkups, setAgentMarkups] = useState<Record<string, number>>({ MTN: 0, Telecel: 0, AirtelTigo: 0 });

  const apiNetwork = NETWORK_API_NAME[activeNetwork];
  const packages = basePackages[apiNetwork] ?? [];

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      const today = new Date().toISOString().split("T")[0];

      const [walletRes, ordersRes, markupRes] = await Promise.all([
        supabase.from("wallets").select("balance").eq("user_id", user.id).single(),
        supabase.from("orders").select("amount, package_size, status, created_at").eq("agent_id", user.id).gte("created_at", `${today}T00:00:00`),
      supabase.from("profiles").select("markups").eq("id", user.id).single(),
      ]);

      const balance = walletRes.data ? Number(walletRes.data.balance) : 0;
      const todayOrders = (ordersRes.data ?? []).filter((o) => ["paid", "fulfilled", "fulfillment_failed"].includes(o.status));
      const amountToday = todayOrders.reduce((s, o) => s + Number(o.amount), 0);
      const gbToday = todayOrders.reduce((s, o) => {
        const match = o.package_size?.match(/^(\d+(\.\d+)?)/);
        return s + (match ? parseFloat(match[1]) : 0);
      }, 0);

      setStats({ walletBalance: balance, ordersToday: todayOrders.length, amountToday, gbToday });
      if (markupRes.data?.markups) {
        const raw = markupRes.data.markups as Record<string, string | number>;
        setAgentMarkups({
          MTN: parseFloat(String(raw.MTN ?? 0)),
          Telecel: parseFloat(String(raw.Telecel ?? 0)),
          AirtelTigo: parseFloat(String(raw.AirtelTigo ?? 0)),
        });
      }
    };

    fetchData();

    const walletChannel = supabase
      .channel("dashboard-wallet")
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `user_id=eq.${user.id}` }, (p: any) => {
        if (p.new?.balance !== undefined) setStats((prev) => ({ ...prev, walletBalance: Number(p.new.balance) }));
      })
      .subscribe();

    return () => { supabase.removeChannel(walletChannel); };
  }, [user]);

  const getDisplayPrice = (basePrice: number) => basePrice + (agentMarkups[apiNetwork] ?? 0);

  const openBuy = (pkg: { size: string; price: number }) => {
    setPhone("");
    setBuyDialog({ open: true, pkg });
  };

  const handleBuy = async () => {
    if (!buyDialog.pkg) return;
    if (!/^0[235]\d{8}$/.test(phone)) {
      toast({ title: "Invalid phone number", description: "Enter a valid Ghana number (e.g. 0241234567)", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const amount = getDisplayPrice(buyDialog.pkg.price);
      const { data, error } = await supabase.functions.invoke("wallet-buy-data", {
        body: { network: apiNetwork, package_size: buyDialog.pkg.size, customer_phone: phone, amount },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error || "Purchase failed");
      toast({ title: "Order placed!", description: `${buyDialog.pkg.size} for ${phone}` });
      setBuyDialog({ open: false });
      setPhone("");
    } catch (err: any) {
      toast({ title: "Purchase failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const statItems = [
    { label: "Wallet Balance", value: `GH₵ ${stats.walletBalance.toFixed(2)}`, icon: Wallet },
    { label: "Today's Orders", value: String(stats.ordersToday), icon: ShoppingCart },
    { label: "Today's Amount", value: `GH₵ ${stats.amountToday.toFixed(2)}`, icon: TrendingUp },
    { label: "Today's Bundle", value: `${stats.gbToday.toFixed(0)} GB`, icon: Database },
  ];

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      {/* Title row */}
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <Home className="w-5 h-5 text-gray-400" />
        <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">Open now</span>
      </div>

      {/* Balance card */}
      <div className="bg-[#1a1a2e] rounded-2xl p-5 mb-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <p className="text-white/50 text-xs mb-1">Wallet Balance</p>
          <p className="text-white text-3xl font-bold">GH₵ {stats.walletBalance.toFixed(2)}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-white/50 text-xs mb-1">Today's Spent</p>
          <p className="text-white text-2xl font-bold">GH₵ {stats.amountToday.toFixed(2)}</p>
        </div>
        <button
          onClick={() => navigate("/dashboard/wallet")}
          className="border border-amber-400 text-amber-400 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-amber-400 hover:text-black transition-colors self-start sm:self-center"
        >
          Top Up Wallet
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {statItems.map((s) => (
          <div key={s.label} className="bg-amber-400 rounded-xl p-3">
            <s.icon className="w-4 h-4 text-black/60 mb-1" />
            <p className="text-black font-bold text-lg leading-tight">{s.value}</p>
            <p className="text-black/60 text-xs">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Network tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {NETWORKS.map((n) => (
          <button
            key={n}
            onClick={() => setActiveNetwork(n)}
            className={cn(
              "px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors",
              activeNetwork === n
                ? "bg-amber-400 border-amber-400 text-black"
                : "border-gray-300 text-gray-600 hover:border-amber-400 hover:text-amber-600"
            )}
          >
            {n}
          </button>
        ))}
      </div>

      {/* Package cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {packages.map((pkg) => {
          const displayPrice = getDisplayPrice(pkg.price);
          return (
            <div key={pkg.size} className="bg-amber-400 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex justify-between items-start">
                <span className="text-black/70 text-xs font-semibold">{activeNetwork}</span>
                <span className="text-black/70 text-xs">Price</span>
              </div>
              <div className="flex justify-between items-end">
                <span className="text-black text-2xl font-black">{pkg.size}</span>
                <span className="text-black font-bold text-sm">GH₵ {displayPrice.toFixed(2)}</span>
              </div>
              <button
                onClick={() => openBuy(pkg)}
                className="w-full bg-amber-100 hover:bg-white text-black text-sm font-semibold py-1.5 rounded-lg transition-colors"
              >
                Buy
              </button>
            </div>
          );
        })}
      </div>

      {/* Buy Dialog */}
      {buyDialog.open && buyDialog.pkg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg text-gray-900">
                Buy {buyDialog.pkg.size} — {activeNetwork}
              </h2>
              <button onClick={() => setBuyDialog({ open: false })} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Price: <span className="font-semibold text-gray-900">GH₵ {getDisplayPrice(buyDialog.pkg.price).toFixed(2)}</span>
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer Phone Number</label>
            <div className="flex items-center border border-gray-300 rounded-lg px-3 py-2 gap-2 mb-4 focus-within:border-amber-400">
              <Phone className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                type="tel"
                placeholder="e.g. 0241234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="flex-1 outline-none text-sm"
                maxLength={10}
              />
            </div>
            <button
              onClick={handleBuy}
              disabled={loading || phone.length < 10}
              className="w-full bg-amber-400 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold py-2.5 rounded-xl transition-colors"
            >
              {loading ? "Processing..." : "Confirm Purchase"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
