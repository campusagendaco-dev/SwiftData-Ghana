import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search, CheckCircle, Loader2, XCircle, Copy, Download,
  RefreshCw, ChevronLeft, ChevronRight, Wallet, TrendingUp,
  AlertCircle, Banknote, CheckSquare, Square, Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/utils/auditLogger";

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
}

const PAGE_SIZE = 50;

const statusColors: Record<string, string> = {
  completed:  "bg-green-500/20 text-green-400 border-green-500/30",
  pending:    "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  processing: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  failed:     "bg-red-500/20 text-red-400 border-red-500/30",
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
  const { toast } = useToast();
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

  const fetchWithdrawals = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);

    const { data } = await supabase
      .from("withdrawals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    const rows = (data || []) as WithdrawalRow[];

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

  useEffect(() => { fetchWithdrawals(); }, [fetchWithdrawals]);

  // Reset page & selection when filters change
  useEffect(() => { setPage(0); }, [search, statusFilter, networkFilter, dateFrom, dateTo]);
  useEffect(() => { setSelectedIds(new Set()); }, [statusFilter]);

  // ── Stats ──────────────────────────────────────────────────────────────
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

  // ── Filtered + paginated ───────────────────────────────────────────────
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
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Actions ────────────────────────────────────────────────────────────
  const handleConfirm = async (withdrawalId: string) => {
    setConfirming(withdrawalId);
    const withdrawal = withdrawals.find(w => w.id === withdrawalId);

    const { data, error } = await supabase.functions.invoke("admin-user-actions", {
      body: { action: "confirm_withdrawal", withdrawal_id: withdrawalId },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    if (error || data?.error) {
      toast({ title: "Failed to confirm", description: data?.error || error?.message || "Unknown error", variant: "destructive" });
    } else {
      if (currentUser && withdrawal) {
        await logAudit(currentUser.id, "confirm_withdrawal", {
          withdrawal_id: withdrawalId,
          agent_id: withdrawal.agent_id,
          agent_name: withdrawal.agent_name,
          amount: withdrawal.amount,
        });
      }
      toast({ title: "Withdrawal confirmed as sent!" });
      setSelectedIds(prev => { const n = new Set(prev); n.delete(withdrawalId); return n; });
      await fetchWithdrawals(true);
    }
    setConfirming(null);
  };

  const handlePaystackPayout = async (withdrawalId: string) => {
    if (!window.confirm("Initiate a REAL transfer via Paystack?")) return;
    setPayingPaystack(withdrawalId);
    const withdrawal = withdrawals.find(w => w.id === withdrawalId);

    const { data, error } = await supabase.functions.invoke("admin-user-actions", {
      body: { action: "paystack_payout", withdrawal_id: withdrawalId },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    if (error || data?.error) {
      toast({ title: "Payout Failed", description: data?.error || error?.message || "Transfer could not be initiated.", variant: "destructive" });
    } else {
      toast({ title: "Payout Successful!", description: `Ref: ${data?.transfer_reference || "N/A"}` });
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
      toast({ title: "Enter a reason for rejection", variant: "destructive" });
      return;
    }
    setRejecting(true);

    const { data, error } = await supabase.functions.invoke("admin-user-actions", {
      body: { action: "reject_withdrawal", withdrawal_id: withdrawalId, reason: rejectReason.trim() },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    if (error || data?.error) {
      toast({ title: "Failed to reject", description: data?.error || error?.message, variant: "destructive" });
    } else {
      const withdrawal = withdrawals.find(w => w.id === withdrawalId);
      if (currentUser && withdrawal) {
        await logAudit(currentUser.id, "reject_withdrawal", {
          withdrawal_id: withdrawalId,
          agent_id: withdrawal.agent_id,
          reason: rejectReason.trim(),
        });
      }
      toast({ title: "Withdrawal rejected" });
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
      const { data, error } = await supabase.functions.invoke("admin-user-actions", {
        body: { action: "confirm_withdrawal", withdrawal_id: id },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || data?.error) failed++; else success++;
    }

    toast({ title: `Bulk confirm: ${success} confirmed${failed ? `, ${failed} failed` : ""}` });
    setSelectedIds(new Set());
    setBulkConfirming(false);
    await fetchWithdrawals(true);
  };

  const copyMomo = (number: string) => {
    navigator.clipboard.writeText(number).then(() => toast({ title: "MoMo number copied" }));
  };

  if (loading) return <div className="text-muted-foreground p-4">Loading withdrawals…</div>;

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Withdrawal Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {withdrawals.length} total · {stats.pendingCount} pending
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2 self-start" onClick={() => fetchWithdrawals(true)} disabled={refreshing}>
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ── Stats cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-3.5 h-3.5 text-yellow-400" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pending</p>
          </div>
          <p className="text-2xl font-black text-yellow-400">{stats.pendingCount}</p>
          <p className="text-xs text-muted-foreground mt-0.5">GH₵{stats.pendingAmount.toFixed(2)} to send</p>
          {Object.keys(stats.networkTotals).length > 0 && (
            <div className="mt-2 space-y-0.5 border-t border-border pt-2">
              {Object.entries(stats.networkTotals).map(([net, amt]) => (
                <p key={net} className="text-[10px] text-muted-foreground">{net}: GH₵{(amt as number).toFixed(2)}</p>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Banknote className="w-3.5 h-3.5 text-green-400" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Paid Out</p>
          </div>
          <p className="text-2xl font-black text-green-400">GH₵{stats.totalPaid.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{withdrawals.filter(w => w.status === "completed").length} completed</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-purple-400" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Fees Collected</p>
          </div>
          <p className="text-2xl font-black text-purple-400">GH₵{stats.totalFees.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">1.5% per withdrawal</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-3.5 h-3.5 text-blue-400" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Average</p>
          </div>
          <p className="text-2xl font-black text-blue-400">GH₵{stats.avgAmount.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">per request</p>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="space-y-3">
        {/* Status tabs */}
        <div className="flex items-center gap-1 flex-wrap">
          {STATUS_TABS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all border ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary text-muted-foreground border-transparent hover:border-border"
              }`}
            >
              {s === "all"
                ? `All (${withdrawals.length})`
                : `${s} (${withdrawals.filter(w => w.status === s).length})`}
            </button>
          ))}
        </div>

        {/* Search + network + dates + export */}
        <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search name, email, MoMo…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-secondary"
            />
          </div>

          <div className="flex items-center gap-1">
            {NETWORKS.map(n => (
              <button
                key={n}
                onClick={() => setNetworkFilter(n)}
                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
                  networkFilter === n
                    ? "bg-secondary border-primary text-foreground"
                    : "bg-secondary border-transparent text-muted-foreground hover:border-border"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <input
            type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-2 rounded-lg text-xs bg-secondary border border-border text-foreground"
          />
          <input
            type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-3 py-2 rounded-lg text-xs bg-secondary border border-border text-foreground"
          />

          <Button variant="outline" size="sm" className="gap-2 whitespace-nowrap" onClick={() => exportCsv(filtered)}>
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/20 rounded-xl">
          <span className="text-sm font-bold text-primary">{selectedIds.size} selected</span>
          <Button size="sm" className="gap-2" disabled={bulkConfirming} onClick={handleBulkConfirm}>
            {bulkConfirming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
            Confirm All as Sent
          </Button>
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* ── Result count ── */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Showing {paginated.length ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} results
        </span>
        {(dateFrom || dateTo || networkFilter !== "all" || search) && (
          <button
            className="text-primary hover:underline"
            onClick={() => { setDateFrom(""); setDateTo(""); setNetworkFilter("all"); setSearch(""); }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="p-4 w-10">
                  <button onClick={toggleSelectAll} className="text-muted-foreground hover:text-foreground">
                    {allPendingSelected && pendingInView.length > 0
                      ? <CheckSquare className="w-4 h-4 text-primary" />
                      : <Square className="w-4 h-4" />}
                  </button>
                </th>
                <th className="text-left p-4 font-medium text-muted-foreground">Date & Time</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Agent</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Amount</th>
                <th className="text-left p-4 font-medium text-muted-foreground hidden md:table-cell">Total Profit</th>
                <th className="text-left p-4 font-medium text-muted-foreground hidden lg:table-cell">MoMo Details</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Status</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(w => {
                const missingMomo   = !w.momo_number || !w.momo_network;
                const isRejectingThis = rejectingId === w.id;
                const busy = confirming === w.id || payingPaystack === w.id || bulkConfirming;

                return (
                  <tr
                    key={w.id}
                    className={`border-b border-border/50 hover:bg-muted/20 ${
                      missingMomo && w.status === "pending" ? "bg-yellow-500/[0.04]" : ""
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="p-4">
                      {w.status === "pending" && (
                        <button onClick={() => toggleSelect(w.id)}>
                          {selectedIds.has(w.id)
                            ? <CheckSquare className="w-4 h-4 text-primary" />
                            : <Square className="w-4 h-4 text-muted-foreground" />}
                        </button>
                      )}
                    </td>

                    {/* Date + time */}
                    <td className="p-4 text-muted-foreground whitespace-nowrap">
                      <p className="text-sm">{new Date(w.created_at).toLocaleDateString()}</p>
                      <p className="text-xs">{new Date(w.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                    </td>

                    {/* Agent */}
                    <td className="p-4">
                      <p className="font-medium text-sm">{w.agent_name || "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">{w.agent_email || ""}</p>
                    </td>

                    {/* Amount */}
                    <td className="p-4">
                      <p className="font-medium whitespace-nowrap">GH₵{w.amount.toFixed(2)}</p>
                      <p className="text-[10px] text-red-400 font-bold">Fee: GH₵{(w.fee || 0).toFixed(2)}</p>
                    </td>

                    {/* Total profit */}
                    <td className="p-4 text-muted-foreground hidden md:table-cell">
                      GH₵{(w.total_profit || 0).toFixed(2)}
                    </td>

                    {/* MoMo details */}
                    <td className="p-4 hidden lg:table-cell">
                      {missingMomo ? (
                        <div className="flex items-center gap-1.5 text-yellow-500 text-xs">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          Missing MoMo details
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm">{w.momo_account_name || "—"}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <p className="text-xs text-muted-foreground">{w.momo_number} · {w.momo_network}</p>
                            <button
                              onClick={() => copyMomo(w.momo_number!)}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                              title="Copy MoMo number"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Status */}
                    <td className="p-4">
                      <div className="flex flex-col gap-1">
                        <p className="font-black text-emerald-400 text-sm whitespace-nowrap">
                          SEND: GH₵{(w.net_amount || w.amount).toFixed(2)}
                        </p>
                        <Badge className={`${statusColors[w.status] || ""} w-fit`}>{w.status}</Badge>
                        {w.failure_reason && (
                          <p className="text-[10px] text-red-400 mt-0.5 max-w-[140px] truncate" title={w.failure_reason}>
                            {w.failure_reason}
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Action */}
                    <td className="p-4">
                      {w.status === "pending" && !isRejectingThis && (
                        <div className="flex flex-col gap-1.5">
                          <Button
                            size="sm" variant="outline" className="text-xs gap-1.5 h-8"
                            disabled={busy}
                            onClick={() => handleConfirm(w.id)}
                          >
                            {confirming === w.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <CheckCircle className="w-3 h-3" />}
                            Mark as Sent
                          </Button>
                          <Button
                            size="sm" className="text-xs gap-1.5 h-8 bg-blue-600 hover:bg-blue-700 text-white"
                            disabled={busy}
                            onClick={() => handlePaystackPayout(w.id)}
                          >
                            {payingPaystack === w.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Banknote className="w-3 h-3" />}
                            Pay via Paystack
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            className="text-xs gap-1.5 h-8 border-red-500/30 text-red-400 hover:bg-red-500/10"
                            disabled={busy}
                            onClick={() => { setRejectingId(w.id); setRejectReason(""); }}
                          >
                            <XCircle className="w-3 h-3" />
                            Reject
                          </Button>
                        </div>
                      )}

                      {/* Inline reject form */}
                      {w.status === "pending" && isRejectingThis && (
                        <div className="space-y-1.5 min-w-[180px]">
                          <Input
                            placeholder="Reason for rejection…"
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            className="h-7 text-xs bg-secondary"
                            autoFocus
                            onKeyDown={e => { if (e.key === "Enter") handleReject(w.id); if (e.key === "Escape") { setRejectingId(null); setRejectReason(""); } }}
                          />
                          <div className="flex gap-1">
                            <Button
                              size="sm" variant="destructive" className="text-xs h-7 flex-1"
                              disabled={rejecting || !rejectReason.trim()}
                              onClick={() => handleReject(w.id)}
                            >
                              {rejecting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm"}
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="text-xs h-7"
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
          <div className="p-8 text-center text-muted-foreground">No withdrawals found.</div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t border-border">
            <Button
              variant="outline" size="sm" className="gap-1.5"
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft className="w-4 h-4" /> Previous
            </Button>
            <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
            <Button
              variant="outline" size="sm" className="gap-1.5"
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
