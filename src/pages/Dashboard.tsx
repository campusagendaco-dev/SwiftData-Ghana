import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { DollarSign, ShoppingCart, TrendingUp, Copy, ExternalLink, Store, Phone, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface Order {
  id: string;
  order_type: string;
  customer_phone: string | null;
  network: string | null;
  package_size: string | null;
  afa_full_name: string | null;
  amount: number;
  profit: number;
  status: string;
  created_at: string;
}

const Dashboard = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState({ totalSales: 0, ordersToday: 0, totalProfit: 0 });

  const storeUrl = profile?.slug
    ? `${window.location.origin}/store/${profile.slug}`
    : null;

  const copyLink = () => {
    if (storeUrl) {
      navigator.clipboard.writeText(storeUrl);
      toast({ title: "Store link copied!" });
    }
  };

  const computeStats = (data: Order[]) => {
    const today = new Date().toDateString();
    const paidOrders = data.filter((o) => ["paid", "fulfilled", "fulfillment_failed"].includes(o.status));
    const totalSales = paidOrders.reduce((sum, o) => sum + Number(o.amount), 0);
    const ordersToday = paidOrders.filter((o) => new Date(o.created_at).toDateString() === today).length;
    const totalProfit = paidOrders.reduce((sum, o) => sum + Number(o.profit), 0);
    setStats({ totalSales, ordersToday, totalProfit });
  };

  useEffect(() => {
    if (!user) return;

    const fetchOrders = async () => {
      const { data } = await supabase
        .from("orders")
        .select("*")
        .eq("agent_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (data) {
        setOrders(data);
        computeStats(data);
      }
    };
    fetchOrders();

    // Real-time subscription for agent's orders
    const channel = supabase
      .channel("agent-orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `agent_id=eq.${user.id}` },
        async () => {
          // Re-fetch on any change
          const { data } = await supabase
            .from("orders")
            .select("*")
            .eq("agent_id", user.id)
            .order("created_at", { ascending: false })
            .limit(20);
          if (data) {
            setOrders(data);
            computeStats(data);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const topupReference = (profile as any)?.topup_reference || "------";

  const copyReference = () => {
    navigator.clipboard.writeText(topupReference);
    toast({ title: "Topup Reference copied!" });
  };

  const statCards = [
    { label: "Total Sales", value: `GH₵ ${stats.totalSales.toFixed(2)}`, icon: DollarSign },
    { label: "Orders Today", value: String(stats.ordersToday), icon: ShoppingCart },
    { label: "Total Profit", value: `GH₵ ${stats.totalProfit.toFixed(2)}`, icon: TrendingUp },
  ];

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back, {profile?.full_name || "Agent"} 👋</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {storeUrl && (
            <Button variant="outline" size="sm" onClick={copyLink}>
              <Copy className="w-4 h-4 mr-1" /> Copy Link
            </Button>
          )}
          <Button size="sm" asChild>
            <a
              href={storeUrl || "/dashboard/settings"}
              target={storeUrl ? "_blank" : undefined}
              rel={storeUrl ? "noopener noreferrer" : undefined}
            >
              <Store className="w-4 h-4 mr-1" /> View My Store
            </a>
          </Button>
        </div>
      </div>

      {/* Store URL banner */}
      {storeUrl && (
        <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 mb-8 flex flex-col sm:flex-row sm:items-center gap-2">
          <span className="text-sm font-medium text-primary">Your store:</span>
          <code className="text-sm text-foreground bg-secondary px-3 py-1 rounded-lg break-all flex-1">{storeUrl}</code>
        </div>
      )}

      {/* Topup Reference */}
      <div className="bg-card border border-border rounded-xl p-5 mb-8 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 shrink-0">
          <Hash className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-display font-semibold text-sm">Your Topup Reference</h3>
          <p className="font-display text-2xl font-bold tracking-[0.3em] text-primary">{topupReference}</p>
          <p className="text-xs text-muted-foreground">Use this code when sending MoMo for wallet top-up</p>
        </div>
        <Button variant="outline" size="sm" onClick={copyReference}>
          <Copy className="w-4 h-4 mr-1" /> Copy
        </Button>
      </div>

      {/* USSD Coming Soon */}
      <div className="bg-card border border-border rounded-xl p-5 mb-8 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 shrink-0">
          <Phone className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-display font-semibold text-sm">USSD Ordering</h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent/10 text-accent-foreground">Coming Soon</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Customers will be able to buy data through your dedicated USSD shortcode — no internet needed. Orders will appear here automatically.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        {statCards.map((s) => (
          <div key={s.label} className="p-5 rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between mb-3">
              <s.icon className="w-5 h-5 text-primary" />
            </div>
            <p className="font-display text-xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Recent orders */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="font-display text-lg font-semibold mb-5">Recent Orders</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No orders yet. Orders will appear here when customers purchase from your store.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-3 px-2 font-medium">Type</th>
                  <th className="text-left py-3 px-2 font-medium">Customer</th>
                  <th className="text-left py-3 px-2 font-medium">Details</th>
                  <th className="text-left py-3 px-2 font-medium">Amount</th>
                  <th className="text-left py-3 px-2 font-medium">Profit</th>
                  <th className="text-left py-3 px-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                    <td className="py-3 px-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        o.order_type === "afa" ? "bg-accent/10 text-accent-foreground" : "bg-primary/10 text-primary"
                      }`}>
                        {o.order_type === "afa" ? "AFA" : "Data"}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-muted-foreground">
                      {o.order_type === "afa" ? o.afa_full_name : o.customer_phone}
                    </td>
                    <td className="py-3 px-2">
                      {o.order_type === "data" ? `${o.network} — ${o.package_size}` : "AFA Bundle"}
                    </td>
                    <td className="py-3 px-2 font-medium text-primary">GH₵ {Number(o.amount).toFixed(2)}</td>
                    <td className="py-3 px-2 font-medium text-primary">+GH₵ {Number(o.profit).toFixed(2)}</td>
                    <td className="py-3 px-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        o.status === "completed" ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent-foreground"
                      }`}>
                        {o.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
