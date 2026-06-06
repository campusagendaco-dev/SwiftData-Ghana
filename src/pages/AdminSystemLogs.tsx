import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw, Search, ChevronDown, ChevronRight,
  Wifi, WifiOff, Trash2, ExternalLink, RotateCcw, CheckCircle2,
  Clock, Filter, Download, Layers, GitBranch, BarChart3, ScrollText,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import OrderJourneyModal from "@/components/OrderJourneyModal";
import ProviderHealthPanel from "@/components/ProviderHealthPanel";

interface SystemLog {
  id: string;
  ts: string;
  level: "info" | "warn" | "error";
  source: string;
  event: string;
  order_id: string | null;
  agent_id: string | null;
  provider_id: string | null;
  message: string;
  data: Record<string, unknown> | null;
  duration_ms: number | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

interface GroupedLog extends SystemLog {
  groupCount?: number;
  groupKey?: string;
}

const LEVEL_STYLES = {
  info:  { badge: "bg-blue-500/20 text-blue-400 border-blue-500/30",  dot: "bg-blue-400",        row: "" },
  warn:  { badge: "bg-amber-500/20 text-amber-400 border-amber-500/30", dot: "bg-amber-400",       row: "bg-amber-500/[0.02]" },
  error: { badge: "bg-red-500/20 text-red-400 border-red-500/30",     dot: "bg-red-500 animate-pulse", row: "bg-red-500/[0.03]" },
};

const SOURCE_LABELS: Record<string, string> = {
  "verify-payment":    "Verify Payment",
  "datahub-webhook":   "DataHub Webhook",
  "wallet-buy-data":   "Wallet Buy Data",
  "sync-provider-data":"Provider Sync",
  "cron-auto-retry":   "Auto-Retry Cron",
  "system":            "System",
};

const RETRYABLE_EVENTS = new Set([
  "provider.rejected", "order.queued", "order.update_failed",
  "order.failed", "order.create_failed", "error",
]);

const RESOLUTION_HINTS: Record<string, string> = {
  "provider.rejected":   "Provider refused the order. Retry re-submits to the active provider.",
  "order.queued":        "Order queued due to provider failure. Retry attempts fulfillment again.",
  "order.update_failed": "DB failed to save provider response. Retry re-checks and updates status.",
  "order.failed":        "Provider marked order failed. Retry attempts recovery via next provider.",
  "order.not_found":     "Webhook arrived but no matching order in DB. Check order reference manually.",
  "order.create_failed": "Order insert failed — wallet was auto-refunded. Investigate DB logs.",
  "alert.error_spike":   "Error spike detected. Investigate recent errors and resolve each one.",
  "error":               "Unhandled crash. Expand payload for full stack trace.",
};

const TIME_RANGES = [
  { label: "1h",  ms: 60 * 60 * 1000 },
  { label: "6h",  ms: 6 * 60 * 60 * 1000 },
  { label: "24h", ms: 24 * 60 * 60 * 1000 },
  { label: "7d",  ms: 7 * 24 * 60 * 60 * 1000 },
];

const PAGE_SIZE = 100;

type Tab = "logs" | "health";

export default function AdminSystemLogs() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Tab
  const [activeTab, setActiveTab] = useState<Tab>("logs");

  const [searchParams] = useSearchParams();
  const initialOrderId = searchParams.get("order_id") || "";

