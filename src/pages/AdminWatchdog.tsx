import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { safeRemoveChannel } from "@/lib/safe-realtime";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirmedCall } from "@/components/admin/ConfirmActionProvider";
import { describeTaskChange, type AgentTask } from "@/components/admin/AgentApprovalQueue";
import { agentConfirmKind } from "@/lib/agentConfirmKind";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  DollarSign,
  FileSearch,
  Loader2,
  Play,
  RefreshCw,
  Scale,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  TrendingDown,
  Wrench,
  XCircle,
} from "lucide-react";

interface WorkerTaskRow extends AgentTask {
  result?: Record<string, any> | null;
  approved_by?: string | null;
  executed_at?: string | null;
  target_key?: string | null;
}

interface AgentRunRow {
  id: string;
  agent_name: string;
  provider: string;
  model: string;
  status: string;
  prompt_tokens: number;
  completion_tokens: number;
  estimated_cost_usd: number;
  duration_ms: number;
  error_message: string | null;
  created_at: string;
}

interface SystemMemoryRow {
  id: string;
  memory_key: string;
  category: string;
  summary: string;
  data: Record<string, any> | null;
  confidence: number;
  observations_count: number;
  last_observed_at: string;
}

interface AiInsightRow {
  id: string;
  type: string;
  insight_text: string;
  metadata: Record<string, any> | null;
  is_applied?: boolean;
  created_at: string;
}

interface ReconRunRow {
  id: string;
  kind: string;
  ok: boolean;
  issues: number;
  details: Record<string, any> | null;
  run_at: string;
}

type ActiveTab = "fixes" | "reports";
type TaskStatusFilter = "all" | "awaiting_approval" | "executed" | "rejected" | "failed";

const WATCHDOG_AGENT_FILTERS = [
  { key: "all", label: "All Agents" },
  { key: "ai_fix_proposer", label: "AI Fix Proposer" },
  { key: "ai_margin_watchdog", label: "Margin Watchdog" },
  { key: "reconciliation_explainer", label: "Financial Reconciler" },
  { key: "ops_worker", label: "Ops Worker AI" },
  { key: "sentinel_ai", label: "Sentinel AI" },
  { key: "guardian_ai", label: "Guardian AI" },
];

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function priorityBadgeClass(priority: string): string {
  switch (String(priority || "").toLowerCase()) {
    case "critical":
      return "bg-rose-500/15 text-rose-300 border border-rose-500/30";
    case "high":
      return "bg-amber-500/15 text-amber-300 border border-amber-500/30";
    case "medium":
      return "bg-sky-500/15 text-sky-300 border border-sky-500/30";
    default:
      return "bg-slate-700/60 text-slate-300 border border-slate-600/40";
  }
}

function statusBadgeClass(status: string): string {
  switch (String(status || "").toLowerCase()) {
    case "awaiting_approval":
    case "pending":
      return "bg-amber-500/15 text-amber-300 border border-amber-500/30";
    case "deciding":
      return "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30";
    case "executed":
    case "success":
      return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30";
    case "fallback":
    case "budget_capped":
      return "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30";
    case "rejected":
      return "bg-slate-700/70 text-slate-300 border border-slate-600/50";
    case "failed":
    case "error":
      return "bg-rose-500/15 text-rose-300 border border-rose-500/30";
    default:
      return "bg-slate-800 text-slate-300 border border-slate-700";
  }
}

function normalizeAgentKey(name: string | null | undefined): string {
  const s = String(name || "").toLowerCase();
  if (s.includes("fix_proposer") || s.includes("fix-proposer") || s.includes("fix_proposal")) return "ai_fix_proposer";
  if (s.includes("margin")) return "ai_margin_watchdog";
  if (s.includes("reconcil")) return "reconciliation_explainer";
  if (s.includes("ops_worker") || s.includes("ops-worker")) return "ops_worker";
  if (s.includes("sentinel")) return "sentinel_ai";
  if (s.includes("guardian")) return "guardian_ai";
  return s;
}

