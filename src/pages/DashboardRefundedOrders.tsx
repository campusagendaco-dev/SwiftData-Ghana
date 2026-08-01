import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, RotateCcw, Wallet, Search, Check, Copy, ShieldCheck, Play, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppTheme } from "@/contexts/ThemeContext";

interface RefundedOrder {
  id: string;
  order_type: string;
  customer_phone: string | null;
  network: string | null;
  package_size: string | null;
  amount: number;
  refund_amount: number | null;
  refund_reason: string | null;
  failure_reason: string | null;
  status: string;
  refunded_at: string | null;
  created_at: string;
  metadata?: any;
}

function fmt(dateStr: string) {
  const d = new Date(dateStr);
  return {
    date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit", hour12: true }),
  };
}

export default function DashboardRefundedOrders() {
  const { isDark } = useAppTheme();
  const { toast } = useToast();
  const [orders, setOrders] = useState<RefundedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const fetchRefundedOrders = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("orders")
        .select("id, order_type, customer_phone, network, package_size, amount, refund_amount, refund_reason, failure_reason, status, refunded_at, created_at, metadata")
        .eq("agent_id", user.id)
        .or("status.eq.refunded,auto_refunded.eq.true")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching refunded orders:", error);
      } else {
        setOrders(data || []);
      }
    } catch (err) {
      console.error("Fetch exception:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRefundedOrders();
  }, [fetchRefundedOrders]);

  // Real-time listener for live updates
  useEffect(() => {
    const channel = supabase
      .channel("user-refunds-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        (payload: any) => {
          const updated = payload.new;
          if (updated?.status === "refunded" || updated?.auto_refunded) {
            fetchRefundedOrders();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchRefundedOrders]);

  const copyOrderId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // VERIFY BENEFICIARY & RETRY IF ADDED TO BENEFICIARY LIST
  const handleVerifyAndRetry = async (ord: RefundedOrder) => {
    const phone = ord.customer_phone;
    if (!phone) {
      toast({ title: "No Phone Number", description: "This order does not have a recipient phone number.", variant: "destructive" });
      return;
    }

    setVerifyingId(ord.id);
    toast({ title: "Verifying Carrier Beneficiary Status...", description: `Checking if ${phone} has been added to the MTN beneficiary list...` });

    try {
      // 1. Call verify-beneficiary Edge function
      const { data: vData, error: vErr } = await supabase.functions.invoke("verify-beneficiary", {
        body: { phone, network: ord.network || "MTN" }
      });

      if (vErr) {
        toast({ title: "Verification Error", description: vErr.message || "Failed to check beneficiary status.", variant: "destructive" });
        setVerifyingId(null);
        return;
      }

      // If STILL not on beneficiary list
      if (!vData?.exists) {
        toast({
          title: "Still Not Added to Beneficiary List",
          description: `${phone} is not added to our beneficiary list yet. Order remains safely refunded in your wallet.`,
          variant: "destructive",
        });
        setVerifyingId(null);
        return;
      }

      // IF ADDED TO BENEFICIARY LIST: Proceed with Retry!
      toast({ title: "Number Verified!", description: `${phone} is verified on the beneficiary list! Re-submitting order...` });

      // Check current user wallet balance to ensure sufficient funds
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User session expired.");

      const { data: wallet } = await supabase.from("wallets").select("balance").eq("agent_id", user.id).maybeSingle();
      const currentBal = Number(wallet?.balance || 0);

      if (currentBal < ord.amount) {
        toast({
          title: "Insufficient Wallet Balance",
          description: `You need GH₵ ${ord.amount.toFixed(2)} to retry this order (Current Balance: GH₵ ${currentBal.toFixed(2)}).`,
          variant: "destructive",
        });
        setVerifyingId(null);
        return;
      }

      // Debit wallet for retry purchase
      const { data: debitRes, error: debitErr } = await supabase.rpc("debit_wallet", {
        p_agent_id: user.id,
        p_amount: ord.amount,
      });

      if (debitErr || !debitRes) {
        toast({ title: "Wallet Debit Failed", description: "Could not debit wallet balance for retry.", variant: "destructive" });
        setVerifyingId(null);
        return;
      }

      // Update order to status = 'paid', auto_refunded = false, failure_reason = null, bypass_beneficiary = true
      await supabase.from("orders").update({
        status: "paid",
        auto_refunded: false,
        failure_reason: null,
        metadata: { ...(ord.metadata || {}), bypass_beneficiary: true }
      }).eq("id", ord.id);

      // Invoke verify-payment for automated fulfillment
      const { data: payRes, error: payErr } = await supabase.functions.invoke("verify-payment", {
        body: { reference: ord.id, order_id: ord.id }
      });

      if (payErr) {
        toast({ title: "Fulfillment Error", description: payErr.message || "Failed to trigger fulfillment.", variant: "destructive" });
      } else {
        toast({
          title: "Order Re-submitted Successfully!",
          description: `Order ${ord.id.slice(0, 8)} for ${phone} is now ${payRes?.status || "processing"}.`,
        });
      }

      await fetchRefundedOrders();
    } catch (err: any) {
      console.error("Retry exception:", err);
      toast({ title: "Retry Error", description: err.message || "An error occurred while retrying.", variant: "destructive" });
    } finally {
      setVerifyingId(null);
    }
  };

  const filteredOrders = orders.filter((o) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      o.id.toLowerCase().includes(q) ||
      (o.customer_phone && o.customer_phone.toLowerCase().includes(q)) ||
      (o.network && o.network.toLowerCase().includes(q)) ||
      (o.package_size && o.package_size.toLowerCase().includes(q)) ||
      (o.failure_reason && o.failure_reason.toLowerCase().includes(q))
    );
  });

  const totalRefundedAmount = orders.reduce((sum, o) => sum + Number(o.refund_amount || o.amount || 0), 0);
  const totalRefundedCount = orders.length;

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className={cn("font-display text-2xl sm:text-3xl font-bold flex items-center gap-2.5", isDark ? "text-white" : "text-gray-900")}>
            <RotateCcw className="w-7 h-7 text-purple-500" /> My Refunded Orders
          </h1>
          <p className={cn("text-sm mt-1", isDark ? "text-muted-foreground" : "text-gray-600")}>
            Complete record of orders where funds were automatically returned to your wallet balance.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2 h-9 border-purple-500/30 hover:bg-purple-500/10 text-purple-600 dark:text-purple-400" onClick={fetchRefundedOrders} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh Refunds
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={cn("p-5 rounded-2xl border transition-all duration-200", isDark ? "bg-card/60 border-purple-500/20 shadow-lg shadow-purple-950/10" : "bg-white border-purple-100 shadow-sm")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Returned</span>
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-purple-600 dark:text-purple-400">
              GH₵ {totalRefundedAmount.toFixed(2)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">100% credited to your wallet balance</p>
        </div>

        <div className={cn("p-5 rounded-2xl border transition-all duration-200", isDark ? "bg-card/60 border-border shadow-lg" : "bg-white border-gray-200 shadow-sm")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Refunded Orders</span>
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
              <RotateCcw className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {totalRefundedCount}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Auto-refunded transactions</p>
        </div>

        <div className={cn("p-5 rounded-2xl border transition-all duration-200", isDark ? "bg-card/60 border-emerald-500/20 shadow-lg shadow-emerald-950/10" : "bg-white border-emerald-100 shadow-sm")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Guarantee</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              Instant Auto-Credit
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Zero financial risk on failed orders</p>
        </div>
      </div>

      {/* Search & Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search order ID, recipient phone, network..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 text-sm bg-background border-border"
          />
        </div>
      </div>

      {/* Table */}
      <div className={cn("rounded-2xl border overflow-hidden transition-all duration-200", isDark ? "bg-card/60 border-border" : "bg-white border-gray-200 shadow-sm")}>
        {loading ? (
          <div className="p-8 space-y-4">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-purple-500/10 text-purple-500 flex items-center justify-center mx-auto">
              <RotateCcw className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold">No Refunded Orders Found</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {search ? "No refunded orders match your search query." : "You do not have any auto-refunded orders in your transaction history."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className={cn("border-b text-xs font-semibold uppercase tracking-wider", isDark ? "bg-muted/30 border-border text-muted-foreground" : "bg-gray-50 border-gray-100 text-gray-500")}>
                  <th className="py-3.5 px-4">Order ID & Date</th>
                  <th className="py-3.5 px-4">Package / Network</th>
                  <th className="py-3.5 px-4">Recipient</th>
                  <th className="py-3.5 px-4">Refund Amount</th>
                  <th className="py-3.5 px-4">Status & Reason</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filteredOrders.map((o) => {
                  const { date, time } = fmt(o.refunded_at || o.created_at);
                  const amount = Number(o.refund_amount || o.amount || 0).toFixed(2);
                  const isVerifying = verifyingId === o.id;
                  const isBeneficiaryError = (o.failure_reason || "").toLowerCase().includes("beneficiary");

                  return (
                    <tr key={o.id} className={cn("transition-colors hover:bg-muted/20", isDark ? "" : "hover:bg-gray-50/80")}>
                      {/* ID & Date */}
                      <td className="py-3.5 px-4">
                        <div className="font-mono font-bold text-xs uppercase flex items-center gap-1.5">
                          {o.id.slice(0, 8)}
                          <button onClick={() => copyOrderId(o.id)} className="text-muted-foreground hover:text-foreground">
                            {copiedId === o.id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{date} at {time}</div>
                      </td>

                      {/* Service */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-xs">
                          {o.network || o.order_type.toUpperCase()}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{o.package_size || "Standard Package"}</div>
                      </td>

                      {/* Recipient */}
                      <td className="py-3.5 px-4">
                        <div className="font-mono font-medium text-xs">{o.customer_phone || "—"}</div>
                      </td>

                      {/* Amount */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-purple-600 dark:text-purple-400 text-sm">
                          +GH₵ {amount}
                        </div>
                        <div className="text-[10px] text-purple-500/80 font-medium">Returned to Wallet</div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/15 border border-purple-500/30 text-purple-600 dark:text-purple-400 mb-1">
                          <RotateCcw className="w-3 h-3" /> Refunded
                        </span>
                        <div className="text-[11px] text-muted-foreground truncate" title={o.failure_reason || o.refund_reason || "Auto-refund"}>
                          {o.failure_reason || o.refund_reason || "Fulfillment failed"}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs gap-1 hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                            onClick={() => handleVerifyAndRetry(o)}
                            disabled={isVerifying}
                            title={isBeneficiaryError ? "Check if recipient has been added to carrier beneficiary list and retry fulfillment" : "Verify and retry order fulfillment"}
                          >
                            {isVerifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                            {isBeneficiaryError ? "Check Beneficiary & Retry" : "Verify & Retry"}
                          </Button>

                          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={() => copyOrderId(o.id)}>
                            <Copy className="w-3.5 h-3.5" /> ID
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