  // Filters
  const [timeRange, setTimeRange] = useState(initialOrderId ? "7d" : "24h");
  const [levelFilter, setLevelFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [resolvedFilter, setResolvedFilter] = useState(initialOrderId ? "all" : "unresolved");
  const [orderSearch, setOrderSearch] = useState(initialOrderId);
  const [textSearch, setTextSearch] = useState("");
  const [page, setPage] = useState(0);

  // UI states
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [liveMode, setLiveMode] = useState(true);
  const [grouped, setGrouped] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [journeyOrderId, setJourneyOrderId] = useState<string | null>(null);

  // Data
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState({ total: 0, errors: 0, warns: 0, unresolved: 0 });

  // Action states
  const [retrying, setRetrying] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [bulkResolving, setBulkResolving] = useState(false);
  const [purging, setPurging] = useState(false);

  const getSince = useCallback(() => {
    const range = TIME_RANGES.find((r) => r.label === timeRange) ?? TIME_RANGES[2];
    return new Date(Date.now() - range.ms).toISOString();
  }, [timeRange]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    let query = (supabase as any)
      .from("system_logs")
      .select("*", { count: "exact" })
      .gte("ts", getSince())
      .order("ts", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (levelFilter !== "all")    query = query.eq("level", levelFilter);
    if (sourceFilter !== "all")   query = query.eq("source", sourceFilter);
    if (resolvedFilter === "unresolved") query = query.eq("resolved", false);
    if (resolvedFilter === "resolved")   query = query.eq("resolved", true);
    if (orderSearch.trim().length === 36) query = query.eq("order_id", orderSearch.trim());
    if (textSearch.trim().length >= 3)   query = query.ilike("message", `%${textSearch.trim()}%`);

    const { data, count, error } = await query;
    if (!error) { setLogs((data as SystemLog[]) || []); setTotalCount(count || 0); }
    setLoading(false);
  }, [levelFilter, sourceFilter, resolvedFilter, orderSearch, textSearch, page, getSince]);

  const fetchStats = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("system_logs")
      .select("level, resolved")
      .gte("ts", getSince());
    if (data) {
      setStats({
        total: data.length,
        errors: data.filter((l: any) => l.level === "error").length,
        warns:  data.filter((l: any) => l.level === "warn").length,
        unresolved: data.filter((l: any) => !l.resolved && (l.level === "error" || l.level === "warn")).length,
      });
    }
  }, [getSince]);

  useEffect(() => { setPage(0); }, [levelFilter, sourceFilter, resolvedFilter, orderSearch, textSearch, timeRange]);
  useEffect(() => { fetchLogs(); fetchStats(); }, [fetchLogs, fetchStats]);

  // Realtime
  useEffect(() => {
    if (!liveMode) return;
    const ch = supabase
      .channel("system_logs_live")
      .on("postgres_changes" as any, { event: "INSERT", schema: "public", table: "system_logs" }, (payload: any) => {
        if (page === 0) setLogs((prev) => [payload.new as SystemLog, ...prev.slice(0, PAGE_SIZE - 1)]);
        setTotalCount((prev) => prev + 1);
        fetchStats();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [liveMode, page, fetchStats]);

  // Grouping (client-side)
  const displayLogs = useMemo<GroupedLog[]>(() => {
    if (!grouped) return logs;
    const seen = new Map<string, GroupedLog>();
    for (const log of logs) {
      const key = `${log.event}::${log.source}::${log.message.slice(0, 60)}`;
      if (seen.has(key)) {
        seen.get(key)!.groupCount = (seen.get(key)!.groupCount ?? 1) + 1;
      } else {
        seen.set(key, { ...log, groupCount: 1, groupKey: key });
      }
    }
    return Array.from(seen.values());
  }, [logs, grouped]);

  // Actions
  const handleRetry = async (log: SystemLog) => {
    if (!log.order_id) return;
    setRetrying(log.id);
    try {
      const { data, error } = await supabase.functions.invoke("verify-payment", {
        body: { reference: log.order_id },
      });
      if (error) throw error;
      const status = (data as any)?.status;
      if (status === "fulfilled") {
        toast({ title: "Order fulfilled", description: `Order recovered successfully.` });
        await doResolve(log, "Resolved via retry — order fulfilled");
      } else {
        toast({ title: `Status: ${status}`, description: "Check order for updated state." });
      }
      fetchLogs(); fetchStats();
    } catch (e: any) {
      toast({ title: "Retry failed", description: e.message, variant: "destructive" });
    } finally { setRetrying(null); }
  };

  const doResolve = async (log: SystemLog, note?: string) => {
    const next = !log.resolved;
    await (supabase as any).from("system_logs").update({
      resolved: next,
      resolved_at: next ? new Date().toISOString() : null,
      resolved_by: next ? user?.id : null,
      resolution_note: next ? (note || "Marked resolved by admin") : null,
    }).eq("id", log.id);
  };

  const handleResolve = async (log: SystemLog) => {
    setResolving(log.id);
    const { error } = await (supabase as any).from("system_logs").update({
      resolved: !log.resolved,
      resolved_at: !log.resolved ? new Date().toISOString() : null,
      resolved_by: !log.resolved ? user?.id : null,
      resolution_note: !log.resolved ? "Marked resolved by admin" : null,
    }).eq("id", log.id);
    if (!error) {
      setLogs((prev) => prev.map((l) => l.id === log.id ? { ...l, resolved: !l.resolved } : l));
      fetchStats();
    }
    setResolving(null);
  };

  const handleBulkResolve = async () => {
    if (!selectedIds.size) return;
    setBulkResolving(true);
    const ids = Array.from(selectedIds);
    const { error } = await (supabase as any).from("system_logs").update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by: user?.id,
      resolution_note: "Bulk resolved by admin",
    }).in("id", ids);
    if (!error) {
      setLogs((prev) => prev.map((l) => selectedIds.has(l.id) ? { ...l, resolved: true } : l));
      setSelectedIds(new Set());
      fetchStats();
      toast({ title: `${ids.length} logs resolved` });
    }
    setBulkResolving(false);
  };

  const handleExportCSV = () => {
    const header = ["ts", "level", "source", "event", "message", "order_id", "duration_ms", "resolved"];
    const rows = logs.map((l) => [
      l.ts, l.level, l.source, l.event,
      `"${l.message.replace(/"/g, '""')}"`,
      l.order_id || "", l.duration_ms ?? "", l.resolved,
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `system-logs-${format(new Date(), "yyyy-MM-dd-HH-mm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePurge = async () => {
    setPurging(true);
    const { error } = await (supabase as any).rpc("purge_old_system_logs");
    setPurging(false);
    if (error) { toast({ title: "Purge failed", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Logs older than 30 days purged" }); fetchLogs(); fetchStats(); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">System Logs</h1>
          <p className="text-white/40 text-sm mt-1">Full observability — providers, webhooks, orders, errors</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setLiveMode((v) => !v)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
              liveMode ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-white/5 text-white/40 border-white/10")}>
            {liveMode ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {liveMode ? "Live" : "Paused"}
          </button>
          <Button type="button" onClick={handleExportCSV} variant="outline" size="sm"
            className="gap-1.5 border-white/10 text-white/60 hover:bg-white/5">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
          <Button type="button" onClick={handlePurge} variant="outline" size="sm" disabled={purging}
            className="gap-1.5 border-red-500/20 text-red-400 hover:bg-red-500/10">
            <Trash2 className="w-3.5 h-3.5" /> Purge Old
          </Button>
          <Button type="button" onClick={() => { fetchLogs(); fetchStats(); }} variant="outline" size="sm"
            className="gap-1.5 border-white/10 text-white/70 hover:bg-white/5">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-white/5 border-white/10 p-4">
          <p className="text-white/40 text-[10px] font-black uppercase tracking-widest">Events ({timeRange})</p>
          <p className="text-3xl font-black text-white mt-1">{stats.total.toLocaleString()}</p>
        </Card>
        <Card className="bg-amber-500/5 border-amber-500/20 p-4">
          <p className="text-amber-400/60 text-[10px] font-black uppercase tracking-widest">Warnings</p>
          <p className="text-3xl font-black text-amber-400 mt-1">{stats.warns.toLocaleString()}</p>
        </Card>
        <Card className="bg-red-500/5 border-red-500/20 p-4">
          <p className="text-red-400/60 text-[10px] font-black uppercase tracking-widest">Errors</p>
          <p className="text-3xl font-black text-red-400 mt-1">{stats.errors.toLocaleString()}</p>
        </Card>
        <Card className={cn("p-4 border", stats.unresolved > 0 ? "bg-red-500/10 border-red-500/30" : "bg-green-500/5 border-green-500/20")}>
          <p className={cn("text-[10px] font-black uppercase tracking-widest", stats.unresolved > 0 ? "text-red-400/80" : "text-green-400/60")}>
            Unresolved
          </p>
          <p className={cn("text-3xl font-black mt-1", stats.unresolved > 0 ? "text-red-400" : "text-green-400")}>
            {stats.unresolved.toLocaleString()}
          </p>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit">
        {([["logs", ScrollText, "Log Feed"], ["health", BarChart3, "Provider Health"]] as const).map(([tab, Icon, label]) => (
          <button type="button" key={tab} onClick={() => setActiveTab(tab as Tab)}
            className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all",
              activeTab === tab ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70")}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {/* ── PROVIDER HEALTH TAB ── */}
      {activeTab === "health" && <ProviderHealthPanel />}

      {/* ── LOG FEED TAB ── */}
      {activeTab === "logs" && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            {/* Time range */}
            <div className="flex gap-1 bg-white/5 rounded-lg p-1">
              {TIME_RANGES.map((r) => (
                <button type="button" key={r.label} onClick={() => setTimeRange(r.label)}
                  className={cn("px-3 py-1 rounded text-xs font-bold transition-all",
                    timeRange === r.label ? "bg-white/15 text-white" : "text-white/30 hover:text-white/60")}>
                  {r.label}
                </button>
              ))}
            </div>

            <Select value={resolvedFilter} onValueChange={setResolvedFilter}>
              <SelectTrigger className="w-40 bg-white/5 border-white/10 text-white h-8 text-xs">
                <Filter className="w-3 h-3 mr-1" /><SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Logs</SelectItem>
                <SelectItem value="unresolved">Unresolved</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>

            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-32 bg-white/5 border-white/10 text-white h-8 text-xs">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-48 bg-white/5 border-white/10 text-white h-8 text-xs">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="verify-payment">Verify Payment</SelectItem>
                <SelectItem value="datahub-webhook">DataHub Webhook</SelectItem>
                <SelectItem value="wallet-buy-data">Wallet Buy Data</SelectItem>
                <SelectItem value="sync-provider-data">Provider Sync</SelectItem>
                <SelectItem value="cron-auto-retry">Auto-Retry Cron</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>

            {/* Full-text search */}
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
              <Input placeholder="Search messages..."
                value={textSearch} onChange={(e) => setTextSearch(e.target.value)}
                className="pl-8 h-8 bg-white/5 border-white/10 text-white placeholder:text-white/20 text-xs" />
            </div>

            {/* Order UUID search */}
            <div className="relative min-w-48">
              <GitBranch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
              <Input placeholder="Order UUID..."
                value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)}
                className="pl-8 h-8 bg-white/5 border-white/10 text-white placeholder:text-white/20 font-mono text-xs" />
            </div>

            {/* Group toggle */}
            <button type="button" onClick={() => setGrouped((v) => !v)}
              title="Group duplicate errors"
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
                grouped ? "bg-primary/10 text-primary border-primary/20" : "bg-white/5 text-white/30 border-white/10")}>
              <Layers className="w-3.5 h-3.5" /> Group
            </button>

            <span className="text-white/20 text-xs ml-auto shrink-0">{totalCount.toLocaleString()} entries</span>
          </div>

          {/* Bulk actions bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border border-primary/20 rounded-xl">
              <span className="text-primary text-sm font-bold">{selectedIds.size} selected</span>
              <Button type="button" size="sm" onClick={handleBulkResolve} disabled={bulkResolving}
                className="h-7 bg-green-500/20 text-green-400 hover:bg-green-500/30 border-0 gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {bulkResolving ? "Resolving..." : "Resolve All Selected"}
              </Button>
              <button type="button" onClick={() => setSelectedIds(new Set())} className="text-white/30 text-xs hover:text-white ml-auto">
                Clear selection
              </button>
            </div>
          )}

          {/* Log Feed */}
          <Card className="bg-[#0d140d]/60 border-white/10 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <RefreshCw className="w-6 h-6 text-white/20 animate-spin" />
              </div>
            ) : displayLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <CheckCircle2 className="w-10 h-10 text-green-500/30" />
                <p className="text-white/40 text-sm font-bold">All clear</p>
                <p className="text-white/20 text-xs">No logs match your current filters</p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {displayLogs.map((log) => {
                  const style = LEVEL_STYLES[log.level] ?? LEVEL_STYLES.info;
                  const isExpanded = expandedId === log.id;
                  const hasData = log.data && Object.keys(log.data).length > 0;
                  const canRetry = RETRYABLE_EVENTS.has(log.event) && !!log.order_id && !log.resolved;
                  const hint = RESOLUTION_HINTS[log.event];
                  const isSelected = selectedIds.has(log.id);
                  const isAlert = log.event === "alert.error_spike";

                  return (
                    <div key={log.id}
                      className={cn("group transition-colors border-l-2",
                        isAlert ? "border-l-red-500 bg-red-500/5" : "border-l-transparent",
                        log.resolved ? "opacity-40" : style.row,
                        isSelected && "bg-primary/5 border-l-primary"
                      )}>
                      <div className="flex items-start gap-3 px-4 py-3">
                        {/* Checkbox */}
                        {(log.level === "warn" || log.level === "error") && (
                          <input type="checkbox" title="Select log" checked={isSelected}
                            onChange={() => toggleSelect(log.id)}
                            className="mt-1.5 shrink-0 accent-primary cursor-pointer" />
                        )}

                        {/* Level dot */}
                        <div className={cn("w-1.5 h-1.5 rounded-full mt-[7px] shrink-0",
                          log.resolved ? "bg-green-500" : style.dot)} />

                        {/* Main content */}
                        <button type="button" onClick={() => setExpandedId(isExpanded ? null : log.id)}
                          className="flex-1 min-w-0 text-left">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white/25 text-[11px] font-mono tabular-nums shrink-0">
                              {format(new Date(log.ts), "MMM dd HH:mm:ss")}
                            </span>
                            <Badge className={cn("text-[9px] h-4 px-1.5 border font-black uppercase shrink-0", style.badge)}>
                              {log.level}
                            </Badge>
                            <span className="text-white/40 text-[11px] font-mono bg-white/5 px-1.5 py-0.5 rounded shrink-0">
                              {SOURCE_LABELS[log.source] ?? log.source}
                            </span>
                            <span className="text-primary/70 text-[11px] font-bold shrink-0">{log.event}</span>
                            {log.duration_ms != null && (
                              <span className="text-white/20 text-[10px] shrink-0 flex items-center gap-0.5">
                                <Clock className="w-2.5 h-2.5" />{log.duration_ms}ms
                              </span>
                            )}
                            {log.groupCount && log.groupCount > 1 && (
                              <Badge className="text-[9px] h-4 px-1.5 bg-white/10 text-white/50 border-white/20 font-black shrink-0">
                                ×{log.groupCount}
                              </Badge>
                            )}
                            {log.resolved && (
                              <Badge className="text-[9px] h-4 px-1.5 bg-green-500/10 text-green-400 border-green-500/20 font-black shrink-0">
                                Resolved
                              </Badge>
                            )}
                          </div>
                          <p className={cn("text-sm mt-1 leading-snug",
                            log.level === "error" ? "text-red-300/80" : log.level === "warn" ? "text-amber-300/80" : "text-white/60")}>
                            {log.message}
                          </p>
                          {log.order_id && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); setJourneyOrderId(log.order_id); }}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setJourneyOrderId(log.order_id); } }}
                              className="block text-primary/40 text-[10px] font-mono mt-0.5 hover:text-primary transition-colors hover:underline text-left truncate max-w-full cursor-pointer">
                              order: {log.order_id} →  view journey
                            </span>
                          )}
                          {hint && !log.resolved && (log.level === "warn" || log.level === "error") && (
                            <p className="text-white/25 text-[11px] mt-1 italic">{hint}</p>
                          )}
                          {log.resolution_note && log.resolved && (
                            <p className="text-green-400/50 text-[10px] mt-1">✓ {log.resolution_note}</p>
                          )}
                        </button>

                        {/* Action buttons (reveal on hover) */}
                        <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          {log.order_id && (
                            <button type="button" title="Open order in AdminOrders"
                              onClick={() => navigate(`/admin/orders?agent=${log.order_id}`)}
                              className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-white transition-colors">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canRetry && (
                            <button type="button" title="Retry order via verify-payment"
                              onClick={() => handleRetry(log)} disabled={retrying === log.id}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-black transition-colors disabled:opacity-50">
                              <RotateCcw className={cn("w-3 h-3", retrying === log.id && "animate-spin")} />
                              {retrying === log.id ? "Retrying..." : "Retry"}
                            </button>
                          )}
                          {(log.level === "warn" || log.level === "error") && (
                            <button type="button"
                              title={log.resolved ? "Mark unresolved" : "Mark as resolved"}
                              onClick={() => handleResolve(log)} disabled={resolving === log.id}
                              className={cn("flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-black transition-colors disabled:opacity-50",
                                log.resolved ? "bg-white/5 text-white/30 hover:bg-white/10" : "bg-green-500/10 hover:bg-green-500/20 text-green-400")}>
                              <CheckCircle2 className="w-3 h-3" />
                              {log.resolved ? "Unresolve" : "Resolve"}
                            </button>
                          )}
                          {hasData && (
                            <button type="button" onClick={() => setExpandedId(isExpanded ? null : log.id)}
                              className="p-1.5 rounded-lg hover:bg-white/10 text-white/20 hover:text-white/60 transition-colors">
                              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expanded JSON payload */}
                      {isExpanded && hasData && (
                        <div className="px-7 pb-4">
                          <pre className="bg-black/50 rounded-lg p-4 text-[11px] text-green-400/80 font-mono overflow-x-auto max-h-96 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent leading-relaxed">
                            {JSON.stringify(log.data, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-white/30 text-sm">
                Page {page + 1} of {totalPages} · {totalCount.toLocaleString()} logs
              </span>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="border-white/10 text-white/60 hover:bg-white/5">Previous</Button>
                <Button type="button" size="sm" variant="outline" disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  className="border-white/10 text-white/60 hover:bg-white/5">Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Order Journey Modal */}
      {journeyOrderId && (
        <OrderJourneyModal orderId={journeyOrderId} onClose={() => setJourneyOrderId(null)} />
      )}
    </div>
  );
}
