import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search, CheckCircle, Loader2, XCircle, Copy, Download,
  RefreshCw, ChevronLeft, ChevronRight, Wallet, TrendingUp,
  AlertCircle, Banknote, CheckSquare, Square, Clock, Settings2, Save,
  ShieldCheck, ArrowUpRight, Filter, DollarSign, CheckCircle2
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/utils/auditLogger";
import { CardTilt } from "@/components/ui/CardTilt";
import { cn } from "@/lib/utils";

interface WithdrawalRow {
  id: string;
  agent_id: string;
  amount: number;
  status: string;
  failure_reason: string | null;
  created_at: string;
  agent_name?: string;
  agent_email?: string;
  momo_number?: string;
  momo_network?: string;
  momo_account_name?: string;
  total_profit?: number;
  fee: number;
  net_amount: number;
  paystack_transfer_reference?: string;
}

const PAGE_SIZE = 50;

const statusColors: Record<string, string> = {
  completed:  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending:    "bg-amber-500/15 text-amber-400 border-amber-500/30",
  processing: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  failed:     "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

const STATUS_TABS = ["all", "pending", "processing", "completed", "failed"] as const;
const NETWORKS    = ["all", "MTN", "Telecel", "AirtelTigo"] as const;

function networkMatch(net: string | undefined, filter: string) {
  if (filter === "all") return true;
  const n = (net || "").toUpperCase();
  if (filter === "MTN")       return n.includes("MTN");
  if (filter === "Telecel")   return n.includes("TELECEL") || n.includes("VODAFONE") || n.includes("VDF");
  if (filter === "AirtelTigo") return n.includes("AIRTEL") || n.includes("TIGO") || n.includes("ATL") || n === "AT";
  return true;
}

function classifyNetwork(net: string | undefined) {
  const n = (net || "").toUpperCase();
  if (n.includes("MTN")) return "MTN";
  if (n.includes("TELECEL") || n.includes("VODAFONE") || n.includes("VDF")) return "Telecel";
  if (n.includes("AIRTEL") || n.includes("TIGO") || n.includes("ATL")) return "AirtelTigo";
  return "Other";
}

function exportCsv(rows: WithdrawalRow[]) {
  if (!rows.length) return;
  const headers = ["Date", "Time", "Agent", "Email", "Amount", "Fee", "Net Amount", "MoMo Account", "MoMo Number", "Network", "Status", "Total Profit", "Failure Reason"];
  const csv = [
    headers.join(","),
    ...rows.map(r => [
      new Date(r.created_at).toLocaleDateString(),
      new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      r.agent_name || "",
      r.agent_email || "",
      r.amount.toFixed(2),
      (r.fee || 0).toFixed(2),
      (r.net_amount || r.amount).toFixed(2),
      r.momo_account_name || "",
      r.momo_number || "",
      r.momo_network || "",
      r.status,
      (r.total_profit || 0).toFixed(2),
      r.failure_reason || "",
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: `withdrawals_${new Date().toISOString().slice(0, 10)}.csv` }).click();
  URL.revokeObjectURL(url);
}

const AdminWithdrawals = () => {
  const { user: currentUser, session } = useAuth();

  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search,        setSearch]        = useState("");
  const [statusFilter,  setStatusFilter]  = useState<string>("all");
  const [networkFilter, setNetworkFilter] = useState<string>("all");
  const [dateFrom,      setDateFrom]      = useState("");
  const [dateTo,        setDateTo]        = useState("");

  // Pagination
  const [page, setPage] = useState(0);

  // Per-row actions
  const [confirming,    setConfirming]    = useState<string | null>(null);
  const [payingPaystack, setPayingPaystack] = useState<string | null>(null);
  const [rejectingId,   setRejectingId]   = useState<string | null>(null);
  const [rejectReason,  setRejectReason]  = useState("");
  const [rejecting,     setRejecting]     = useState(false);

  // Bulk
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());
  const [bulkConfirming, setBulkConfirming] = useState(false);

  // Withdrawal settings
  const [showSettings,   setShowSettings]   = useState(false);
  const [minAmount,      setMinAmount]      = useState("25");
  const [maxAmount,      setMaxAmount]      = useState("5000");
  const [savingSettings, setSavingSettings] = useState(false);

  const fetchSettings = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("system_settings")
      .select("min_withdrawal_amount, max_withdrawal_amount")
      .eq("id", 1)
      .maybeSingle();
    if (data) {
      setMinAmount(String(data.min_withdrawal_amount ?? 25));
      setMaxAmount(String(data.max_withdrawal_amount ?? 5000));
    }
  }, []);

  const saveSettings = async () => {
    const min = parseFloat(minAmount);
    const max = parseFloat(maxAmount);
    if (isNaN(min) || min < 1) { toast.error("Invalid minimum amount"); return; }
    if (isNaN(max) || max < min) { toast.error("Maximum must be greater than minimum"); return; }
    setSavingSettings(true);
    const { error } = await (supabase as any)
      .from("system_settings")
      .update({ min_withdrawal_amount: min, max_withdrawal_amount: max })
      .eq("id", 1);
    if (error) {
      toast.error("Failed to save", { description: error.message });
    } else {
      toast.success("Withdrawal limits updated", { description: `Min: GHS ${min.toFixed(2)} · Max: GHS ${max.toFixed(2)}` });
    }
    setSavingSettings(false);
  };

  const fetchWithdrawals = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);

    const { data } = await supabase
      .from("withdrawals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    const rows = (data || []) as unknown as WithdrawalRow[];

    const agentIds = [...new Set(rows.map(r => r.agent_id))];
    if (agentIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, momo_number, momo_network, momo_account_name")
        .in("user_id", agentIds);

      const { data: orders } = await supabase
        .from("orders")
        .select("agent_id, profit, status")
        .in("agent_id", agentIds)
        .in("status", ["paid", "fulfilled", "fulfillment_failed"]);

      const profitMap = new Map<string, number>();
      (orders || []).forEach((o: any) => {
        profitMap.set(o.agent_id, (profitMap.get(o.agent_id) || 0) + (o.profit || 0));
      });

      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
      rows.forEach(r => {
        const p = profileMap.get(r.agent_id) as any;
        if (p) {
          r.agent_name       = p.full_name;
          r.agent_email      = p.email;
          r.momo_number      = p.momo_number;
          r.momo_network     = p.momo_network;
          r.momo_account_name = p.momo_account_name;
        }
        r.total_profit = profitMap.get(r.agent_id) || 0;
      });
    }

    setWithdrawals(rows);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchWithdrawals(); fetchSettings(); }, [fetchWithdrawals, fetchSettings]);

  useEffect(() => { setPage(0); }, [search, statusFilter, networkFilter, dateFrom, dateTo]);
  useEffect(() => { setSelectedIds(new Set()); }, [statusFilter]);

  const stats = useMemo(() => {
    const pending   = withdrawals.filter(w => w.status === "pending");
    const completed = withdrawals.filter(w => w.status === "completed");

    const networkTotals: Record<string, number> = {};
    pending.forEach(w => {
      const key = classifyNetwork(w.momo_network);
      networkTotals[key] = (networkTotals[key] || 0) + w.amount;
    });

    return {
      pendingCount:  pending.length,
      pendingAmount: pending.reduce((s, w) => s + w.amount, 0),
      totalPaid:     completed.reduce((s, w) => s + (w.net_amount || w.amount), 0),
      totalFees:     completed.reduce((s, w) => s + (w.fee || 0), 0),
      avgAmount:     withdrawals.length
        ? withdrawals.reduce((s, w) => s + w.amount, 0) / withdrawals.length
        : 0,
      networkTotals,
    };
  }, [withdrawals]);

  const filtered = useMemo(() => {
    let rows = withdrawals;
    if (statusFilter !== "all")  rows = rows.filter(w => w.status === statusFilter);
    if (networkFilter !== "all") rows = rows.filter(w => networkMatch(w.momo_network, networkFilter));
    if (dateFrom) rows = rows.filter(w => new Date(w.created_at) >= new Date(dateFrom));
    if (dateTo)   rows = rows.filter(w => new Date(w.created_at) <= new Date(dateTo + "T23:59:59"));
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(w =>
        [w.id, w.agent_name, w.agent_email, w.status, w.momo_number, w.momo_account_name]
          .filter(Boolean)
          .some(v => v!.toLowerCase().includes(q))
      );
    }
    return rows;
  }, [withdrawals, statusFilter, networkFilter, dateFrom, dateTo, search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const pendingInView      = filtered.filter(w => w.status === "pending");
  const allPendingSelected = pendingInView.length > 0 && pendingInView.every(w => selectedIds.has(w.id));

  const toggleSelectAll = () => {
    if (allPendingSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(pendingInView.map(w => w.id)));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleConfirm = async (withdrawalId: string) => {
    setConfirming(withdrawalId);
    const withdrawal = withdrawals.find(w => w.id === withdrawalId);

    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "confirm_withdrawal", withdrawal_id: withdrawalId },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    if (error || data?.error) {
      toast.error("Failed to confirm", { description: data?.error || error?.message || "Unknown error" });
    } else {
      if (currentUser && withdrawal) {
        await logAudit(currentUser.id, "confirm_withdrawal", {
          withdrawal_id: withdrawalId,
          agent_id: withdrawal.agent_id,
          agent_name: withdrawal.agent_name,
          amount: withdrawal.amount,
        });
      }
      toast.success("Withdrawal confirmed as sent!");
      setSelectedIds(prev => { const n = new Set(prev); n.delete(withdrawalId); return n; });
      await fetchWithdrawals(true);
    }
    setConfirming(null);
  };

  const handlePaystackPayout = async (withdrawalId: string) => {
    if (!window.confirm("Initiate a REAL transfer via Paystack?")) return;
    setPayingPaystack(withdrawalId);
    const withdrawal = withdrawals.find(w => w.id === withdrawalId);

    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "paystack_payout", withdrawal_id: withdrawalId },
    });

    let errorMessage = data?.error || error?.message || "Transfer could not be initiated.";
    if (error && (error as any).context && typeof (error as any).context.json === 'function') {
      try {
        const errorBody = await (error as any).context.json();
        if (errorBody?.error) errorMessage = errorBody.error;
      } catch (e) {
        // ignore
      }
    }

    if (error || data?.error) {
      toast.error("Payout Failed", { description: errorMessage });
    } else {
      toast.success("Payout Successful!", { description: `Ref: ${data?.transfer_reference || "N/A"}` });
      if (currentUser && withdrawal) {
        await logAudit(currentUser.id, "paystack_payout", {
          withdrawal_id: withdrawalId,
          agent_id: withdrawal.agent_id,
          amount: withdrawal.amount,
          reference: data?.transfer_reference,
        });
      }
      await fetchWithdrawals(true);
    }
    setPayingPaystack(null);
  };

  const handleReject = async (withdrawalId: string) => {
    if (!rejectReason.trim()) {
      toast.error("Enter a reason for rejection");
      return;
    }
    setRejecting(true);

    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "reject_withdrawal", withdrawal_id: withdrawalId, reason: rejectReason.trim() },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    if (error || data?.error) {
      toast.error("Failed to reject", { description: data?.error || error?.message });
    } else {
      const withdrawal = withdrawals.find(w => w.id === withdrawalId);
      if (currentUser && withdrawal) {
        await logAudit(currentUser.id, "reject_withdrawal", {
          withdrawal_id: withdrawalId,
          agent_id: withdrawal.agent_id,
          reason: rejectReason.trim(),
        });
      }
      toast.success("Withdrawal rejected");
      setRejectingId(null);
      setRejectReason("");
      await fetchWithdrawals(true);
    }
    setRejecting(false);
  };

  const handleBulkConfirm = async () => {
    if (!selectedIds.size) return;
    if (!window.confirm(`Confirm ${selectedIds.size} withdrawal(s) as sent?`)) return;
    setBulkConfirming(true);

    let success = 0, failed = 0;
    for (const id of selectedIds) {
      const { data, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "confirm_withdrawal", withdrawal_id: id },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || data?.error) failed++; else success++;
    }

    toast.info(`Bulk confirm: ${success} confirmed${failed ? `, ${failed} failed` : ""}`);
    setSelectedIds(new Set());
    setBulkConfirming(false);
    await fetchWithdrawals(true);
  };

  const copyMomo = (number: string) => {
    navigator.clipboard.writeText(number).then(() => toast.success("MoMo number copied"));
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[350px] gap-3">
      <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
      <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest animate-pulse">Loading Withdrawal Management Center...</p>
    </div>
  );

  return (
    <div className="space-y-6 pb-12">
      {/* ── Header ── */}
      <div className="glass-card-neo p-5 sm:p-6 rounded-3xl border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
              <Banknote className="w-3.5 h-3.5" /> Payout Management
            </span>
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px] font-mono uppercase">
              {stats.pendingCount} Pending Requests
            </Badge>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">Agent Withdrawal Requests</h1>
        </div>

        <Button
          onClick={() => fetchWithdrawals(true)}
          disabled={refreshing}
          variant="outline"
          className="h-10 px-5 rounded-xl border-border bg-background/80 font-bold text-xs uppercase tracking-wider gap-2 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* ── Withdrawal Limits Settings ── */}
      <div className="glass-card-neo rounded-3xl border border-white/10 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowSettings(s => !s)}
          className="w-full flex items-center justify-between p-5 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Settings2 className="w-4 h-4" />
            </div>
            <div className="text-left">
              <span className="text-sm font-black text-foreground block">Withdrawal Threshold Limits</span>
              <span className="text-xs text-muted-foreground font-mono">
                Min: GH₵ {parseFloat(minAmount || "25").toFixed(2)} · Max: GH₵ {parseFloat(maxAmount || "5000").toFixed(2)}
              </span>
            </div>
          </div>
          <span className="text-xs font-bold text-muted-foreground">{showSettings ? "▲ Hide Config" : "▼ Edit Limits"}</span>
        </button>
        {showSettings && (
          <div className="p-5 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-4 items-end bg-background/50">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Min Withdrawal (GH₵)</label>
              <Input
                type="number" min="1" step="1"
                value={minAmount}
                onChange={e => setMinAmount(e.target.value)}
                className="bg-background border-border font-mono font-bold"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Max Withdrawal (GH₵)</label>
              <Input
                type="number" min="1" step="1"
                value={maxAmount}
                onChange={e => setMaxAmount(e.target.value)}
                className="bg-background border-border font-mono font-bold"
              />
            </div>
            <Button onClick={saveSettings} disabled={savingSettings} className="h-10 rounded-xl bg-amber-500 text-slate-950 font-black text-xs gap-2">
              {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Limits
            </Button>
          </div>
        )}
      </div>

      {/* ── Stats cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CardTilt className="rounded-2xl w-full">
          <div className="glass-card-neo p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 flex flex-col justify-between gap-2 h-full">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <p className="text-[10px] font-black uppercase tracking-wider text-amber-400">Pending Requests</p>
            </div>
            <div>
              <p className="text-2xl font-black font-mono text-amber-400">{stats.pendingCount}</p>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">GH₵ {stats.pendingAmount.toFixed(2)} to send</p>
            </div>
          </div>
        </CardTilt>

        <CardTilt className="rounded-2xl w-full">
          <div className="glass-card-neo p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 flex flex-col justify-between gap-2 h-full">
            <div className="flex items-center gap-2">
              <Banknote className="w-4 h-4 text-emerald-400" />
              <p className="text-[10px] font-black uppercase tracking-wider text-emerald-400">Total Paid Out</p>
            </div>
            <div>
              <p className="text-2xl font-black font-mono text-emerald-400">GH₵ {stats.totalPaid.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{withdrawals.filter(w => w.status === "completed").length} completed</p>
            </div>
          </div>
        </CardTilt>

        <CardTilt className="rounded-2xl w-full">
          <div className="glass-card-neo p-4 rounded-2xl border border-purple-500/30 bg-purple-500/10 flex flex-col justify-between gap-2 h-full">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-purple-400" />
              <p className="text-[10px] font-black uppercase tracking-wider text-purple-400">Fees Collected</p>
            </div>
            <div>
              <p className="text-2xl font-black font-mono text-purple-400">GH₵ {stats.totalFees.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">1.5% fee margin</p>
            </div>
          </div>
        </CardTilt>

        <CardTilt className="rounded-2xl w-full">
          <div className="glass-card-neo p-4 rounded-2xl border border-sky-500/30 bg-sky-500/10 flex flex-col justify-between gap-2 h-full">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-sky-400" />
              <p className="text-[10px] font-black uppercase tracking-wider text-sky-400">Average Payout</p>
            </div>
            <div>
              <p className="text-2xl font-black font-mono text-sky-400">GH₵ {stats.avgAmount.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">per withdrawal</p>
            </div>
          </div>
        </CardTilt>
      </div>

      {/* ── Filters ── */}
      <div className="glass-card-neo p-5 rounded-3xl border border-white/10 space-y-4">
        {/* Status tabs */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUS_TABS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3.5 py-1.5 rounded-xl text-xs font-black capitalize transition-all border",
                statusFilter === s
                  ? "bg-amber-500 text-slate-950 border-amber-400 shadow-md font-mono"
                  : "bg-background/50 border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {s === "all"
                ? `All (${withdrawals.length})`
                : `${s} (${withdrawals.filter(w => w.status === s).length})`}
            </button>
          ))}
        </div>

        {/* Search + network + dates + export */}
        <div className="flex flex-col sm:flex-row gap-2 flex-wrap items-center justify-between">
          <div className="relative flex-1 min-w-[220px] w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search agent name, email, MoMo..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-background border-border text-xs rounded-xl"
            />
          </div>

          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            {NETWORKS.map(n => (
              <button
                key={n}
                onClick={() => setNetworkFilter(n)}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-xs font-bold transition-all border",
                  networkFilter === n
                    ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                    : "bg-background/50 border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {n}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              title="From date"
              className="px-3 py-1.5 rounded-xl text-xs bg-background border border-border text-foreground font-mono"
            />
            <input
              type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              title="To date"
              className="px-3 py-1.5 rounded-xl text-xs bg-background border border-border text-foreground font-mono"
            />

            <Button variant="outline" size="sm" className="gap-2 rounded-xl text-xs" onClick={() => exportCsv(filtered)}>
              <Download className="w-3.5 h-3.5" /> CSV
            </Button>
          </div>
        </div>
      </div>

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between p-4 bg-amber-500/15 border border-amber-500/30 rounded-2xl">
          <span className="text-xs font-black text-amber-400">{selectedIds.size} request(s) selected</span>
          <div className="flex items-center gap-2">
            <Button size="sm" className="gap-2 rounded-xl bg-amber-500 text-slate-950 font-black text-xs" disabled={bulkConfirming} onClick={handleBulkConfirm}>
              {bulkConfirming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
              Confirm All as Sent
            </Button>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* ── Withdrawal Requests Table ── */}
      <div className="glass-card-neo rounded-3xl border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="p-4 w-10">
                  <button onClick={toggleSelectAll} className="text-muted-foreground hover:text-foreground">
                    {allPendingSelected && pendingInView.length > 0
                      ? <CheckSquare className="w-4 h-4 text-amber-400" />
                      : <Square className="w-4 h-4" />}
                  </button>
                </th>
                <th className="text-left p-4 font-black uppercase text-muted-foreground">Date & Time</th>
                <th className="text-left p-4 font-black uppercase text-muted-foreground">Agent Profile</th>
                <th className="text-left p-4 font-black uppercase text-muted-foreground">Requested Amount</th>
                <th className="text-left p-4 font-black uppercase text-muted-foreground hidden md:table-cell">Total Agent Profit</th>
                <th className="text-left p-4 font-black uppercase text-muted-foreground hidden lg:table-cell">MoMo Account</th>
                <th className="text-left p-4 font-black uppercase text-muted-foreground">Payout Status</th>
                <th className="text-left p-4 font-black uppercase text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {paginated.map(w => {
                const missingMomo   = !w.momo_number || !w.momo_network;
                const isRejectingThis = rejectingId === w.id;
                const busy = confirming === w.id || payingPaystack === w.id || bulkConfirming;

                return (
                  <tr
                    key={w.id}
                    className={cn(
                      "hover:bg-white/5 transition-colors",
                      missingMomo && w.status === "pending" ? "bg-amber-500/5" : ""
                    )}
                  >
                    <td className="p-4">
                      {w.status === "pending" && (
                        <button onClick={() => toggleSelect(w.id)}>
                          {selectedIds.has(w.id)
                            ? <CheckSquare className="w-4 h-4 text-amber-400" />
                            : <Square className="w-4 h-4 text-muted-foreground" />}
                        </button>
                      )}
                    </td>

                    <td className="p-4 whitespace-nowrap">
                      <p className="font-bold text-foreground">{new Date(w.created_at).toLocaleDateString()}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{new Date(w.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                    </td>

                    <td className="p-4">
                      <p className="font-black text-foreground">{w.agent_name || "Unknown Agent"}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{w.agent_email || ""}</p>
                    </td>

                    <td className="p-4 whitespace-nowrap">
                      <p className="font-black font-mono text-foreground text-sm">GH₵ {w.amount.toFixed(2)}</p>
                      <p className="text-[10px] text-rose-400 font-bold font-mono">Fee: GH₵ {(w.fee || 0).toFixed(2)}</p>
                    </td>

                    <td className="p-4 text-muted-foreground font-mono font-bold hidden md:table-cell">
                      GH₵ {(w.total_profit || 0).toFixed(2)}
                    </td>

                    <td className="p-4 hidden lg:table-cell">
                      {missingMomo ? (
                        <div className="flex items-center gap-1.5 text-amber-400 text-xs font-bold">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          Missing MoMo Details
                        </div>
                      ) : (
                        <div>
                          <p className="font-bold text-foreground">{w.momo_account_name || "—"}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <p className="text-[11px] text-muted-foreground font-mono">{w.momo_number} · {w.momo_network}</p>
                            <button
                              onClick={() => copyMomo(w.momo_number!)}
                              className="text-muted-foreground hover:text-amber-400 transition-colors"
                              title="Copy MoMo number"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </td>

                    <td className="p-4">
                      <div className="flex flex-col gap-1">
                        <p className="font-black text-emerald-400 font-mono text-xs whitespace-nowrap">
                          PAY OUT: GH₵ {(w.net_amount || w.amount).toFixed(2)}
                        </p>
                        <Badge className={cn("w-fit text-[9px] font-black uppercase tracking-wider", statusColors[w.status])}>
                          {w.status}
                        </Badge>
                        {w.failure_reason && (
                          <p className="text-[10px] text-rose-400 max-w-[140px] truncate" title={w.failure_reason}>
                            {w.failure_reason}
                          </p>
                        )}
                      </div>
                    </td>

                    <td className="p-4">
                      {(w.status === "pending" || w.status === "failed" || (w.status === "processing" && !w.paystack_transfer_reference)) && !isRejectingThis && (
                        <div className="flex flex-col gap-1.5 min-w-[140px]">
                          <Button
                            size="sm" variant="outline" className="text-[10px] h-7 bg-purple-500/10 text-purple-400 border-purple-500/30 hover:bg-purple-500/20 font-bold"
                            disabled={busy || missingMomo}
                            onClick={async () => {
                               const toastId = toast.loading("Verifying MoMo Account...");
                               try {
                                 const net = (w.momo_network || "").toUpperCase();
                                 let bankCode = "MTN";
                                 if (net.includes("VODA") || net.includes("TELECEL")) bankCode = "VOD";
                                 if (net.includes("AIRTEL") || net.includes("TIGO") || net.includes("AT")) bankCode = "ATL";
 
                                 const { data, error } = await supabase.functions.invoke("paystack-resolve", {
                                   body: { account_number: w.momo_number, bank_code: bankCode }
                                 });
 
                                 if (error || !data?.success) throw new Error(data?.error || "Resolution failed");
 
                                 await supabase.from("profiles").update({ momo_account_name: data?.account_name }).eq("user_id", w.agent_id);
                                 
                                 toast.success("Identity Verified", { description: `Account: ${data?.account_name}`, id: toastId });
                                 fetchWithdrawals(true);
                               } catch (e: any) {
                                 toast.error("Verification Failed", { description: e.message, id: toastId });
                               }
                             }}
                          >
                            <RefreshCw className="w-3 h-3 mr-1" /> Verify Identity
                          </Button>

                          <Button
                            size="sm" className="text-[10px] h-7 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black"
                            disabled={busy}
                            onClick={() => handleConfirm(w.id)}
                          >
                            {confirming === w.id
                              ? <Loader2 className="w-3 h-3 animate-spin mr-1" />
                              : <CheckCircle className="w-3 h-3 mr-1" />}
                            Mark as Sent
                          </Button>

                          <Button
                            size="sm" className="text-[10px] h-7 bg-sky-600 hover:bg-sky-500 text-white font-black"
                            disabled={busy}
                            onClick={() => handlePaystackPayout(w.id)}
                          >
                            {payingPaystack === w.id
                              ? <Loader2 className="w-3 h-3 animate-spin mr-1" />
                              : <Banknote className="w-3 h-3 mr-1" />}
                            Pay via Paystack
                          </Button>

                          <Button
                            size="sm" variant="outline"
                            className="text-[10px] h-7 border-rose-500/30 text-rose-400 hover:bg-rose-500/10 font-bold"
                            disabled={busy}
                            onClick={() => { setRejectingId(w.id); setRejectReason(""); }}
                          >
                            <XCircle className="w-3 h-3 mr-1" /> Reject
                          </Button>
                        </div>
                      )}

                      {w.status === "processing" && w.paystack_transfer_reference && (
                        <div className="flex flex-col gap-1.5 min-w-[140px]">
                          <Button
                            size="sm" className="text-[10px] h-7 bg-indigo-600 hover:bg-indigo-500 text-white font-bold"
                            disabled={busy}
                            onClick={async () => {
                              setConfirming(w.id);
                              const toastId = toast.loading("Syncing Paystack status...");
                              try {
                                const { data, error } = await supabase.functions.invoke("system-payout-v1", {
                                  body: { action: "verify_paystack_transfer", withdrawal_id: w.id },
                                  headers: { Authorization: `Bearer ${session?.access_token}` }
                                });
                                
                                if (error || !data?.success) throw new Error(data?.error || error?.message || "Sync failed");
                                
                                toast.success("Sync Complete", { description: data.message, id: toastId });
                                fetchWithdrawals(true);
                              } catch (e: any) {
                                toast.error("Sync Failed", { description: e.message, id: toastId });
                              } finally {
                                setConfirming(null);
                              }
                            }}
                          >
                            {confirming === w.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                            Sync Status
                          </Button>

                          <Button
                            size="sm" variant="outline" className="text-[10px] h-7 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 font-bold"
                            disabled={busy}
                            onClick={() => handleConfirm(w.id)}
                          >
                            <CheckCircle className="w-3 h-3 mr-1" /> Force Complete
                          </Button>
                        </div>
                      )}

                      {/* Inline reject form */}
                      {(w.status === "pending" || w.status === "failed" || (w.status === "processing" && !w.paystack_transfer_reference)) && isRejectingThis && (
                        <div className="space-y-1.5 min-w-[160px]">
                          <Input
                            placeholder="Rejection reason..."
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            className="h-7 text-[10px] bg-background border-border"
                            autoFocus
                            onKeyDown={e => { if (e.key === "Enter") handleReject(w.id); if (e.key === "Escape") { setRejectingId(null); setRejectReason(""); } }}
                          />
                          <div className="flex gap-1">
                            <Button
                              size="sm" variant="destructive" className="text-[10px] h-7 flex-1 font-bold"
                              disabled={rejecting || !rejectReason.trim()}
                              onClick={() => handleReject(w.id)}
                            >
                              {rejecting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm"}
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="text-[10px] h-7"
                              onClick={() => { setRejectingId(null); setRejectReason(""); }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="p-8 text-center text-xs text-muted-foreground">No withdrawal requests found matching filters.</div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t border-white/10 text-xs">
            <Button
              variant="outline" size="sm" className="gap-1.5 rounded-xl font-bold"
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft className="w-4 h-4" /> Previous
            </Button>
            <span className="text-muted-foreground font-mono">Page {page + 1} of {totalPages}</span>
            <Button
              variant="outline" size="sm" className="gap-1.5 rounded-xl font-bold"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
            >
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminWithdrawals;
