import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList, RefreshCw } from "lucide-react";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";

interface Order {
  id: string;
  order_type: string;
  customer_phone: string | null;
  network: string | null;
  package_size: string | null;
  amount: number;
  profit: number;
  status: string;
  created_at: string;
}

const statusColors: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  paid: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  fulfilled: "bg-green-500/10 text-green-600 border-green-500/20",
  fulfillment_failed: "bg-red-500/10 text-red-600 border-red-500/20",
};

const getDisplayStatus = (status: string) => {
  return status;
};

const DashboardOrders = () => {
  const { user, profile } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const candidateAgentIds = Array.from(new Set([
      user.id,
      profile?.user_id,
      profile?.id,
    ].filter(Boolean) as string[]));

    let query = supabase
      .from("orders")
      .select("*")
      .in("agent_id", candidateAgentIds)
      .in("status", ["paid", "processing", "fulfilled", "fulfillment_failed"])
      .order("created_at", { ascending: false })
      .limit(200);

    if (filter !== "all") {
      query = filter === "data"
        ? query.eq("order_type", filter)
        : query.eq("status", filter);
    }

    const { data } = await query;
    setOrders(data || []);
    setLoading(false);
  }, [filter, profile?.id, profile?.user_id, user]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const totals = orders.reduce(
    (acc, o) => ({
      amount: acc.amount + Number(o.amount),
      profit: acc.profit + Number(o.profit),
    }),
    { amount: 0, profit: 0 }
  );

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <div className="mb-6">
        <PhoneOrderTracker
          title="Order Status Tracker"
          subtitle="Track delivery status by customer phone number before reviewing your transaction list."
        />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold flex items-center gap-2">
            <ClipboardList className="w-7 h-7 text-primary" /> Transactions
          </h1>
          <p className="text-muted-foreground text-sm">View all wallet topups and data purchase transactions.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40 h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Orders</SelectItem>
              <SelectItem value="data">Data Only</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="fulfilled">Fulfilled</SelectItem>
              <SelectItem value="fulfillment_failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={fetchOrders} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold font-display">{orders.length}</p>
          <p className="text-xs text-muted-foreground">Transactions</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold font-display text-primary">GH₵ {totals.amount.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">Total Sales</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold font-display text-primary">GH₵ {totals.profit.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">Total Profit</p>
        </div>
      </div>

      {/* Orders table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            {loading ? "Loading orders..." : "No orders found."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50 text-muted-foreground">
                  <th className="text-left py-3 px-4 font-medium">Date</th>
                  <th className="text-left py-3 px-4 font-medium">Type</th>
                  <th className="text-left py-3 px-4 font-medium">Customer</th>
                  <th className="text-left py-3 px-4 font-medium">Details</th>
                  <th className="text-right py-3 px-4 font-medium">Amount</th>
                  <th className="text-right py-3 px-4 font-medium">Profit</th>
                  <th className="text-center py-3 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                      {new Date(o.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant="outline" className="text-xs">
                          {o.order_type === "wallet_topup" ? "Topup" : "Data"}
                      </Badge>
                    </td>
                      <td className="py-3 px-4">{o.customer_phone || "Wallet"}</td>
                    <td className="py-3 px-4 text-muted-foreground">
                        {o.order_type === "data" ? `${o.network} — ${o.package_size}` : "Wallet topup"}
                    </td>
                    <td className="py-3 px-4 text-right font-medium">GH₵ {Number(o.amount).toFixed(2)}</td>
                    <td className="py-3 px-4 text-right font-medium text-primary">+GH₵ {Number(o.profit).toFixed(2)}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusColors[getDisplayStatus(o.status)] || "bg-secondary text-foreground border-border"}`}>
                        {getDisplayStatus(o.status).replace("_", " ")}
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

export default DashboardOrders;
