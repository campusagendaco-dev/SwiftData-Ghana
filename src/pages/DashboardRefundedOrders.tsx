import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, RotateCcw, Wallet, Search, Check, Copy, ShieldCheck, Play, Loader2, Sparkles, CheckCircle2, Zap } from "lucide-react";
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

      // Instantly remove from local refunded list so it leaves the page immediately!
      setOrders((prev) => prev.filter((o) => o.id !== ord.id));

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
    <div className="p-4 sm:p-6 md:p-8 max-w-6xl space-y-8 animate-in fade-in duration-300">
      {/* Hero Banner Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-purple-600/15 via-indigo-500/10 to-blue-500/15 p-6 sm:p-8 border border-purple-500/20 backdrop-blur-xl shadow-xl">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-extrabold bg-purple-500/15 border border-purple-500/30 text-purple-600 dark:text-purple-300">
              <Sparkles className="w-3.5 h-3.5" /> Instant Wallet Protection Active
            </div>
            <h1 className={cn("font-display text-2xl sm:text-4xl font-black tracking-tight flex items-center gap-3", isDark ? "text-white" : "text-gray-900")}>
              My Refunded Orders
            </h1>
            <p className={cn("text-sm sm:text-base max-w-2xl leading-relaxed", isDark ? "text-white/70" : "text-gray-600")}>
              Complete record of orders where funds were automatically returned to your wallet balance.
            </p>
          </div>

          <Button
            variant="outline"
            size="lg"
            className="gap-2.5 h-11 px-5 rounded-2xl border-purple-500/30 hover:bg-purple-500/10 text-purple-600 dark:text-purple-300 font-bold backdrop-blur-sm shadow-md"
            onClick={fetchRefundedOrders}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh Refunds
          </Button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={cn("p-6 rounded-3xl border transition-all duration-300 hover:scale-[1.02]", isDark ? "bg-card/70 border-purple-500/20 shadow-xl shadow-purple-950/10" : "bg-white border-purple-100 shadow-md")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Returned</span>
            <div className="w-10 h-10 rounded-2xl bg-purple-500/15 flex items-center justify-center text-purple-500">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black tracking-tight text-purple-600 dark:text-purple-400">
              GH₵ {totalRefundedAmount.toFixed(2)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">100% credited to your wallet balance</p>
        </div>

        <div className={cn("p-6 rounded-3xl border transition-all duration-300 hover:scale-[1.02]", isDark ? "bg-card/70 border-blue-500/20 shadow-xl shadow-blue-950/10" : "bg-white border-blue-100 shadow-md")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Refunded Orders</span>
            <div className="w-10 h-10 rounded-2xl bg-blue-500/15 flex items-center justify-center text-blue-500">
              <RotateCcw className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-black tracking-tight text-blue-600 dark:text-blue-400">
              {totalRefundedCount} Orders
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Auto-refunded transactions</p>
        </div>

        <div className={cn("p-6 rounded-3xl border transition-all duration-300 hover:scale-[1.02]", isDark ? "bg-card/70 border-emerald-500/20 shadow-xl shadow-emerald-950/10" : "bg-white border-emerald-100 shadow-md")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Guarantee</span>
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 flex items-center justify-center text-emerald-500">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400">
              Instant Credit
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Zero financial risk on failed orders</p>
        </div>
      </div>

      {/* Search & Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-3xl bg-card/40 border border-border backdrop-blur-xl">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search order ID, recipient phone, network..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-11 rounded-2xl text-sm bg-background/80 border-border"
          />
        </div>
      </div>

      {/* Table Section */}
      <div className={cn("rounded-3xl border overflow-hidden transition-all backdrop-blur-xl shadow-xl", isDark ? "bg-card/70 border-border" : "bg-white border-gray-200")}>
        {loading ? (
          <div className="p-10 space-y-4">
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-16 text-center space-y-4">
            <div className="w-16 h-16 rounded-3xl bg-purple-500/10 text-purple-500 flex items-center justify-center mx-auto shadow-inner">
              <RotateCcw className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold">No Refunded Orders Found</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {search ? "No refunded orders match your search query." : "You do not have any auto-refunded orders in your transaction history."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className={cn("border-b text-xs font-bold uppercase tracking-wider", isDark ? "bg-muted/40 border-border text-muted-foreground" : "bg-gray-50/80 border-gray-100 text-gray-500")}>
                  <th className="py-4 px-6">Order ID & Date</th>
                  <th className="py-4 px-6">Package / Network</th>
                  <th className="py-4 px-6">Recipient Phone</th>
                  <th className="py-4 px-6">Refund Amount</th>
                  <th className="py-4 px-6">Status & Reason</th>
                  <th className="py-4 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredOrders.map((o) => {
                  const { date, time } = fmt(o.refunded_at || o.created_at);
                  const amount = Number(o.refund_amount || o.amount || 0).toFixed(2);
                  const isVerifying = verifyingId === o.id;
                  const isBeneficiaryError = (o.failure_reason || "").toLowerCase().includes("beneficiary");

                  return (
                    <tr key={o.id} className={cn("transition-colors hover:bg-muted/30 group", isDark ? "" : "hover:bg-gray-50/80")}>
                      {/* ID & Date */}
                      <td className="py-4 px-6">
                        <div className="font-mono font-black text-xs uppercase flex items-center gap-2 text-foreground">
                          {o.id.slice(0, 8)}
                          <button onClick={() => copyOrderId(o.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
                            {copiedId === o.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{date} at {time}</div>
                      </td>

                      {/* Service */}
                      <td className="py-4 px-6">
                        <div className="font-bold text-xs text-foreground">
                          {o.network || o.order_type.toUpperCase()}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-medium">{o.package_size || "Standard Package"}</div>
                      </td>

                      {/* Recipient */}
                      <td className="py-4 px-6">
                        <div className="font-mono font-bold text-xs text-foreground">{o.customer_phone || "—"}</div>
                      </td>

                      {/* Amount */}
                      <td className="py-4 px-6">
                        <div className="font-black text-purple-600 dark:text-purple-400 text-base">
                          +GH₵ {amount}
                        </div>
                        <div className="text-[10px] text-purple-500/90 font-bold">Returned to Wallet</div>
                      </td>

                      {/* Status */}
                      <td className="py-4 px-6 max-w-xs">
                        <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[10px] font-black bg-purple-500/15 border border-purple-500/30 text-purple-600 dark:text-purple-300 mb-1">
                          <RotateCcw className="w-3 h-3" /> Refunded
                        </span>
                        <div className="text-xs text-muted-foreground truncate" title={o.failure_reason || o.refund_reason || "Auto-refund"}>
                          {o.failure_reason || o.refund_reason || "Fulfillment failed"}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-9 px-3 rounded-xl text-xs font-bold gap-1.5 hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                            onClick={() => handleVerifyAndRetry(o)}
                            disabled={isVerifying}
                            title={isBeneficiaryError ? "Check if recipient has been added to carrier beneficiary list and retry fulfillment" : "Verify and retry order fulfillment"}
                          >
                            {isVerifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                            {isBeneficiaryError ? "Check Beneficiary & Retry" : "Verify & Retry"}
                          </Button>

                          <Button variant="ghost" size="sm" className="h-9 px-3 rounded-xl text-xs font-bold gap-1.5 border border-border/50 text-muted-foreground hover:text-foreground" onClick={() => copyOrderId(o.id)}>
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
