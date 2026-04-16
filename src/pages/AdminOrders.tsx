import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, RotateCcw, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";

interface OrderRow {
  id: string;
  order_type: string;
  network: string | null;
  package_size: string | null;
  customer_phone: string | null;
  amount: number;
  profit: number;
  status: string;
  failure_reason: string | null;
  created_at: string;
  agent_id: string;
}

const statusColors: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  paid: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  fulfilled: "bg-green-500/20 text-green-400 border-green-500/30",
  fulfillment_failed: "bg-red-500/20 text-red-400 border-red-500/30",
};

const AdminOrders = () => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);

  const fetchOrders = async () => {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .in("status", ["paid", "fulfilled", "fulfillment_failed"])
      .order("created_at", { ascending: false })
      .limit(2000);
    setOrders((data as OrderRow[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchOrders(); }, []);

  const verifyHeaders = () => {
    const anonKey = (supabase as any)?.supabaseKey as string | undefined;
    return anonKey ? { Authorization: `Bearer ${anonKey}` } : undefined;
  };

  const handleRetry = async (orderId: string) => {
    setRetrying(orderId);
    try {
      const { data, error } = await supabase.functions.invoke("verify-payment", {
        body: { reference: orderId },
        headers: verifyHeaders(),
      });

      if (error) {
        const description = await getFunctionErrorMessage(error, "Could not retry this order.");
        toast({ title: "Retry failed", description, variant: "destructive" });
      } else if (data?.status === "fulfilled") {
        toast({ title: "Order fulfilled successfully!" });
      } else {
        toast({
          title: "Retry completed",
          description: data?.failure_reason || `Status: ${data?.status}`,
          variant: data?.status === "fulfilled" ? "default" : "destructive",
        });
      }
      await fetchOrders();
    } catch {
      toast({ title: "Retry error", description: "Could not retry order.", variant: "destructive" });
    }
    setRetrying(null);
  };

  const filtered = orders.filter((o) =>
    [o.id, o.customer_phone, o.network, o.status, o.order_type, o.package_size]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(search.toLowerCase()))
  );

  const failed = orders.filter((o) => o.status === "fulfillment_failed").length;
  const pending = orders.filter((o) => o.status === "pending").length;
  const paid = orders.filter((o) => o.status === "paid").length;

  if (loading) return <div className="text-muted-foreground">Loading orders...</div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold">All Orders</h1>
          <div className="flex flex-wrap gap-3 mt-1 text-sm">
            {failed > 0 && (
              <span className="text-red-400">⚠ {failed} failed</span>
            )}
            {pending > 0 && (
              <span className="text-yellow-400">⏳ {pending} pending</span>
            )}
            {paid > 0 && (
              <span className="text-blue-400">💳 {paid} paid awaiting fulfillment</span>
            )}
            <span className="text-muted-foreground">{orders.length} total</span>
          </div>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search orders..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 bg-secondary" />
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-4 font-medium text-muted-foreground">Date</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Type</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Phone</th>
                <th className="text-left p-4 font-medium text-muted-foreground hidden sm:table-cell">Network</th>
                <th className="text-left p-4 font-medium text-muted-foreground hidden sm:table-cell">Package</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Amount</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Status</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => (
                <tr key={order.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="p-4 text-muted-foreground whitespace-nowrap">
                    {new Date(order.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-4 capitalize">{order.order_type}</td>
                  <td className="p-4">{order.customer_phone || "—"}</td>
                  <td className="p-4 hidden sm:table-cell">{order.network || "—"}</td>
                  <td className="p-4 hidden sm:table-cell">{order.package_size || "—"}</td>
                  <td className="p-4 font-medium whitespace-nowrap">GH₵{order.amount.toFixed(2)}</td>
                  <td className="p-4">
                    <Badge className={statusColors[order.status] || ""}>
                      {order.status.replace("_", " ")}
                    </Badge>
                    {order.failure_reason && (
                      <p className="text-xs text-red-400 mt-1 max-w-[150px] truncate" title={order.failure_reason}>
                        {order.failure_reason}
                      </p>
                    )}
                  </td>
                  <td className="p-4">
                    {(order.status === "fulfillment_failed" || order.status === "paid") && (
                      <Button
                        size="sm" variant="outline" className="text-xs gap-1.5"
                        disabled={retrying === order.id}
                        onClick={() => handleRetry(order.id)}
                      >
                        {retrying === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                        Retry
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-muted-foreground">No orders found.</div>
        )}
      </div>
    </div>
  );
};

export default AdminOrders;
