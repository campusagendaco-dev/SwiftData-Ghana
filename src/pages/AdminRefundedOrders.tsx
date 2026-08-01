import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, RotateCcw, Wallet, Search, Check, Copy, ShieldCheck, Users, Calendar, Eye, Play, Loader2, Sparkles, CheckCircle2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppTheme } from "@/contexts/ThemeContext";

interface AdminRefundedOrder {
  id: string;
  agent_id: string;
  order_type: string;
  customer_phone: string | null;
  network: string | null;
  package_size: string | null;
  amount: number;
  refund_amount: number | null;
  refund_reason: string | null;
  refunded_at: string | null;
  failure_reason: string | null;
  status: string;
  auto_refunded: boolean;
  payment_method: string | null;
  metadata?: any;
  created_at: string;
  agent_email?: string;
  agent_name?: string;
  store_name?: string;
}

function fmt(dateStr: string) {
  const d = new Date(dateStr);
  return {
    date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit", hour12: true }),
  };
}

export default function AdminRefundedOrders() {
  const { isDark } = useAppTheme();
  const { toast } = useToast();
  const [orders, setOrders] = useState<AdminRefundedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [orderTypeFilter, setOrderTypeFilter] = useState("all");
  const [networkFilter, setNetworkFilter] = useState("all");
  const [dateRangeFilter, setDateRangeFilter] = useState("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<AdminRefundedOrder | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const fetchRefundedOrders = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from("orders")
        .select("id, agent_id, order_type, customer_phone, network, package_size, amount, refund_amount, refund_reason, refunded_at, failure_reason, status, auto_refunded, payment_method, metadata, created_at")
        .or("status.eq.refunded,auto_refunded.eq.true")
        .order("created_at", { ascending: false })
        .limit(300);

      if (dateRangeFilter === "today") {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        q = q.gte("created_at", todayStart.toISOString());
      } else if (dateRangeFilter === "7days") {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        q = q.gte("created_at", d.toISOString());
      } else if (dateRangeFilter === "30days") {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        q = q.gte("created_at", d.toISOString());
      }

      const { data: rawOrders, error } = await q;

      if (error) {
        console.error("Error fetching admin refunded orders:", error);
      } else if (rawOrders && rawOrders.length > 0) {
        const agentIds = Array.from(new Set(rawOrders.map(o => o.agent_id).filter(Boolean)));
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name, email, store_name")
          .in("user_id", agentIds);

        const profileMap = new Map<string, { full_name?: string; email?: string; store_name?: string }>();
        (profiles || []).forEach(p => {
          profileMap.set(p.user_id, p);
        });

        const enriched = rawOrders.map(o => {
          const prof = profileMap.get(o.agent_id);
          return {
            ...o,
            agent_email: prof?.email || "Unknown User",
            agent_name: prof?.full_name || prof?.email?.split("@")[0] || "Agent",
            store_name: prof?.store_name || undefined,
          };
        });

        setOrders(enriched);
      } else {
        setOrders([]);
      }
    } catch (err) {
      console.error("Fetch exception:", err);
    } finally {
      setLoading(false);
    }
  }, [dateRangeFilter]);

  useEffect(() => {
    fetchRefundedOrders();
  }, [fetchRefundedOrders]);

  // Real-time subscription for live refunds
  useEffect(() => {
    const channel = supabase
      .channel("admin-refunds-live")
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

  // ADMIN VERIFY BENEFICIARY & RETRY
  const handleVerifyAndRetry = async (ord: AdminRefundedOrder) => {
    const phone = ord.customer_phone;
    if (!phone) {
      toast({ title: "No Phone Number", description: "This order does not have a recipient phone number.", variant: "destructive" });
      return;
    }

    setVerifyingId(ord.id);
    toast({ title: "Verifying Carrier Beneficiary Status...", description: `Checking if ${phone} is now on the beneficiary list...` });

    try {
      // 1. Check beneficiary status
      const { data: vData, error: vErr } = await supabase.functions.invoke("verify-beneficiary", {
        body: { phone, network: ord.network || "MTN" }
      });

      if (vErr) {
        toast({ title: "Verification Error", description: vErr.message || "Failed to check beneficiary status.", variant: "destructive" });
        setVerifyingId(null);
        return;
      }

      if (!vData?.exists) {
        toast({
          title: "Still Not Added to Beneficiary List",
          description: `${phone} is not added to our beneficiary list yet. Order remains safely refunded.`,
          variant: "destructive",
        });
        setVerifyingId(null);
        return;
      }

      toast({ title: "Number Verified!", description: `${phone} is verified on the beneficiary list! Re-submitting order for fulfillment...` });

      // Debit agent wallet for retry
      const { data: debitRes, error: debitErr } = await supabase.rpc("debit_wallet", {
        p_agent_id: ord.agent_id,
        p_amount: ord.amount,
      });

      if (debitErr || !debitRes) {
        toast({ title: "Debit Failed", description: "Could not debit agent wallet balance for retry.", variant: "destructive" });
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
    if (orderTypeFilter !== "all" && o.order_type !== orderTypeFilter) return false;
    if (networkFilter !== "all" && (o.network || "").toUpperCase() !== networkFilter.toUpperCase()) return false;

    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      o.id.toLowerCase().includes(q) ||
      (o.customer_phone && o.customer_phone.toLowerCase().includes(q)) ||
      (o.agent_email && o.agent_email.toLowerCase().includes(q)) ||
      (o.agent_name && o.agent_name.toLowerCase().includes(q)) ||
      (o.store_name && o.store_name.toLowerCase().includes(q)) ||
      (o.network && o.network.toLowerCase().includes(q)) ||
      (o.package_size && o.package_size.toLowerCase().includes(q)) ||
      (o.failure_reason && o.failure_reason.toLowerCase().includes(q))
    );
  });

  const totalRefundedAmount = orders.reduce((sum, o) => sum + Number(o.refund_amount || o.amount || 0), 0);
  const totalCount = orders.length;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayOrders = orders.filter(o => new Date(o.created_at) >= todayStart);
  const todayRefundedAmount = todayOrders.reduce((sum, o) => sum + Number(o.refund_amount || o.amount || 0), 0);

  const uniqueAgentsCount = new Set(orders.map(o => o.agent_id)).size;

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl space-y-6 sm:space-y-8 animate-in fade-in duration-300">
      {/* Premium Mobile-Optimized Hero Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-purple-600/15 via-indigo-500/10 to-blue-500/15 p-5 sm:p-8 border border-purple-500/20 backdrop-blur-xl shadow-xl">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1.5 sm:space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] sm:text-xs font-extrabold bg-purple-500/15 border border-purple-500/30 text-purple-600 dark:text-purple-300">
              <Sparkles className="w-3.5 h-3.5" /> Realtime Master Ledger
            </div>
            <h1 className={cn("font-display text-2xl sm:text-4xl font-black tracking-tight flex items-center gap-2.5", isDark ? "text-white" : "text-gray-900")}>
              Platform Refunded Orders
            </h1>
            <p className={cn("text-xs sm:text-base max-w-2xl leading-relaxed", isDark ? "text-white/70" : "text-gray-600")}>
              Complete real-time ledger of all auto-refunded and wallet-credited transactions across the platform.
            </p>
          </div>

          <Button
            variant="outline"
            size="lg"
            className="gap-2.5 h-11 px-5 rounded-2xl border-purple-500/30 hover:bg-purple-500/10 text-purple-600 dark:text-purple-300 font-bold backdrop-blur-sm shadow-md self-start sm:self-auto text-xs sm:text-sm"
            onClick={fetchRefundedOrders}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh Table
          </Button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className={cn("p-4 sm:p-6 rounded-2xl sm:rounded-3xl border transition-all duration-300", isDark ? "bg-card/70 border-purple-500/20 shadow-xl shadow-purple-950/10" : "bg-white border-purple-100 shadow-md")}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Refunded</span>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-purple-500/15 flex items-center justify-center text-purple-500">
              <Wallet className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 text-xl sm:text-3xl font-black tracking-tight text-purple-600 dark:text-purple-400">
            GH₵ {totalRefundedAmount.toFixed(2)}
          </div>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">{totalCount} transactions</p>
        </div>

        <div className={cn("p-4 sm:p-6 rounded-2xl sm:rounded-3xl border transition-all duration-300", isDark ? "bg-card/70 border-blue-500/20 shadow-xl shadow-blue-950/10" : "bg-white border-blue-100 shadow-md")}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-muted-foreground">Today's Refunds</span>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-blue-500/15 flex items-center justify-center text-blue-500">
              <Calendar className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 text-xl sm:text-3xl font-black tracking-tight text-blue-600 dark:text-blue-400">
            GH₵ {todayRefundedAmount.toFixed(2)}
          </div>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">{todayOrders.length} today</p>
        </div>

        <div className={cn("p-4 sm:p-6 rounded-2xl sm:rounded-3xl border transition-all duration-300", isDark ? "bg-card/70 border-amber-500/20 shadow-xl shadow-amber-950/10" : "bg-white border-amber-100 shadow-md")}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-muted-foreground">Unique Resellers</span>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-amber-500/15 flex items-center justify-center text-amber-500">
              <Users className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 text-xl sm:text-3xl font-black tracking-tight text-amber-600 dark:text-amber-400">
            {uniqueAgentsCount}
          </div>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">Reseller accounts</p>
        </div>

        <div className={cn("p-4 sm:p-6 rounded-2xl sm:rounded-3xl border transition-all duration-300", isDark ? "bg-card/70 border-emerald-500/20 shadow-xl shadow-emerald-950/10" : "bg-white border-emerald-100 shadow-md")}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-muted-foreground">Sentinel</span>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-emerald-500/15 flex items-center justify-center text-emerald-500">
              <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3 text-lg sm:text-2xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400">
            Active Guard
          </div>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">Wallet validation active</p>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl sm:rounded-3xl bg-card/40 border border-border backdrop-blur-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search order ID, phone, agent email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-10 sm:h-11 rounded-xl sm:rounded-2xl text-xs sm:text-sm bg-background/80 border-border"
          />
        </div>

        <div className="grid grid-cols-3 sm:flex items-center gap-2 sm:gap-3">
          <Select value={orderTypeFilter} onValueChange={setOrderTypeFilter}>
            <SelectTrigger className="w-full sm:w-36 h-10 sm:h-11 rounded-xl sm:rounded-2xl text-xs font-semibold">
              <SelectValue placeholder="Order Type" />
            </SelectTrigger>
            <SelectContent className="rounded-2xl">
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="data">Data</SelectItem>
              <SelectItem value="airtime">Airtime</SelectItem>
              <SelectItem value="utility">Utility</SelectItem>
              <SelectItem value="afa">AFA</SelectItem>
              <SelectItem value="api">API</SelectItem>
            </SelectContent>
          </Select>

          <Select value={networkFilter} onValueChange={setNetworkFilter}>
            <SelectTrigger className="w-full sm:w-32 h-10 sm:h-11 rounded-xl sm:rounded-2xl text-xs font-semibold">
              <SelectValue placeholder="Network" />
            </SelectTrigger>
            <SelectContent className="rounded-2xl">
              <SelectItem value="all">All Networks</SelectItem>
              <SelectItem value="MTN">MTN</SelectItem>
              <SelectItem value="Telecel">Telecel</SelectItem>
              <SelectItem value="AirtelTigo">AirtelTigo</SelectItem>
            </SelectContent>
          </Select>

          <Select value={dateRangeFilter} onValueChange={setDateRangeFilter}>
            <SelectTrigger className="w-full sm:w-36 h-10 sm:h-11 rounded-xl sm:rounded-2xl text-xs font-semibold">
              <SelectValue placeholder="Timeframe" />
            </SelectTrigger>
            <SelectContent className="rounded-2xl">
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today Only</SelectItem>
              <SelectItem value="7days">Last 7 Days</SelectItem>
              <SelectItem value="30days">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Responsive View: Desktop Table vs Mobile Cards */}
      <div className={cn("rounded-2xl sm:rounded-3xl border overflow-hidden transition-all backdrop-blur-xl shadow-xl", isDark ? "bg-card/70 border-border" : "bg-white border-gray-200")}>
        {loading ? (
          <div className="p-8 sm:p-10 space-y-4">
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 sm:p-16 text-center space-y-4">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-3xl bg-purple-500/10 text-purple-500 flex items-center justify-center mx-auto shadow-inner">
              <RotateCcw className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>
            <h3 className="text-base sm:text-lg font-bold">No Refunded Orders Match</h3>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto">
              {search || orderTypeFilter !== "all" || networkFilter !== "all" ? "No records matched your search filters." : "No refunded orders found in the selected timeframe."}
            </p>
          </div>
        ) : (
          <>
            {/* DESKTOP TABLE VIEW */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className={cn("border-b text-xs font-bold uppercase tracking-wider", isDark ? "bg-muted/40 border-border text-muted-foreground" : "bg-gray-50/80 border-gray-100 text-gray-500")}>
                    <th className="py-4 px-6">Order & Date</th>
                    <th className="py-4 px-6">Agent / Reseller</th>
                    <th className="py-4 px-6">Service & Phone</th>
                    <th className="py-4 px-6">Amount Refunded</th>
                    <th className="py-4 px-6">Status & Reason</th>
                    <th className="py-4 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredOrders.map((o) => {
                    const { date, time } = fmt(o.refunded_at || o.created_at);
                    const amount = Number(o.refund_amount || o.amount || 0).toFixed(2);
                    const isVerifying = verifyingId === o.id;

                    return (
                      <tr key={o.id} className={cn("transition-colors hover:bg-muted/30 group", isDark ? "" : "hover:bg-gray-50/80")}>
                        <td className="py-4 px-6">
                          <div className="font-mono font-black text-xs uppercase flex items-center gap-2 text-foreground">
                            {o.id.slice(0, 8)}
                            <button onClick={() => copyOrderId(o.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
                              {copiedId === o.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">{date} at {time}</div>
                        </td>

                        <td className="py-4 px-6">
                          <div className="font-bold text-xs text-foreground">{o.agent_name}</div>
                          <div className="text-[11px] text-muted-foreground font-mono truncate max-w-[180px]">{o.agent_email}</div>
                          {o.store_name && <div className="text-[10px] text-purple-500 font-extrabold mt-0.5">Store: {o.store_name}</div>}
                        </td>

                        <td className="py-4 px-6">
                          <div className="font-bold text-xs text-foreground">
                            {o.network || o.order_type.toUpperCase()} — {o.package_size || "Standard"}
                          </div>
                          <div className="text-[11px] font-mono text-muted-foreground">{o.customer_phone || "—"}</div>
                        </td>

                        <td className="py-4 px-6">
                          <div className="font-black text-purple-600 dark:text-purple-400 text-base">
                            +GH₵ {amount}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-medium">Returned to Wallet</div>
                        </td>

                        <td className="py-4 px-6 max-w-xs">
                          <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[10px] font-black bg-purple-500/15 border border-purple-500/30 text-purple-600 dark:text-purple-300 mb-1">
                            <RotateCcw className="w-3 h-3" /> Refunded
                          </span>
                          <div className="text-xs text-muted-foreground truncate" title={o.failure_reason || o.refund_reason || "Auto-refund"}>
                            {o.failure_reason || o.refund_reason || "Fulfillment failed"}
                          </div>
                        </td>

                        <td className="py-4 px-6 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 px-3 rounded-xl text-xs font-bold gap-1.5 hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                              onClick={() => handleVerifyAndRetry(o)}
                              disabled={isVerifying}
                            >
                              {isVerifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                              Verify & Retry
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 px-3 rounded-xl text-xs font-bold gap-1.5 border border-border/50"
                              onClick={() => setSelectedOrder(o)}
                            >
                              <Eye className="w-3.5 h-3.5" /> Details
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* MOBILE CARDS VIEW */}
            <div className="block md:hidden divide-y divide-border/40">
              {filteredOrders.map((o) => {
                const { date, time } = fmt(o.refunded_at || o.created_at);
                const amount = Number(o.refund_amount || o.amount || 0).toFixed(2);
                const isVerifying = verifyingId === o.id;

                return (
                  <div key={o.id} className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="font-mono font-black text-xs uppercase flex items-center gap-1.5">
                        {o.id.slice(0, 8)}
                        <button onClick={() => copyOrderId(o.id)} className="text-muted-foreground">
                          {copiedId === o.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-purple-500/15 border border-purple-500/30 text-purple-600 dark:text-purple-300">
                        <RotateCcw className="w-3 h-3" /> Refunded
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1">
                      <div>
                        <div className="font-bold text-foreground">{o.agent_name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground truncate max-w-[180px]">{o.agent_email}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-black text-base text-purple-600 dark:text-purple-400">+GH₵ {amount}</div>
                        <div className="text-[10px] text-muted-foreground">Wallet Credited</div>
                      </div>
                    </div>

                    <div className="text-xs bg-muted/30 p-2.5 rounded-xl space-y-1">
                      <div className="font-semibold text-foreground">{o.network} {o.package_size} • <span className="font-mono">{o.customer_phone || "—"}</span></div>
                      <div className="text-[11px] text-muted-foreground truncate" title={o.failure_reason || o.refund_reason || "Auto-refund"}>
                        Reason: {o.failure_reason || o.refund_reason || "Fulfillment failed"}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 gap-2">
                      <span className="text-[10px] text-muted-foreground">{date} at {time}</span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="default"
                          size="sm"
                          className="h-8.5 px-3 rounded-xl text-xs font-bold gap-1 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md"
                          onClick={() => handleVerifyAndRetry(o)}
                          disabled={isVerifying}
                        >
                          {isVerifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          Verify & Retry
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8.5 px-2.5 rounded-xl text-xs font-bold border-border/60"
                          onClick={() => setSelectedOrder(o)}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Order Details Modal */}
      <Dialog open={!!selectedOrder} onOpenChange={(op) => !op && setSelectedOrder(null)}>
        <DialogContent className="max-w-lg rounded-3xl p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-lg sm:text-xl font-black">
              <RotateCcw className="w-6 h-6 text-purple-500" /> Refunded Order Details
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Complete audit log and metadata for refunded transaction.
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4 text-sm pt-2">
              <div className="grid grid-cols-2 gap-3.5 p-4 rounded-2xl bg-muted/40 border border-border text-xs">
                <div>
                  <div className="text-muted-foreground uppercase font-bold text-[10px]">Order ID</div>
                  <div className="font-mono font-black mt-0.5">{selectedOrder.id}</div>
                </div>
                <div>
                  <div className="text-muted-foreground uppercase font-bold text-[10px]">Refund Amount</div>
                  <div className="font-black text-purple-600 dark:text-purple-400 text-sm sm:text-base mt-0.5">GH₵ {Number(selectedOrder.refund_amount || selectedOrder.amount).toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground uppercase font-bold text-[10px]">Agent Email</div>
                  <div className="font-mono font-medium truncate mt-0.5">{selectedOrder.agent_email}</div>
                </div>
                <div>
                  <div className="text-muted-foreground uppercase font-bold text-[10px]">Recipient Phone</div>
                  <div className="font-mono font-black mt-0.5">{selectedOrder.customer_phone || "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground uppercase font-bold text-[10px]">Network & Package</div>
                  <div className="font-extrabold mt-0.5">{selectedOrder.network} {selectedOrder.package_size}</div>
                </div>
                <div>
                  <div className="text-muted-foreground uppercase font-bold text-[10px]">Payment Method</div>
                  <div className="font-black uppercase text-purple-600 dark:text-purple-400 mt-0.5">{selectedOrder.payment_method || "wallet"}</div>
                </div>
              </div>

              <div className="space-y-2 p-3.5 sm:p-4 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-800 dark:text-purple-200">
                <div className="text-xs font-black flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-purple-500" /> Failure & Refund Audit Log
                </div>
                <p className="text-xs font-mono break-words leading-relaxed">
                  {selectedOrder.failure_reason || selectedOrder.refund_reason || "Auto-refund executed."}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" className="rounded-xl font-bold text-xs" onClick={() => copyOrderId(selectedOrder.id)}>
                  <Copy className="w-3.5 h-3.5 mr-1" /> Copy ID
                </Button>
                <Button variant="default" size="sm" className="rounded-xl font-bold text-xs" onClick={() => setSelectedOrder(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