const AdminWatchdog = () => {
  const confirmed = useConfirmedCall();

  const [activeTab, setActiveTab] = useState<ActiveTab>("fixes");
  const [taskFilter, setTaskFilter] = useState<TaskStatusFilter>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [tasks, setTasks] = useState<WorkerTaskRow[]>([]);
  const [runs, setRuns] = useState<AgentRunRow[]>([]);
  const [memories, setMemories] = useState<SystemMemoryRow[]>([]);
  const [insights, setInsights] = useState<AiInsightRow[]>([]);
  const [reconRuns, setReconRuns] = useState<ReconRunRow[]>([]);

  const [expandedPayloads, setExpandedPayloads] = useState<Record<string, boolean>>({});
  const [expandedFindings, setExpandedFindings] = useState<Record<string, boolean>>({});
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const [runningAction, setRunningAction] = useState<"margin" | "reconcile" | "patrol" | "fix_proposer" | null>(null);
  const [lastActionBanner, setLastActionBanner] = useState<{
    title: string;
    detail: string;
    tone: "ok" | "warn" | "error";
  } | null>(null);

  const [commandInput, setCommandInput] = useState("");
  const [commandLoading, setCommandLoading] = useState(false);
  const [commandResult, setCommandResult] = useState<{
    reply: string;
    findings: string[];
    model?: string;
    provider?: string;
    queuedCount: number;
    ranCount: number;
  } | null>(null);

  const fetchWatchdogData = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [tasksRes, runsRes, memoryRes, insightsRes, reconRes] = await Promise.all([
        (supabase as any)
          .from("ai_worker_tasks")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
        (supabase as any)
          .from("ai_agent_runs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(120),
        (supabase as any)
          .from("ai_system_memory")
          .select("*")
          .order("last_observed_at", { ascending: false })
          .limit(40),
        (supabase as any)
          .from("ai_insights")
          .select("id, type, insight_text, metadata, is_applied, created_at")
          .in("type", ["margin_watchdog", "agent_finding"])
          .order("created_at", { ascending: false })
          .limit(30),
        (supabase as any)
          .from("wallet_reconciliation_runs")
          .select("id, kind, ok, issues, details, run_at")
          .order("run_at", { ascending: false })
          .limit(10),
      ]);

      if (Array.isArray(tasksRes.data)) setTasks(tasksRes.data as WorkerTaskRow[]);
      if (Array.isArray(runsRes.data)) setRuns(runsRes.data as AgentRunRow[]);
      if (Array.isArray(memoryRes.data)) setMemories(memoryRes.data as SystemMemoryRow[]);
      if (Array.isArray(insightsRes.data)) setInsights(insightsRes.data as AiInsightRow[]);
      if (Array.isArray(reconRes.data)) setReconRuns(reconRes.data as ReconRunRow[]);
    } catch (err: any) {
      console.error("[AdminWatchdog] Failed to load watchdog telemetry:", err);
      toast.error(err?.message || "Failed to load Watchdog Hub telemetry");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchWatchdogData(false);

    const channel = supabase
      .channel("admin_watchdog_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_worker_tasks" }, () => {
        void fetchWatchdogData(true);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ai_agent_runs" }, () => {
        void fetchWatchdogData(true);
      })
      .subscribe();

    return () => {
      safeRemoveChannel(channel);
    };
  }, [fetchWatchdogData]);

  // ── KPI Calculations ────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const now = Date.now();
    const last24hIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const startOfDayIso = startOfDay.toISOString();

    const runs24h = runs.filter((r) => r.created_at >= last24hIso);
    const spend24hUsd = runs24h.reduce((sum, r) => sum + Number(r.estimated_cost_usd || 0), 0);

    const pendingFixes = tasks.filter((t) => t.status === "awaiting_approval").length;
    const autoFixedToday = tasks.filter(
      (t) => t.status === "executed" && (t.executed_at || t.created_at) >= startOfDayIso
    ).length;

    const latestReconIssues = reconRuns[0] && !reconRuns[0].ok ? Number(reconRuns[0].issues || 0) : 0;
    const activeMarginAlerts = insights.filter(
      (i) =>
        i.created_at >= last24hIso &&
        (String(i.metadata?.severity || "").toUpperCase() === "CRITICAL" ||
          String(i.metadata?.severity || "").toUpperCase() === "WARNING" ||
          i.type === "agent_finding")
    ).length;
    const activeFindings = activeMarginAlerts + latestReconIssues + memories.filter((m) => m.last_observed_at >= last24hIso).length;

    return {
      runs24h: runs24h.length,
      spend24hUsd,
      activeFindings,
      pendingFixes,
      autoFixedToday,
    };
  }, [runs, tasks, insights, reconRuns, memories]);

  // ── Filtered Lists ──────────────────────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    if (taskFilter === "all") return tasks;
    return tasks.filter((t) => t.status === taskFilter);
  }, [tasks, taskFilter]);

  const filteredRuns = useMemo(() => {
    if (agentFilter === "all") return runs;
    return runs.filter((r) => normalizeAgentKey(r.agent_name) === agentFilter);
  }, [runs, agentFilter]);

  const fixPlaybooks = useMemo(() => {
    return memories.filter(
      (m) =>
        m.category === "fix_proposal" ||
        m.memory_key.startsWith("fix_proposal:") ||
        m.data?.proposal_type === "fix_proposal" ||
        m.data?.source === "ai_fix_proposer"
    );
  }, [memories]);

  const filteredMemories = useMemo(() => {
    if (agentFilter === "all") return memories;
    return memories.filter((m) => {
      const src = normalizeAgentKey(m.data?.source || m.memory_key);
      if (agentFilter === "ai_fix_proposer")
        return m.category === "fix_proposal" || m.memory_key.startsWith("fix_proposal:") || src === "ai_fix_proposer";
      if (agentFilter === "ai_margin_watchdog") return m.memory_key.includes("margin") || src === "ai_margin_watchdog";
      if (agentFilter === "reconciliation_explainer") return m.memory_key.includes("reconcil") || src === "reconciliation_explainer";
      if (agentFilter === "ops_worker")
        return !m.memory_key.includes("margin") && !m.memory_key.includes("reconcil") && !m.memory_key.startsWith("fix_proposal:");
      return src === agentFilter;
    });
  }, [memories, agentFilter]);

  // ── Quick AI Action Handlers ────────────────────────────────────────────────
  const handleRunMarginWatchdog = async () => {
    if (runningAction) return;
    setRunningAction("margin");
    const toastId = toast.loading("Running Margin Watchdog across SME wholesale & retail tiers...");
    try {
      const { data, error } = await supabase.functions.invoke("ai-margin-watchdog", {
        body: { source: "admin_manual" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const losses = Number(data?.summary?.loss_count ?? 0);
      const razorThin = Number(data?.summary?.razor_thin_count ?? 0);
      const queued = Number(data?.summary?.queued_fix_tasks ?? 0);
      const headline = String(data?.headline || "Margin Watchdog scan complete");

      setLastActionBanner({
        title: `Margin Watchdog: ${data?.severity || "COMPLETE"}`,
        detail: `${headline}${queued > 0 ? ` · ${queued} fix proposal(s) queued for approval` : ""}`,
        tone: losses > 0 ? "error" : razorThin > 0 ? "warn" : "ok",
      });
      toast.success(headline, { id: toastId });
      await fetchWatchdogData(true);
    } catch (err: any) {
      toast.error(err?.message || "Margin Watchdog failed", { id: toastId });
    } finally {
      setRunningAction(null);
    }
  };

  const handleRunFinancialReconciler = async () => {
    if (runningAction) return;
    const ok = await confirmed.confirm({
      title: "Run Financial Reconciler (48h)?",
      description:
        "Compares the last 48h of Paystack payments against orders, wallet credits, double refunds, and double deliveries. Read-only — never moves money.",
      kind: "ops",
      confirmLabel: "Run reconciler",
    });
    if (!ok) return;

    setRunningAction("reconcile");
    const toastId = toast.loading("Running Paystack ↔ Wallet Financial Reconciler...");
    try {
      const { data, error } = await supabase.functions.invoke("wallet-reconcile", {
        body: { source: "admin_manual" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const issues = Number(data?.issues ?? 0);
      const txs = Number(data?.paystack_transactions ?? 0);
      const detail =
        issues === 0
          ? `Checked ${txs} Paystack transactions — 0 discrepancies found.`
          : `Checked ${txs} Paystack transactions — ${issues} issue(s) totaling GH₵${Number(data?.issues_total_ghs || 0).toFixed(2)} need review.`;

      setLastActionBanner({
        title: issues === 0 ? "Financial Reconciler: CLEAN" : `Financial Reconciler: ${issues} ISSUE(S)`,
        detail,
        tone: issues === 0 ? "ok" : "warn",
      });
      toast.success(detail, { id: toastId });
      await fetchWatchdogData(true);
    } catch (err: any) {
      toast.error(err?.message || "Financial Reconciler failed", { id: toastId });
    } finally {
      setRunningAction(null);
    }
  };

  const handleRunFixProposer = async () => {
    if (runningAction) return;
    setRunningAction("fix_proposer");
    const toastId = toast.loading("Running AI Fix Proposer across active incidents...");
    try {
      const { data, error } = await supabase.functions.invoke("ai-fix-proposer", {
        body: { source: "admin_manual" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const playbooks = Number(data?.playbooks_saved ?? 0);
      const queuedCount = Number(data?.queued_tasks ?? 0);
      const headline = String(data?.headline || "AI Fix Proposer analysis complete.");
      setLastActionBanner({
        title: `AI Fix Proposer: ${data?.severity || "COMPLETE"}`,
        detail: `${headline}${playbooks > 0 ? ` · ${playbooks} playbook(s) saved` : ""}${
          queuedCount > 0 ? ` · ${queuedCount} task(s) queued for 2FA approval` : ""
        }`,
        tone: data?.severity === "CRITICAL" ? "error" : data?.severity === "WARNING" ? "warn" : "ok",
      });
      toast.success(headline, { id: toastId });
      setActiveTab("fixes");
      await fetchWatchdogData(true);
    } catch (err: any) {
      toast.error(err?.message || "AI Fix Proposer failed", { id: toastId });
    } finally {
      setRunningAction(null);
    }
  };

  const handleRunAutoFixPatrol = async () => {
    if (runningAction) return;
    setRunningAction("patrol");
    const toastId = toast.loading("Running Ops Worker AI Patrol...");
    try {
      const { data, error } = await supabase.functions.invoke("ops-worker-ai", {
        body: { mode: "patrol", source: "admin_manual" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const queuedCount = Array.isArray(data?.queued) ? data.queued.length : 0;
      const summary = String(data?.summary || "AI patrol complete.");
      setLastActionBanner({
        title: `AI Patrol: ${data?.health_status || "COMPLETE"}`,
        detail: `${summary}${queuedCount > 0 ? ` · ${queuedCount} new fix task(s) queued` : ""}`,
        tone: data?.health_status === "CRITICAL" ? "error" : data?.health_status === "DEGRADED" ? "warn" : "ok",
      });
      toast.success(summary, { id: toastId });
      await fetchWatchdogData(true);
    } catch (err: any) {
      toast.error(err?.message || "AI Auto-Fix Patrol failed", { id: toastId });
    } finally {
      setRunningAction(null);
    }
  };

  const handleAskWatchdogCommand = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = commandInput.trim();
    if (!trimmed || commandLoading) return;

    setCommandLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ops-worker-ai", {
        body: { mode: "command", command: trimmed, instruction: trimmed },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const queuedCount = Array.isArray(data?.queued) ? data.queued.length : 0;
      const ranCount = Array.isArray(data?.ran) ? data.ran.length : 0;
      setCommandResult({
        reply: String(data?.reply || "Watchdog AI completed analysis."),
        findings: Array.isArray(data?.findings) ? data.findings : [],
        model: data?.model,
        provider: data?.provider,
        queuedCount,
        ranCount,
      });
      setCommandInput("");
      toast.success(
        queuedCount > 0
          ? `Watchdog AI answered and queued ${queuedCount} fix proposal(s) for your approval`
          : "Watchdog AI diagnosis complete"
      );
      await fetchWatchdogData(true);
    } catch (err: any) {
      toast.error(err?.message || "Watchdog AI command failed");
    } finally {
      setCommandLoading(false);
    }
  };

  // ── Task Approve / Reject (2FA-enforced via ai-task-decide) ─────────────────
  const handleDecideTask = async (task: WorkerTaskRow, approve: boolean) => {
    if (busyTaskId) return;
    const change = describeTaskChange(task);

    const ok = await confirmed.confirm({
      title: approve ? `Approve & Auto-Fix: ${task.title}` : `Reject proposal: ${task.title}`,
      description: approve
        ? [
            `${change.line}.`,
            change.names && `Accounts: ${change.names}.`,
            change.sms && `SMS text: "${change.sms}"`,
            `Proposed by ${task.agent_name}${task.reasoning ? ` (${task.reasoning})` : ""}.`,
          ]
            .filter(Boolean)
            .join(" ")
        : `This marks the proposal as rejected and changes nothing in the system.`,
      kind: approve ? agentConfirmKind(task.task_type) : "ops",
      confirmLabel: approve ? "Approve & Auto-Fix" : "Reject Proposal",
      ...(approve && change.recipients != null ? { orders: change.recipients } : {}),
      ...(approve && change.amountGhs != null ? { amountGhs: change.amountGhs } : {}),
    });
    if (!ok) return;

    setBusyTaskId(task.id);
    try {
      const { data, error } = await supabase.functions.invoke("ai-task-decide", {
        body: { task_id: task.id, approve },
      });

      if ((error as any)?.context?.status === 409) {
        toast.warning("This task was already decided by another admin.");
      } else if (error || data?.error) {
        toast.error(data?.error || error?.message || "Failed to process task decision");
      } else if (approve && data?.ok === false) {
        toast.error(`Approved but blocked by zero-loss guard: ${data?.error || "refused"}`);
      } else {
        toast.success(approve ? "Approved and executed safely!" : "Proposal rejected.");
      }
      await fetchWatchdogData(true);
    } catch (err: any) {
      toast.error(err?.message || "Decision failed");
    } finally {
      setBusyTaskId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0 shadow-[0_0_24px_rgba(6,182,212,0.18)]">
            <ShieldAlert className="h-6 w-6 text-cyan-400" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                Watchdog Reports &amp; AI Auto-Fix Hub
              </h1>
              <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold text-[10px] uppercase tracking-wider">
                Zero-Loss Guards Active
              </Badge>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Centralized margin protection, financial reconciliation, AI patrol telemetry, and 2FA-gated auto-fix approvals.
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          onClick={() => void fetchWatchdogData(true)}
          disabled={refreshing || loading}
          className="self-start lg:self-auto rounded-xl border-slate-700 bg-slate-900/80 text-slate-200 hover:bg-slate-800 hover:text-white gap-2"
        >
          <RefreshCw className={cn("h-4 w-4", (refreshing || loading) && "animate-spin")} />
          Refresh Live Data
        </Button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="bg-slate-900/70 border-slate-800 text-slate-100">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Total Watchdog Runs (24h)
              </p>
              <p className="text-3xl font-black text-white mt-1 tabular-nums">{kpis.runs24h}</p>
              <p className="text-xs text-cyan-400 mt-1 flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5" />${kpis.spend24hUsd.toFixed(4)} AI spend (24h)
              </p>
            </div>
            <div className="h-11 w-11 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <Activity className="h-5 w-5 text-cyan-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/70 border-slate-800 text-slate-100">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Active Findings / Alerts
              </p>
              <p className="text-3xl font-black text-white mt-1 tabular-nums">{kpis.activeFindings}</p>
              <p className="text-xs text-amber-400 mt-1">
                Margin, reconciliation &amp; memory signals
              </p>
            </div>
            <div className="h-11 w-11 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/70 border-slate-800 text-slate-100">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Pending AI Fixes
              </p>
              <p className="text-3xl font-black text-white mt-1 tabular-nums">{kpis.pendingFixes}</p>
              <p className="text-xs text-rose-400 mt-1">
                Awaiting 2FA admin approval
              </p>
            </div>
            <div className="h-11 w-11 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
              <Wrench className="h-5 w-5 text-rose-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/70 border-slate-800 text-slate-100">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Auto-Fixed Today
              </p>
              <p className="text-3xl font-black text-white mt-1 tabular-nums">{kpis.autoFixedToday}</p>
              <p className="text-xs text-emerald-400 mt-1">
                Safely executed &amp; audit-logged
              </p>
            </div>
            <div className="h-11 w-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick AI Action Bar + Interactive Command Box */}
      <Card className="bg-slate-900/80 border-slate-800 text-slate-100 overflow-hidden">
        <CardHeader className="border-b border-slate-800/80 bg-slate-950/60 pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2 text-white">
                <Sparkles className="h-4 w-4 text-cyan-400" />
                Quick Watchdog Actions &amp; AI Diagnostics
              </CardTitle>
              <CardDescription className="text-xs text-slate-400 mt-0.5">
                Trigger on-demand watchdog audits or instruct Ops Worker AI to diagnose incidents and propose safe fixes.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                onClick={handleRunMarginWatchdog}
                disabled={runningAction !== null}
                className="rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs h-9 px-4 gap-2"
              >
                {runningAction === "margin" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5" />
                )}
                Run Margin Watchdog
              </Button>

              <Button
                onClick={handleRunFinancialReconciler}
                disabled={runningAction !== null}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs h-9 px-4 gap-2"
              >
                {runningAction === "reconcile" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Scale className="h-3.5 w-3.5" />
                )}
                Run Financial Reconciler
              </Button>

              <Button
                onClick={handleRunFixProposer}
                disabled={runningAction !== null}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs h-9 px-4 gap-2"
              >
                {runningAction === "fix_proposer" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wrench className="h-3.5 w-3.5" />
                )}
                Run AI Fix Proposer
              </Button>

              <Button
                onClick={handleRunAutoFixPatrol}
                disabled={runningAction !== null}
                className="rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs h-9 px-4 gap-2"
              >
                {runningAction === "patrol" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Run AI Auto-Fix Patrol
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          {lastActionBanner && (
            <div
              className={cn(
                "rounded-xl px-4 py-3 text-xs border flex items-start justify-between gap-3",
                lastActionBanner.tone === "error"
                  ? "bg-rose-500/10 border-rose-500/30 text-rose-200"
                  : lastActionBanner.tone === "warn"
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-200"
                  : "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
              )}
            >
              <div>
                <p className="font-bold">{lastActionBanner.title}</p>
                <p className="opacity-90 mt-0.5">{lastActionBanner.detail}</p>
              </div>
              <button
                type="button"
                onClick={() => setLastActionBanner(null)}
                className="text-xs opacity-70 hover:opacity-100"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Ask Watchdog AI Command Bar */}
          <form onSubmit={handleAskWatchdogCommand} className="space-y-2">
            <label htmlFor="watchdog-ai-command" className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5 text-cyan-400" />
              Ask Watchdog AI to Diagnose &amp; Fix
            </label>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                id="watchdog-ai-command"
                type="text"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                placeholder="e.g. Check why MTN orders are slow right now and propose a safe SME provider rebalance..."
                className="flex-1 h-10 rounded-xl border border-slate-700 bg-slate-950/90 px-3.5 text-sm text-white placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
              <Button
                type="submit"
                disabled={commandLoading || !commandInput.trim()}
                className="h-10 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs gap-2 shrink-0"
              >
                {commandLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Diagnose &amp; Propose
              </Button>
            </div>
          </form>

          {commandResult && (
            <div className="rounded-xl border border-cyan-500/25 bg-slate-950/90 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
                  <Bot className="h-4 w-4" />
                  Watchdog AI Diagnosis
                  {commandResult.model && (
                    <Badge className="bg-slate-800 text-slate-300 border border-slate-700 text-[10px]">
                      {commandResult.model}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  {commandResult.queuedCount > 0 && (
                    <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      {commandResult.queuedCount} queued for approval
                    </Badge>
                  )}
                  {commandResult.ranCount > 0 && (
                    <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      {commandResult.ranCount} alert(s) logged
                    </Badge>
                  )}
                </div>
              </div>
              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{commandResult.reply}</p>
              {commandResult.findings.length > 0 && (
                <ul className="space-y-1 border-t border-slate-800 pt-2.5">
                  {commandResult.findings.map((f, idx) => (
                    <li key={idx} className="text-xs text-slate-300 flex items-start gap-2">
                      <span className="text-cyan-400 mt-0.5">•</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Tabs Switcher */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab("fixes")}
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors",
            activeTab === "fixes"
              ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
              : "bg-slate-900/60 text-slate-400 border border-slate-800 hover:text-slate-200"
          )}
        >
          <Wrench className="h-4 w-4" />
          Available &amp; Pending AI Fixes
          {kpis.pendingFixes > 0 && (
            <span className="rounded-full bg-amber-500/20 text-amber-300 px-2 py-0.5 text-[10px] font-black tabular-nums">
              {kpis.pendingFixes}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("reports")}
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors",
            activeTab === "reports"
              ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
              : "bg-slate-900/60 text-slate-400 border border-slate-800 hover:text-slate-200"
          )}
        >
          <FileSearch className="h-4 w-4" />
          Watchdog Reports &amp; Findings
          <span className="rounded-full bg-slate-800 text-slate-300 px-2 py-0.5 text-[10px] font-bold tabular-nums">
            {runs.length}
          </span>
        </button>
      </div>

      {/* TAB 1: Available & Pending AI Fixes */}
      {activeTab === "fixes" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: "all", label: `All (${tasks.length})` },
                  { id: "awaiting_approval", label: `Pending (${tasks.filter((t) => t.status === "awaiting_approval").length})` },
                  { id: "executed", label: `Executed (${tasks.filter((t) => t.status === "executed").length})` },
                  { id: "rejected", label: `Rejected (${tasks.filter((t) => t.status === "rejected").length})` },
                  { id: "failed", label: `Failed (${tasks.filter((t) => t.status === "failed").length})` },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setTaskFilter(pill.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border",
                    taskFilter === pill.id
                      ? "bg-slate-800 text-white border-cyan-500/40"
                      : "bg-slate-900/50 text-slate-400 border-slate-800 hover:text-slate-200"
                  )}
                >
                  {pill.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-slate-500">
              All approvals execute atomically via 2FA-verified <code className="text-slate-300">ai-task-decide</code>
            </span>
          </div>

          {loading ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-12 text-center text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-cyan-400" />
              <p className="text-xs">Loading AI fix proposals...</p>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center">
              <ShieldCheck className="h-8 w-8 text-emerald-400/70 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-200">No AI fix tasks in this view</p>
              <p className="text-xs text-slate-400 mt-1">
                Run Margin Watchdog or AI Auto-Fix Patrol above to inspect live telemetry and generate safe proposals.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTasks.map((task) => {
                const change = describeTaskChange(task);
                const isExpanded = Boolean(expandedPayloads[task.id]);
                const isPending = task.status === "awaiting_approval";

                return (
                  <Card
                    key={task.id}
                    className={cn(
                      "bg-slate-900/75 border text-slate-100 transition-colors",
                      isPending ? "border-amber-500/30" : "border-slate-800"
                    )}
                  >
                    <CardContent className="p-4 sm:p-5 space-y-3">
                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={cn("text-[10px] font-bold uppercase", priorityBadgeClass(task.priority))}>
                              {task.priority}
                            </Badge>
                            <Badge className={cn("text-[10px] font-bold uppercase", statusBadgeClass(task.status))}>
                              {task.status.replace(/_/g, " ")}
                            </Badge>
                            <span className="text-[11px] font-mono text-cyan-400">{task.agent_name}</span>
                            <span className="text-[11px] text-slate-500">·</span>
                            <span className="text-[11px] text-slate-400 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDateTime(task.created_at)}
                            </span>
                          </div>
                          <h3 className="text-sm sm:text-base font-bold text-white leading-snug">{task.title}</h3>
                          <p className="text-xs text-slate-300">
                            <span className="font-semibold text-cyan-300">Proposed Change: </span>
                            {change.line}
                            {change.names ? ` (${change.names})` : ""}
                          </p>
                          {task.reasoning && (
                            <p className="text-xs text-slate-400 leading-relaxed">{task.reasoning}</p>
                          )}
                        </div>

                        {isPending && (
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              size="sm"
                              disabled={busyTaskId === task.id}
                              onClick={() => void handleDecideTask(task, true)}
                              className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs gap-1.5 h-9 px-4"
                            >
                              {busyTaskId === task.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              )}
                              Approve &amp; Auto-Fix
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyTaskId === task.id}
                              onClick={() => void handleDecideTask(task, false)}
                              className="rounded-xl border-slate-700 bg-slate-900 text-slate-300 hover:bg-rose-600 hover:text-white hover:border-rose-600 font-bold text-xs gap-1.5 h-9 px-3.5"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Execution Result (if decided) */}
                      {task.result && (
                        <div
                          className={cn(
                            "rounded-xl px-3.5 py-2.5 text-xs border",
                            task.status === "executed"
                              ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-200"
                              : task.status === "failed"
                              ? "bg-rose-500/10 border-rose-500/25 text-rose-200"
                              : "bg-slate-950/70 border-slate-800 text-slate-300"
                          )}
                        >
                          <span className="font-bold">Result: </span>
                          {task.result.error
                            ? String(task.result.error)
                            : task.result.note
                            ? String(task.result.note)
                            : JSON.stringify(task.result.details ?? task.result)}
                          {task.executed_at && (
                            <span className="ml-2 text-[11px] opacity-75">({formatDateTime(task.executed_at)})</span>
                          )}
                        </div>
                      )}

                      {/* Payload Preview Toggle */}
                      <div>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedPayloads((prev) => ({ ...prev, [task.id]: !prev[task.id] }))
                          }
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-cyan-300 transition-colors"
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          {isExpanded ? "Hide payload preview" : "Show payload preview"}
                        </button>
                        {isExpanded && (
                          <pre className="mt-2 rounded-xl bg-slate-950 border border-slate-800 p-3 text-[11px] text-slate-300 overflow-x-auto font-mono">
                            {JSON.stringify(task.payload ?? {}, null, 2)}
                          </pre>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Proposed Fix Playbooks from ai_fix_proposer */}
          {fixPlaybooks.length > 0 && (
            <div className="space-y-3 pt-4 border-t border-slate-800/80">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-emerald-400" />
                    AI Fix Proposals &amp; Root-Cause Playbooks
                  </h2>
                  <p className="text-xs text-slate-400">
                    Generated by <code className="text-emerald-300">ai_fix_proposer</code> from reconciliation, margin, provider &amp; stuck-order incidents.
                  </p>
                </div>
                <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px]">
                  {fixPlaybooks.length} playbook(s)
                </Badge>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {fixPlaybooks.map((pb) => {
                  const d = pb.data || {};
                  const severity = String(d.severity || "high").toLowerCase();
                  const steps: string[] = Array.isArray(d.recommended_steps) ? d.recommended_steps : [];
                  const linkedTaskType = String(d.safe_action?.type || d.action_outcome?.task_type || "");
                  const linkedTask = tasks.find(
                    (t) =>
                      t.status === "awaiting_approval" &&
                      normalizeAgentKey(t.agent_name) === "ai_fix_proposer" &&
                      (linkedTaskType ? t.task_type === linkedTaskType : false)
                  );

                  return (
                    <Card
                      key={pb.id}
                      className="bg-slate-900/80 border border-emerald-500/25 text-slate-100 flex flex-col justify-between"
                    >
                      <CardContent className="p-4 sm:p-5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge className={cn("text-[10px] font-bold uppercase", priorityBadgeClass(severity))}>
                              {severity}
                            </Badge>
                            {d.incident_type && (
                              <Badge className="bg-slate-800 text-cyan-300 border border-slate-700 text-[10px] uppercase">
                                {String(d.incident_type).replace(/_/g, " ")}
                              </Badge>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400">{formatDateTime(pb.last_observed_at)}</span>
                        </div>

                        <h3 className="text-sm font-bold text-white leading-snug">
                          {String(d.title || pb.summary)}
                        </h3>

                        {d.root_cause && (
                          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 space-y-1">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Root Cause</p>
                            <p className="text-xs text-slate-200 leading-relaxed">{String(d.root_cause)}</p>
                          </div>
                        )}

                        {d.impact && (
                          <div className="rounded-xl bg-rose-500/5 border border-rose-500/20 p-3 space-y-1">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-rose-300">Impact</p>
                            <p className="text-xs text-rose-100/90 leading-relaxed">{String(d.impact)}</p>
                          </div>
                        )}

                        {steps.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                              Recommended Fix Steps
                            </p>
                            <ol className="space-y-1 list-decimal list-inside text-xs text-slate-300">
                              {steps.map((step, idx) => (
                                <li key={idx} className="leading-relaxed">
                                  {step}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}

                        {d.guardrail_note && (
                          <p className="text-[11px] text-emerald-300/80 flex items-center gap-1.5">
                            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                            <span>{String(d.guardrail_note)}</span>
                          </p>
                        )}

                        {linkedTask && (
                          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
                            <Button
                              size="sm"
                              disabled={busyTaskId === linkedTask.id}
                              onClick={() => void handleDecideTask(linkedTask, true)}
                              className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs gap-1.5 h-8 px-3.5"
                            >
                              {busyTaskId === linkedTask.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              )}
                              Approve &amp; Auto-Fix
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyTaskId === linkedTask.id}
                              onClick={() => void handleDecideTask(linkedTask, false)}
                              className="rounded-xl border-slate-700 bg-slate-900 text-slate-300 hover:bg-rose-600 hover:text-white hover:border-rose-600 font-bold text-xs gap-1.5 h-8 px-3"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Watchdog Reports & Findings */}
      {activeTab === "reports" && (
        <div className="space-y-6">
          {/* Agent Filter Pills */}
          <div className="flex flex-wrap items-center gap-2">
            {WATCHDOG_AGENT_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setAgentFilter(f.key)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border",
                  agentFilter === f.key
                    ? "bg-slate-800 text-white border-cyan-500/40"
                    : "bg-slate-900/50 text-slate-400 border-slate-800 hover:text-slate-200"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Left: Structured System Memory & Watchdog Insights */}
            <div className="space-y-4">
              <Card className="bg-slate-900/75 border-slate-800 text-slate-100">
                <CardHeader className="border-b border-slate-800/80 pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2 text-white">
                    <ShieldAlert className="h-4 w-4 text-amber-400" />
                    Structured Watchdog Memory &amp; Findings
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-400">
                    Latest snapshots from <code className="text-slate-300">ai_system_memory</code>,{" "}
                    <code className="text-slate-300">ai_insights</code> &amp;{" "}
                    <code className="text-slate-300">wallet_reconciliation_runs</code>
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 space-y-3 max-h-[640px] overflow-y-auto">
                  {/* Latest Financial Reconciliation Runs */}
                  {(agentFilter === "all" || agentFilter === "reconciliation_explainer") &&
                    reconRuns.slice(0, 3).map((rec) => {
                      const key = `recon:${rec.id}`;
                      const open = Boolean(expandedFindings[key]);
                      return (
                        <div key={key} className="rounded-xl border border-indigo-500/25 bg-slate-950/70 p-3.5 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Badge className="bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[10px]">
                                FINANCIAL RECONCILER
                              </Badge>
                              <Badge className={cn("text-[10px]", rec.ok ? statusBadgeClass("success") : statusBadgeClass("failed"))}>
                                {rec.ok ? "CLEAN" : `${rec.issues} ISSUE(S)`}
                              </Badge>
                            </div>
                            <span className="text-[11px] text-slate-400">{formatDateTime(rec.run_at)}</span>
                          </div>
                          <p className="text-xs text-slate-200">
                            Checked {Number(rec.details?.paystack_transactions ?? 0)} Paystack tx(s) (
                            {Number(rec.details?.window_hours ?? 48)}h window) ·{" "}
                            {rec.ok
                              ? "All ledgers balanced."
                              : `GH₵${Number(rec.details?.issues_total_ghs ?? 0).toFixed(2)} flagged for review.`}
                          </p>
                          <button
                            type="button"
                            onClick={() => setExpandedFindings((p) => ({ ...p, [key]: !p[key] }))}
                            className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:underline"
                          >
                            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            {open ? "Hide full report" : "View full report"}
                          </button>
                          {open && (
                            <pre className="rounded-lg bg-slate-900 border border-slate-800 p-2.5 text-[11px] text-slate-300 overflow-x-auto font-mono">
                              {JSON.stringify(rec.details ?? {}, null, 2)}
                            </pre>
                          )}
                        </div>
                      );
                    })}

                  {/* System Memory Entries */}
                  {filteredMemories.map((mem) => {
                    const key = `mem:${mem.id}`;
                    const open = Boolean(expandedFindings[key]);
                    return (
                      <div key={key} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-cyan-500/10 text-cyan-300 border border-cyan-500/25 text-[10px] uppercase">
                              {mem.category.replace(/_/g, " ")}
                            </Badge>
                            <span className="text-[11px] font-mono text-slate-400">{mem.memory_key}</span>
                          </div>
                          <span className="text-[11px] text-slate-500">
                            {Math.round(Number(mem.confidence || 0) * 100)}% conf · {mem.observations_count}x ·{" "}
                            {formatDateTime(mem.last_observed_at)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-200 leading-relaxed">{mem.summary}</p>
                        {mem.data && Object.keys(mem.data).length > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => setExpandedFindings((p) => ({ ...p, [key]: !p[key] }))}
                              className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:underline"
                            >
                              {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                              {open ? "Hide finding data" : "Inspect full finding data"}
                            </button>
                            {open && (
                              <pre className="rounded-lg bg-slate-900 border border-slate-800 p-2.5 text-[11px] text-slate-300 overflow-x-auto font-mono">
                                {JSON.stringify(mem.data, null, 2)}
                              </pre>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* Recent Margin Watchdog / Agent Insights */}
                  {(agentFilter === "all" || agentFilter === "ai_margin_watchdog") &&
                    insights.slice(0, 10).map((ins) => {
                      const key = `ins:${ins.id}`;
                      const open = Boolean(expandedFindings[key]);
                      return (
                        <div key={key} className="rounded-xl border border-amber-500/20 bg-slate-950/70 p-3.5 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] uppercase">
                                {ins.type.replace(/_/g, " ")}
                              </Badge>
                              {ins.metadata?.severity && (
                                <Badge className={cn("text-[10px]", priorityBadgeClass(ins.metadata.severity === "CRITICAL" ? "critical" : "medium"))}>
                                  {String(ins.metadata.severity)}
                                </Badge>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-500">{formatDateTime(ins.created_at)}</span>
                          </div>
                          <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">{ins.insight_text}</p>
                          {ins.metadata && (
                            <>
                              <button
                                type="button"
                                onClick={() => setExpandedFindings((p) => ({ ...p, [key]: !p[key] }))}
                                className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:underline"
                              >
                                {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                {open ? "Hide metadata" : "Inspect full findings"}
                              </button>
                              {open && (
                                <pre className="rounded-lg bg-slate-900 border border-slate-800 p-2.5 text-[11px] text-slate-300 overflow-x-auto font-mono">
                                  {JSON.stringify(ins.metadata, null, 2)}
                                </pre>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}

                  {filteredMemories.length === 0 && insights.length === 0 && reconRuns.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-8">No findings recorded yet for this filter.</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right: AI Agent Run Telemetry */}
            <div className="space-y-4">
              <Card className="bg-slate-900/75 border-slate-800 text-slate-100">
                <CardHeader className="border-b border-slate-800/80 pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-2 text-white">
                    <Cpu className="h-4 w-4 text-cyan-400" />
                    Watchdog Execution Log (<code className="text-cyan-300 font-mono text-xs">ai_agent_runs</code>)
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-400">
                    Model routing, latency, token usage, USD cost, and failover status across all watchdog agents.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0 max-h-[640px] overflow-y-auto divide-y divide-slate-800/80">
                  {filteredRuns.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-10">No agent runs recorded for this filter.</p>
                  ) : (
                    filteredRuns.map((run) => (
                      <div key={run.id} className="p-4 hover:bg-slate-800/30 transition-colors space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white font-mono">{run.agent_name}</span>
                            <Badge className={cn("text-[10px] font-bold uppercase", statusBadgeClass(run.status))}>
                              {run.status}
                            </Badge>
                          </div>
                          <span className="text-[11px] text-slate-400">{formatDateTime(run.created_at)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                          <span>
                            Model: <strong className="text-slate-200">{run.model}</strong> ({run.provider})
                          </span>
                          <span>
                            Tokens:{" "}
                            <strong className="text-slate-200 tabular-nums">
                              {(Number(run.prompt_tokens || 0) + Number(run.completion_tokens || 0)).toLocaleString()}
                            </strong>
                          </span>
                          <span>
                            Cost:{" "}
                            <strong className="text-emerald-300 tabular-nums">
                              ${Number(run.estimated_cost_usd || 0).toFixed(5)}
                            </strong>
                          </span>
                          <span>
                            Duration: <strong className="text-slate-200 tabular-nums">{run.duration_ms}ms</strong>
                          </span>
                        </div>
                        {run.error_message && (
                          <p className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5 font-mono">
                            {run.error_message}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminWatchdog;
