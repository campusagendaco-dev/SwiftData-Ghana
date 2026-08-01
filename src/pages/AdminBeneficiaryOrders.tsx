import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Phone, ShieldAlert, Copy, Check, Users, Search, Calendar, RotateCcw, ListCheck, Play, Wallet, Loader2, Sparkles, ExternalLink, ArrowRight, Zap, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppTheme } from "@/contexts/ThemeContext";

interface BeneficiaryOrder {
  id: string;
  agent_id: string;
  customer_phone: string;
  network: string | null;
  package_size: string | null;
  amount: number;
  status: string;
  failure_reason: string | null;
  auto_refunded: boolean;
  metadata?: any;
  created_at: string;
  agent_email?: string;
  agent_name?: string;
}

interface GroupedBeneficiaryNumber {
  phone: string;
  network: string;
  totalAttempts: number;
  totalAmount: number;
  lastAttemptAt: string;
  latestStatus: string;
  orders: BeneficiaryOrder[];
  agentEmails: string[];
}

function fmt(dateStr: string) {
  const d = new Date(dateStr);
  return {
    date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit", hour12: true }),
  };
}

export default function AdminBeneficiaryOrders() {
  const { isDark } = useAppTheme();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [groupedNumbers, setGroupedNumbers] = useState<GroupedBeneficiaryNumber[]>([]);
  const [allBeneficiaryOrders, setAllBeneficiaryOrders] = useState<BeneficiaryOrder[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupedBeneficiaryNumber | null>(null);

  // Processing Action States
  const [processingBatch, setProcessingBatch] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchBeneficiaryOrders = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from("orders")
        .select("id, agent_id, customer_phone, network, package_size, amount, status, failure_reason, auto_refunded, metadata, created_at")
        .or("failure_reason.ilike.%beneficiary list%,failure_reason.ilike.%not added%")
        .order("created_at", { ascending: false })
        .limit(500);

      if (timeFilter === "today") {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        q = q.gte("created_at", todayStart.toISOString());
      } else if (timeFilter === "7days") {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        q = q.gte("created_at", d.toISOString());
      } else if (timeFilter === "30days") {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        q = q.gte("created_at", d.toISOString());
      }

      const { data: rawOrders, error } = await q;

      if (error) {
        console.error("Error fetching beneficiary orders:", error);
      } else if (rawOrders && rawOrders.length > 0) {
        const agentIds = Array.from(new Set(rawOrders.map((o) => o.agent_id).filter(Boolean)));
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", agentIds);

        const profileMap = new Map<string, { full_name?: string; email?: string }>();
        (profiles || []).forEach((p) => profileMap.set(p.user_id, p));

        const enriched: BeneficiaryOrder[] = rawOrders.map((o) => {
          const prof = profileMap.get(o.agent_id);
          return {
            ...o,
            customer_phone: o.customer_phone || "Unknown Phone",
            agent_email: prof?.email || "Unknown Agent",
            agent_name: prof?.full_name || prof?.email?.split("@")[0] || "Agent",
          };
        });

        setAllBeneficiaryOrders(enriched);

        // Group orders by customer_phone
        const groups = new Map<string, GroupedBeneficiaryNumber>();
        enriched.forEach((ord) => {
          const phone = ord.customer_phone;
          if (!groups.has(phone)) {
            groups.set(phone, {
              phone,
              network: ord.network || "MTN",
              totalAttempts: 0,
              totalAmount: 0,
              lastAttemptAt: ord.created_at,
              latestStatus: ord.status,
              orders: [],
              agentEmails: [],
            });
          }
          const grp = groups.get(phone)!;
          grp.totalAttempts += 1;
          grp.totalAmount += Number(ord.amount || 0);
          grp.orders.push(ord);
          if (ord.agent_email && !grp.agentEmails.includes(ord.agent_email)) {
            grp.agentEmails.push(ord.agent_email);
          }
        });

        setGroupedNumbers(Array.from(groups.values()));
      } else {
        setAllBeneficiaryOrders([]);
        setGroupedNumbers([]);
      }
    } catch (err) {
      console.error("Exception fetching beneficiary orders:", err);
    } finally {
      setLoading(false);
    }
  }, [timeFilter]);

  useEffect(() => {
    fetchBeneficiaryOrders();
  }, [fetchBeneficiaryOrders]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const copyAllNumbersCsv = () => {
    const numbersList = Array.from(new Set(groupedNumbers.map((g) => g.phone))).join("\n");
    copyToClipboard(numbersList, "csv_copied");
  };

  // RETRY SINGLE ORDER WITH BENEFICIARY CHECK FIRST
  const handleRetrySingle = async (ord: BeneficiaryOrder) => {
    setProcessingId(ord.id);
    try {
      // 1. Verify beneficiary status first
      const { data: vData } = await supabase.functions.invoke("verify-beneficiary", {
        body: { phone: ord.customer_phone, network: ord.network || "MTN" }
      });

      if (!vData?.exists) {
        toast({
          title: "Still Not Whitelisted",
          description: `${ord.customer_phone} is still not added to the carrier beneficiary list. Order remains safely refunded.`,
          variant: "destructive"
        });
        setProcessingId(null);
        return;
      }

      // 2. If verified, update order metadata to bypass_beneficiary = true & status = 'paid'
      await supabase.from("orders").update({
        status: "paid",
        auto_refunded: false,
        failure_reason: null,
        metadata: { ...(ord.metadata || {}), bypass_beneficiary: true }
      }).eq("id", ord.id);

      // Instantly remove from local list so it leaves the page immediately!
      setAllBeneficiaryOrders((prev) => prev.filter((o) => o.id !== ord.id));

      // 3. Invoke verify-payment Edge function
      const { data, error } = await supabase.functions.invoke("verify-payment", {
        body: { reference: ord.id, order_id: ord.id }
      });

      if (error) {
        toast({ title: "Retry failed", description: error.message || "Failed to contact provider", variant: "destructive" });
      } else {
        toast({
          title: "Order Re-submitted!",
          description: `Order ${ord.id.slice(0, 8)} status: ${data?.status || "processing"}`,
        });
      }
      await fetchBeneficiaryOrders();
    } catch (err: any) {
      toast({ title: "Retry exception", description: err.message || "Error retrying order", variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  };

  // REFUND SINGLE ORDER
  const handleRefundSingle = async (ord: BeneficiaryOrder) => {
    if (ord.status === "refunded" || ord.auto_refunded) {
      toast({ title: "Already Refunded", description: "This order has already been credited to wallet." });
      return;
    }

    if (!confirm(`Are you sure you want to refund GH₵ ${Number(ord.amount).toFixed(2)} to ${ord.agent_email}?`)) {
      return;
    }

    setProcessingId(ord.id);
    try {
      const { data, error } = await supabase.rpc("refund_failed_order", { p_order_id: ord.id });
      if (error) throw error;

      if (data) {
        toast({ title: "Order Refunded!", description: `GH₵ ${Number(ord.amount).toFixed(2)} returned to wallet.` });
      } else {
        toast({ title: "Refund Failed", description: "This order is not eligible for refund.", variant: "destructive" });
      }
      await fetchBeneficiaryOrders();
    } catch (err: any) {
      toast({ title: "Refund Error", description: err.message || "Could not execute refund", variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  };

  // BATCH RETRY ALL
  const handleRetryAllBeneficiary = async () => {
    const targetOrders = allBeneficiaryOrders.filter((o) => o.status !== "fulfilled" && o.status !== "completed");
    if (targetOrders.length === 0) {
      toast({ title: "No Orders to Retry", description: "There are no pending or failed beneficiary orders to retry." });
      return;
    }

    if (!confirm(`Are you sure you want to RE-SUBMIT all ${targetOrders.length} non-beneficiary orders with beneficiary bypass?`)) {
      return;
    }

    setProcessingBatch(true);
    toast({ title: "Batch Retrying Orders...", description: `Re-submitting ${targetOrders.length} orders in parallel batches...` });

    let successCount = 0;
    const BATCH_SIZE = 5;

    for (let i = 0; i < targetOrders.length; i += BATCH_SIZE) {
      const chunk = targetOrders.slice(i, i + BATCH_SIZE);

      await Promise.all(
        chunk.map(async (ord) => {
          try {
            await supabase.from("orders").update({
              status: "paid",
              auto_refunded: false,
              failure_reason: null,
              metadata: { ...(ord.metadata || {}), bypass_beneficiary: true }
            }).eq("id", ord.id);

            const { data } = await supabase.functions.invoke("verify-payment", {
              body: { reference: ord.id, order_id: ord.id }
            });
            if (data?.status === "fulfilled" || data?.status === "processing") {
              successCount++;
            }
          } catch {
            // continue batch
          }
        })
      );
    }

    toast({ title: "Batch Retry Complete", description: `Processed ${targetOrders.length} orders. ${successCount} successfully submitted.` });
    setProcessingBatch(false);
    await fetchBeneficiaryOrders();
  };

  // BATCH REFUND ALL
  const handleRefundAllBeneficiary = async () => {
    const unrefunded = allBeneficiaryOrders.filter((o) => !o.auto_refunded && o.status !== "refunded" && o.status !== "fulfilled");
    if (unrefunded.length === 0) {
      toast({ title: "All Orders Already Refunded", description: "Every non-beneficiary order is already refunded to agent wallets." });
      return;
    }

    const totalUnrefundedAmount = unrefunded.reduce((sum, o) => sum + Number(o.amount || 0), 0);

    if (!confirm(`Are you sure you want to REFUND all ${unrefunded.length} unrefunded orders totaling GH₵ ${totalUnrefundedAmount.toFixed(2)} to agent wallets?`)) {
      return;
    }

    setProcessingBatch(true);
    toast({ title: "Processing Batch Refunds...", description: `Refunding ${unrefunded.length} orders to agent wallets...` });

    let refundedCount = 0;
    let totalRefunded = 0;

    for (const ord of unrefunded) {
      try {
        const { data } = await supabase.rpc("refund_failed_order", { p_order_id: ord.id });
        if (data) {
          refundedCount++;
          totalRefunded += Number(ord.amount || 0);
        }
      } catch {
        // continue
      }
    }

    toast({
      title: "Batch Refund Complete!",
      description: `Refunded ${refundedCount} of ${unrefunded.length} orders totaling GH₵ ${totalRefunded.toFixed(2)}.`,
    });
    setProcessingBatch(false);
    await fetchBeneficiaryOrders();
  };

  const filteredGroups = groupedNumbers.filter((grp) => {
    if (statusFilter !== "all" && grp.latestStatus !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      grp.phone.toLowerCase().includes(q) ||
      grp.network.toLowerCase().includes(q) ||
      grp.agentEmails.some((e) => e.toLowerCase().includes(q)) ||
      grp.orders.some((o) => o.id.toLowerCase().includes(q))
    );
  });

  const totalUniqueNumbers = groupedNumbers.length;
  const totalAttempts = allBeneficiaryOrders.length;
  const totalVolume = allBeneficiaryOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0);
  const unrefundedCount = allBeneficiaryOrders.filter((o) => !o.auto_refunded && o.status !== "refunded" && o.status !== "fulfilled").length;

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl space-y-8 animate-in fade-in duration-300">
      {/* Premium Hero Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-purple-500/10 p-6 sm:p-8 border border-amber-500/20 backdrop-blur-xl shadow-xl">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-extrabold bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400">
              <Sparkles className="w-3.5 h-3.5" /> Carrier Whitelist Sentinel Active
            </div>
            <h1 className={cn("font-display text-2xl sm:text-4xl font-black tracking-tight flex items-center gap-3", isDark ? "text-white" : "text-gray-900")}>
              Non-Beneficiary Intelligence Hub
            </h1>
            <p className={cn("text-sm sm:text-base max-w-2xl leading-relaxed", isDark ? "text-white/70" : "text-gray-600")}>
              Real-time monitoring and 1-click batch whitelisting for numbers blocked by carrier beneficiary requirements.
            </p>
          </div>

          {/* Action Button Group */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="default"
              size="lg"
              className="gap-2.5 h-11 px-5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-950/20 transition-all active:scale-95"
              onClick={handleRetryAllBeneficiary}
              disabled={processingBatch || loading}
            >
              {processingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-white" />}
              Retry All ({allBeneficiaryOrders.length})
            </Button>

            <Button
              variant="default"
              size="lg"
              className="gap-2.5 h-11 px-5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold rounded-2xl shadow-lg shadow-purple-950/20 transition-all active:scale-95"
              onClick={handleRefundAllBeneficiary}
              disabled={processingBatch || loading || unrefundedCount === 0}
            >
              {processingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Refund All ({unrefundedCount})
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="gap-2 h-11 px-4 rounded-2xl border-amber-500/30 hover:bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold backdrop-blur-sm"
              onClick={copyAllNumbersCsv}
            >
              {copiedText === "csv_copied" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              {copiedText === "csv_copied" ? "Copied List!" : "Export Phone CSV"}
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="h-11 w-11 p-0 rounded-2xl border-white/10 hover:bg-white/10"
              onClick={fetchBeneficiaryOrders}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={cn("p-6 rounded-3xl border transition-all duration-300 hover:scale-[1.02]", isDark ? "bg-card/70 border-amber-500/20 shadow-xl shadow-amber-950/10" : "bg-white border-amber-100 shadow-md")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Unique Flagged</span>
            <div className="w-10 h-10 rounded-2xl bg-amber-500/15 flex items-center justify-center text-amber-500">
              <Phone className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-amber-600 dark:text-amber-400">
            {totalUniqueNumbers} Numbers
          </div>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span> Awaiting Carrier Whitelist
          </p>
        </div>

        <div className={cn("p-6 rounded-3xl border transition-all duration-300 hover:scale-[1.02]", isDark ? "bg-card/70 border-purple-500/20 shadow-xl shadow-purple-950/10" : "bg-white border-purple-100 shadow-md")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Order Attempts</span>
            <div className="w-10 h-10 rounded-2xl bg-purple-500/15 flex items-center justify-center text-purple-500">
              <Zap className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-purple-600 dark:text-purple-400">
            {totalAttempts} Attempts
          </div>
          <p className="text-xs text-muted-foreground mt-1">Total transactions impacted</p>
        </div>

        <div className={cn("p-6 rounded-3xl border transition-all duration-300 hover:scale-[1.02]", isDark ? "bg-card/70 border-emerald-500/20 shadow-xl shadow-emerald-950/10" : "bg-white border-emerald-100 shadow-md")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Volume</span>
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 flex items-center justify-center text-emerald-500">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-emerald-600 dark:text-emerald-400">
            GH₵ {totalVolume.toFixed(2)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Gross transaction value</p>
        </div>

        <div className={cn("p-6 rounded-3xl border transition-all duration-300 hover:scale-[1.02]", isDark ? "bg-card/70 border-blue-500/20 shadow-xl shadow-blue-950/10" : "bg-white border-blue-100 shadow-md")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Auto-Refund Health</span>
            <div className="w-10 h-10 rounded-2xl bg-blue-500/15 flex items-center justify-center text-blue-500">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-extrabold tracking-tight text-blue-600 dark:text-blue-400">
            100% Protected
          </div>
          <p className="text-xs text-muted-foreground mt-1">Zero agent balance loss guarantee</p>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-3xl bg-card/40 border border-border backdrop-blur-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by phone number, agent email, order reference..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-11 rounded-2xl text-sm bg-background/80 border-border"
          />
        </div>

        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-11 rounded-2xl text-xs font-semibold">
              <SelectValue placeholder="Filter Status" />
            </SelectTrigger>
            <SelectContent className="rounded-2xl">
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="refunded">Refunded</SelectItem>
              <SelectItem value="fulfillment_failed">Fulfillment Failed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={timeFilter} onValueChange={setTimeFilter}>
            <SelectTrigger className="w-40 h-11 rounded-2xl text-xs font-semibold">
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

      {/* Table Section */}
      <div className={cn("rounded-3xl border overflow-hidden transition-all backdrop-blur-xl shadow-xl", isDark ? "bg-card/70 border-border" : "bg-white border-gray-200")}>
        {loading ? (
          <div className="p-10 space-y-4">
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="p-16 text-center space-y-4">
            <div className="w-16 h-16 rounded-3xl bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto shadow-inner">
              <Phone className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold">No Flagged Numbers Found</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              All numbers in the system are currently whitelisted or no matching beneficiary errors occurred in the selected timeframe.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className={cn("border-b text-xs font-bold uppercase tracking-wider", isDark ? "bg-muted/40 border-border text-muted-foreground" : "bg-gray-50/80 border-gray-100 text-gray-500")}>
                  <th className="py-4 px-6">Recipient Number</th>
                  <th className="py-4 px-6">Carrier</th>
                  <th className="py-4 px-6">Attempts & Urgency</th>
                  <th className="py-4 px-6">Total Value</th>
                  <th className="py-4 px-6">Last Attempt</th>
                  <th className="py-4 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredGroups.map((grp) => {
                  const { date, time } = fmt(grp.lastAttemptAt);
                  const isHighPriority = grp.totalAttempts >= 3;
                  return (
                    <tr key={grp.phone} className={cn("transition-colors hover:bg-muted/30 group", isDark ? "" : "hover:bg-gray-50/80")}>
                      {/* Phone Number */}
                      <td className="py-4 px-6">
                        <div className="font-mono font-black text-base flex items-center gap-2.5">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                          {grp.phone}
                          <button onClick={() => copyToClipboard(grp.phone, grp.phone)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
                            {copiedText === grp.phone ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono truncate max-w-[240px] mt-0.5">
                          Agents: {grp.agentEmails.join(", ")}
                        </div>
                      </td>

                      {/* Network */}
                      <td className="py-4 px-6">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400">
                          {grp.network}
                        </span>
                      </td>

                      {/* Attempts */}
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-sm">{grp.totalAttempts} {grp.totalAttempts === 1 ? "attempt" : "attempts"}</span>
                          {isHighPriority && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-red-500/15 border border-red-500/30 text-red-600 dark:text-red-400 animate-pulse">
                              High Priority
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">Auto-logged for whitelist</div>
                      </td>

                      {/* Total Value */}
                      <td className="py-4 px-6">
                        <div className="font-black text-sm text-foreground">GH₵ {grp.totalAmount.toFixed(2)}</div>
                      </td>

                      {/* Last Attempt */}
                      <td className="py-4 px-6">
                        <div className="text-xs font-bold">{date}</div>
                        <div className="text-[11px] text-muted-foreground">{time}</div>
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-6 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 px-4 rounded-xl text-xs font-bold gap-2 border border-border/50 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400 transition-all"
                          onClick={() => setSelectedGroup(grp)}
                        >
                          View Orders ({grp.orders.length}) <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Orders Detail Dialog */}
      <Dialog open={!!selectedGroup} onOpenChange={(op) => !op && setSelectedGroup(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between text-xl font-black">
              <span className="flex items-center gap-2.5">
                <Phone className="w-6 h-6 text-amber-500" /> Orders for {selectedGroup?.phone}
              </span>
              <Button variant="outline" size="sm" className="text-xs h-9 rounded-xl gap-1.5 font-bold" onClick={() => selectedGroup && copyToClipboard(selectedGroup.phone, "modal_phone")}>
                {copiedText === "modal_phone" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                Copy Phone
              </Button>
            </DialogTitle>
          </DialogHeader>

          {selectedGroup && (
            <div className="space-y-4 pt-3">
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-200 font-medium leading-relaxed">
                Carrier Response: <strong>"{selectedGroup.phone} is not added to our beneficiary list"</strong>
              </div>

              <div className="space-y-3">
                {selectedGroup.orders.map((ord) => {
                  const { date, time } = fmt(ord.created_at);
                  const isBusy = processingId === ord.id;
                  return (
                    <div key={ord.id} className="p-4 rounded-2xl border border-border bg-card/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs transition-all hover:border-amber-500/30">
                      <div>
                        <div className="font-mono font-black text-sm text-foreground">{ord.id.slice(0, 8)} • {ord.package_size}</div>
                        <div className="text-muted-foreground font-mono mt-0.5">{ord.agent_email}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{date} at {time}</div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4">
                        <div className="text-right">
                          <div className="font-black text-base text-foreground">GH₵ {Number(ord.amount).toFixed(2)}</div>
                          <span className={cn("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold mt-1", ord.status === "refunded" ? "bg-purple-500/15 text-purple-600 dark:text-purple-400" : "bg-red-500/15 text-red-600 dark:text-red-400")}>
                            {ord.status.toUpperCase()}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-9 px-3 rounded-xl text-xs font-bold gap-1.5 hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                            onClick={() => handleRetrySingle(ord)}
                            disabled={isBusy || processingBatch}
                          >
                            {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                            Retry Order
                          </Button>

                          {ord.status !== "refunded" && !ord.auto_refunded && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 px-3 rounded-xl text-xs font-bold gap-1.5 hover:bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30"
                              onClick={() => handleRefundSingle(ord)}
                              disabled={isBusy || processingBatch}
                            >
                              {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                              Refund Order
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
