import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Bell, Send, Trash2, Loader2, MessageSquare, CheckCircle2,
  XCircle, Phone, BookTemplate, Save, Clock, RefreshCw,
  Users, Calendar, ChevronDown, ChevronUp, Sparkles, AlertCircle,
  Search, ShieldAlert, Check, Terminal, ExternalLink
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type TargetType = "all" | "agents" | "sub_agents" | "parent_agents" | "users" | "pending_orders" | "all_order_phones";

interface TargetFilters {
  inactive_days?: number;
  min_balance?: number;
  max_balance?: number;
}

interface SmsTemplate {
  id: string;
  key: string;
  label: string;
  body: string;
  is_active: boolean;
  created_at: string;
}

interface ScheduledBroadcast {
  id: string;
  title: string;
  message: string;
  target_type: string;
  target_filters: TargetFilters;
  scheduled_at: string;
  status: string;
  result?: Record<string, unknown>;
  created_at: string;
}

interface NotificationRow {
  id: string;
  title: string;
  message: string;
  target_type: string;
  created_at: string;
}

interface SmsResult {
  sent: number;
  failed: number;
  skipped_invalid_or_empty?: number;
  total_recipients: number;
  valid_numbers?: number;
  opt_out_count?: number;
  failures?: Array<{ phone: string; reason: string }>;
}

interface SmsLog {
  id: string;
  recipient: string;
  sender_id: string;
  body: string;
  type: string;
  status: "success" | "failed";
  error_message: string | null;
  agent_id: string | null;
  created_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SMS_LIMIT = 160;

const TARGET_LABELS: Record<string, string> = {
  all: "Everyone (registered profiles)",
  agents: "All Agents & Sub-agents",
  sub_agents: "Sub-agents Only",
  parent_agents: "Parent Agents Only",
  users: "Customers Only",
  pending_orders: "Pending Order Phones",
  all_order_phones: "All Order Recipients (broadest reach)",
};

const TOKENS = [
  { label: "{{name}}", desc: "Recipient's full name" },
  { label: "{{balance}}", desc: "Agent wallet balance" },
];

const TYPE_COLORS: Record<string, string> = {
  broadcast: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  payment_success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  order_failed: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  wallet_topup: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  withdrawal_request: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  withdrawal_completed: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  manual_credit: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  low_balance: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  utility_paid: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
};

// ─── Component ────────────────────────────────────────────────────────────────

const AdminNotificationsPage = () => {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<"compose" | "history" | "sms_logs">("compose");

  // Compose
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [targetType, setTargetType] = useState<TargetType>("all");
  const [targetFilters, setTargetFilters] = useState<TargetFilters>({});
  const [showFilters, setShowFilters] = useState(false);

  // SMS
  const [sendSms, setSendSms] = useState(false);
  const [testPhone, setTestPhone] = useState("");

  // Scheduling
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");

  // Templates
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  // Estimate
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<{ count: number; optOuts: number } | null>(null);

  // Send state
  const [sending, setSending] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [lastResult, setLastResult] = useState<SmsResult | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Data
  const [scheduledBroadcasts, setScheduledBroadcasts] = useState<ScheduledBroadcast[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Real-time SMS Logs State
  const [smsLogs, setSmsLogs] = useState<SmsLog[]>([]);
  const [smsLogsLoading, setSmsLogsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failed">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const smsBody = (title ?? "").trim() ? `${(title ?? "").trim()}\n${(message ?? "").trim()}` : (message ?? "").trim();
  const smsChars = smsBody.length;
  const smsSegments = Math.ceil(smsChars / SMS_LIMIT) || 1;

  // ── Data fetching ────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    const [notifRes, tmplRes, schedRes] = await Promise.all([
      supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(50),
      (supabase as any).from("sms_templates").select("*").order("created_at", { ascending: false }),
      (supabase as any).from("scheduled_broadcasts").select("*")
        .in("status", ["pending", "processing"])
        .order("scheduled_at", { ascending: true }),
    ]);
    setNotifications((notifRes.data || []) as NotificationRow[]);
    setTemplates((tmplRes.data || []) as SmsTemplate[]);
    setScheduledBroadcasts((schedRes.data || []) as ScheduledBroadcast[]);
    setLoading(false);
  }, []);

  const fetchSmsLogs = useCallback(async () => {
    setSmsLogsLoading(true);
    const { data, error } = await supabase
      .from("sms_logs" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (!error && data) {
      setSmsLogs(data as SmsLog[]);
    }
    setSmsLogsLoading(false);
  }, []);

  useEffect(() => { 
    fetchAll(); 
    fetchSmsLogs();
  }, [fetchAll, fetchSmsLogs]);

  // Real-time subscription to sms_logs
  useEffect(() => {
    const channel = supabase
      .channel("sms-logs-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sms_logs" }, (payload) => {
        const newLog = payload.new as SmsLog;
        setSmsLogs((prev) => [newLog, ...prev].slice(0, 100));
        
        toast({
          title: newLog.status === "success" ? "⚡ Live SMS Dispatched" : "⚠️ Live SMS Failure",
          description: `${newLog.recipient} · ${newLog.type}`,
          variant: newLog.status === "success" ? "default" : "destructive"
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [toast]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const insertToken = (token: string) => {
    const el = textareaRef.current;
    if (!el) { setMessage((m) => m + token); return; }
    const start = el.selectionStart ?? message.length;
    const end = el.selectionEnd ?? message.length;
    const next = message.slice(0, start) + token + message.slice(end);
    setMessage(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  };

  const loadTemplate = (tmpl: SmsTemplate) => {
    setTitle(tmpl.label ?? "");
    setMessage(tmpl.body ?? "");
    toast({ title: `Template "${tmpl.label}" loaded` });
  };

  const resetEstimate = () => setEstimate(null);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleEstimate = async () => {
    setEstimating(true);
    setEstimate(null);
    const { data, error } = await supabase.functions.invoke("admin-send-sms", {
      body: {
        message: message || "estimate",
        target_type: targetType,
        target_filters: targetFilters,
        dry_run: true,
      },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    setEstimating(false);
    if (error || data?.error) {
      toast({ title: "Estimate failed", description: data?.error || error?.message, variant: "destructive" });
    } else {
      setEstimate({ count: data.estimated_recipients ?? 0, optOuts: data.opt_out_count ?? 0 });
    }
  };

  const handleTestSms = async () => {
    if (!testPhone.trim()) { toast({ title: "Enter a test phone number", variant: "destructive" }); return; }
    if (!message.trim()) { toast({ title: "Write a message first", variant: "destructive" }); return; }
    setTestSending(true);
    const { data, error } = await supabase.functions.invoke("admin-send-sms", {
      body: { title: title.trim(), message: message.trim(), target_type: "test", test_phone: testPhone.trim() },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    setTestSending(false);
    if (error || data?.error) {
      toast({ title: "Test SMS failed", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: `Test SMS sent to ${testPhone}` });
    }
  };

  const handleSend = async () => {
    if (!title.trim() || !message.trim()) {
      toast({ title: "Title and message are required", variant: "destructive" }); return;
    }

    // Schedule mode
    if (scheduleEnabled) {
      if (!scheduledAt) { toast({ title: "Pick a date/time to schedule", variant: "destructive" }); return; }
      const at = new Date(scheduledAt);
      if (at <= new Date()) { toast({ title: "Scheduled time must be in the future", variant: "destructive" }); return; }
      const { error } = await (supabase as any).from("scheduled_broadcasts").insert({
        title: title.trim(),
        message: message.trim(),
        target_type: targetType,
        target_filters: targetFilters,
        scheduled_at: at.toISOString(),
        status: "pending",
        created_by: user?.id,
      });
      if (error) { toast({ title: "Failed to schedule", description: error.message, variant: "destructive" }); return; }
      toast({ title: "Broadcast scheduled!", description: `Will send on ${at.toLocaleString()}` });
      setTitle(""); setMessage(""); setScheduledAt(""); setScheduleEnabled(false);
      await fetchAll();
      return;
    }

    // Immediate send
    setSending(true);
    setLastResult(null);

    // Save to notification history
    await supabase.from("notifications").insert({
      title: title.trim(), message: message.trim(), target_type: targetType, created_by: user?.id,
    });

    if (sendSms) {
      const { data: smsData, error: smsError } = await supabase.functions.invoke("admin-send-sms", {
        body: {
          title: title.trim(),
          message: message.trim(),
          target_type: targetType,
          target_filters: targetFilters,
        },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (smsError) {
        toast({ title: "Notification saved, SMS failed", description: smsError.message, variant: "destructive" });
      } else if (smsData?.success) {
        setLastResult(smsData as SmsResult);
        toast({ title: `SMS sent to ${smsData.sent} of ${smsData.total_recipients} recipients` });
        fetchSmsLogs();
      } else if (smsData?.error) {
        toast({ title: "SMS error", description: smsData.error, variant: "destructive" });
      }
    } else {
      toast({ title: "Notification sent!" });
    }

    setTitle(""); setMessage(""); resetEstimate();
    await fetchAll();
    setSending(false);
  };

  const handleRetryFailed = async () => {
    if (!lastResult?.failures?.length) return;
    setRetrying(true);
    const phones = lastResult.failures.map((f) => f.phone);
    const { data, error } = await supabase.functions.invoke("admin-send-sms", {
      body: {
        message: smsBody || message,
        retry_phones: phones,
      },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    setRetrying(false);
    if (error || data?.error) {
      toast({ title: "Retry failed", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: `Retry: sent ${data.sent} of ${phones.length}` });
      setLastResult((prev) => prev ? { ...prev, sent: prev.sent + data.sent, failed: data.failed, failures: data.failures } : prev);
      fetchSmsLogs();
    }
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim() || !message.trim()) {
      toast({ title: "Template name and message are required", variant: "destructive" }); return;
    }
    setSavingTemplate(true);
    const { error } = await (supabase as any).from("sms_templates").insert({
      name: templateName.trim(), title: title.trim(), message: message.trim(),
    });
    setSavingTemplate(false);
    if (error) { toast({ title: "Failed to save template", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Template "${templateName}" saved` });
    setTemplateName(""); setShowSaveTemplate(false);
    await fetchAll();
  };

  const handleDeleteTemplate = async (id: string) => {
    await (supabase as any).from("sms_templates").delete().eq("id", id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  const handleCancelScheduled = async (id: string) => {
    await (supabase as any).from("scheduled_broadcasts").update({ status: "cancelled" }).eq("id", id);
    setScheduledBroadcasts((prev) => prev.filter((b) => b.id !== id));
    toast({ title: "Broadcast cancelled" });
  };

  const handleDeleteNotification = async (id: string) => {
    const { error } = await supabase.from("notifications").delete().eq("id", id);
    if (error) {
      toast({
        title: "Failed to delete notification",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      toast({
        title: "Notification deleted",
        description: "The broadcast notification was successfully removed from the database.",
      });
    }
  };

  const handleRunScheduler = async () => {
    const { data, error } = await supabase.functions.invoke("process-scheduled-sms", {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (error) { toast({ title: "Scheduler error", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Scheduler ran: ${data?.processed ?? 0} broadcast(s) processed` });
    await fetchAll();
    fetchSmsLogs();
  };

  // Filter SMS Logs
  const filteredSmsLogs = smsLogs.filter((log) => {
    const matchesSearch =
      (log.recipient || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.body || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.sender_id || "").toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === "all" || log.status === statusFilter;
    const matchesType = typeFilter === "all" || log.type === typeFilter;

    return matchesSearch && matchesStatus && matchesType;
  });

  if (loading) return <div className="text-muted-foreground p-4 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-black text-white flex items-center gap-2">
            <Bell className="w-6 h-6 text-amber-500" /> Notification Hub
          </h1>
          <p className="text-white/40 text-xs sm:text-sm mt-1">Manage global broadcasts, SMS templates, and audit real-time system logs</p>
        </div>
        {scheduledBroadcasts.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleRunScheduler} className="gap-1.5 text-xs bg-white/5 border-white/10 hover:bg-white/10 text-white font-bold h-9">
            <RefreshCw className="w-3.5 h-3.5" /> Run Scheduler
          </Button>
        )}
      </div>

      {/* Tabs Header */}
      <div className="flex border-b border-white/5 pb-px gap-1.5 sm:gap-4 scrollbar-none overflow-x-auto">
        <button
          onClick={() => setActiveTab("compose")}
          className={cn(
            "px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-all gap-1.5 flex items-center shrink-0",
            activeTab === "compose" ? "border-amber-500 text-amber-500" : "border-transparent text-white/40 hover:text-white/70"
          )}
        >
          <Send className="w-4 h-4" /> Compose Broadcast
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={cn(
            "px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-all gap-1.5 flex items-center shrink-0",
            activeTab === "history" ? "border-amber-500 text-amber-500" : "border-transparent text-white/40 hover:text-white/70"
          )}
        >
          <Bell className="w-4 h-4" /> Broadcast History
        </button>
        <button
          onClick={() => setActiveTab("sms_logs")}
          className={cn(
            "px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition-all gap-1.5 flex items-center relative shrink-0",
            activeTab === "sms_logs" ? "border-amber-500 text-amber-500" : "border-transparent text-white/40 hover:text-white/70"
          )}
        >
          <MessageSquare className="w-4 h-4" /> Real-time SMS Logs
          <span className="relative flex h-2 w-2 ml-1">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
        </button>
      </div>

      {/* Tab 1: Compose & Send */}
      {activeTab === "compose" && (
        <div className="space-y-6">
          {/* Templates bar */}
          {templates.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center bg-white/[0.02] border border-white/5 p-3 rounded-2xl">
              <span className="text-xs text-white/40 font-bold uppercase tracking-widest flex items-center gap-1.5 mr-2 shrink-0">
                <BookTemplate className="w-4 h-4 text-amber-500/80" /> Templates:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {templates.map((t) => (
                  <div key={t.id} className="flex items-center gap-0.5 group">
                    <button
                      type="button"
                      onClick={() => loadTemplate(t)}
                      className="text-xs px-2.5 py-1 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 text-white/80 transition-colors font-medium"
                    >
                      {t.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete template ${t.name}`}
                      onClick={() => handleDeleteTemplate(t.id)}
                      className="text-white/20 hover:text-red-400 transition-colors p-1 opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Compose card */}
          <Card className="bg-white/[0.02] border-white/10 shadow-2xl">
            <CardHeader className="border-b border-white/5">
              <CardTitle className="text-lg flex items-center gap-2 text-white">
                <Sparkles className="w-5 h-5 text-amber-500" /> Compose Message
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 pt-5">
              {/* Title + Target */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-white/40 text-xs font-bold uppercase tracking-widest">Title</Label>
                  <Input value={title} onChange={(e) => { setTitle(e.target.value); resetEstimate(); }}
                    placeholder="e.g. System Upgrade Live" className="bg-black/30 border-white/10 text-white placeholder:text-white/20 focus-visible:ring-amber-500/30 rounded-xl h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-white/40 text-xs font-bold uppercase tracking-widest">Target Audience</Label>
                  <Select value={targetType} onValueChange={(v) => { setTargetType(v as TargetType); resetEstimate(); }}>
                    <SelectTrigger className="bg-black/30 border-white/10 text-white rounded-xl h-11"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#111116] border-white/10 text-white">
                      {Object.entries(TARGET_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v} className="hover:bg-white/5 focus:bg-white/5 text-white/80">{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Advanced filters toggle */}
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-bold text-amber-500/80 hover:text-amber-500 transition-colors uppercase tracking-wider"
              >
                {showFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                Advanced Segment Filtering
              </button>

              {showFilters && (
                <div className="rounded-2xl border border-white/5 bg-black/40 p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 animate-in slide-in-from-top-3 duration-250">
                  <div className="space-y-1.5">
                    <Label className="text-white/40 text-[10px] font-bold uppercase tracking-widest">Inactive days</Label>
                    <Input
                      type="number" min={1} placeholder="e.g. 30"
                      value={targetFilters.inactive_days ?? ""}
                      onChange={(e) => { setTargetFilters((f) => ({ ...f, inactive_days: e.target.value ? Number(e.target.value) : undefined })); resetEstimate(); }}
                      className="bg-black/20 border-white/10 text-white text-sm h-9 rounded-xl focus-visible:ring-amber-500/20"
                    />
                    <p className="text-[9px] text-white/30">Target users offline for N+ days</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-white/40 text-[10px] font-bold uppercase tracking-widest">Min balance (GHS)</Label>
                    <Input
                      type="number" min={0} placeholder="e.g. 10"
                      value={targetFilters.min_balance ?? ""}
                      onChange={(e) => { setTargetFilters((f) => ({ ...f, min_balance: e.target.value ? Number(e.target.value) : undefined })); resetEstimate(); }}
                      className="bg-black/20 border-white/10 text-white text-sm h-9 rounded-xl focus-visible:ring-amber-500/20"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-white/40 text-[10px] font-bold uppercase tracking-widest">Max balance (GHS)</Label>
                    <Input
                      type="number" min={0} placeholder="e.g. 5"
                      value={targetFilters.max_balance ?? ""}
                      onChange={(e) => { setTargetFilters((f) => ({ ...f, max_balance: e.target.value ? Number(e.target.value) : undefined })); resetEstimate(); }}
                      className="bg-black/20 border-white/10 text-white text-sm h-9 rounded-xl focus-visible:ring-amber-500/20"
                    />
                  </div>
                </div>
              )}

              {/* Message */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between mb-0.5">
                  <Label className="text-white/40 text-xs font-bold uppercase tracking-widest">Message Body</Label>
                  {sendSms && (
                    <Badge variant="outline" className={cn("text-[10px] h-5 px-2 font-mono shrink-0 tabular-nums border",
                      smsChars > SMS_LIMIT ? "bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse" : "bg-white/5 text-white/40 border-white/5"
                    )}>
                      {smsChars}/{SMS_LIMIT} · {smsSegments} segment{smsSegments !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
                <Textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => { setMessage(e.target.value); resetEstimate(); }}
                  placeholder="Write your broadcast or message body here..."
                  className="bg-black/30 border-white/10 text-white text-sm placeholder:text-white/20 focus-visible:ring-amber-500/30 rounded-2xl min-h-[120px] resize-none"
                />
                {/* Token chips */}
                <div className="flex flex-wrap gap-1.5 mt-2.5 items-center">
                  <span className="text-[10px] text-white/30 font-bold uppercase tracking-widest self-center flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Insert Placeholder:
                  </span>
                  {TOKENS.map((t) => (
                    <button
                      type="button"
                      key={t.label}
                      onClick={() => insertToken(t.label)}
                      title={t.desc}
                      className="text-[10px] font-mono font-bold px-2 py-1 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-400 hover:bg-amber-500/10 transition-colors"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* SMS toggle */}
              <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-black text-white flex items-center gap-1.5">
                      <MessageSquare className="w-4 h-4 text-amber-500" /> Also Dispatch as SMS
                    </p>
                    <p className="text-xs text-white/40 mt-1">Automatically send standard SMS via TxtConnect gateway to all active recipients</p>
                  </div>
                  <Switch checked={sendSms} onCheckedChange={setSendSms} className="data-[state=checked]:bg-amber-500" />
                </div>

                {sendSms && (
                  <div className="space-y-4 pt-2 border-t border-white/5 animate-in fade-in duration-300">
                    {/* Preview */}
                    {smsBody && (
                      <div className="rounded-xl bg-black/40 border border-white/5 p-3.5">
                        <p className="text-[9px] font-black uppercase tracking-widest text-white/30 mb-2">Standard SMS Broadcast Preview</p>
                        <p className="text-xs whitespace-pre-wrap leading-relaxed text-white/70">{smsBody}</p>
                      </div>
                    )}

                    {/* Estimate */}
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={handleEstimate} disabled={estimating} className="gap-1.5 text-xs bg-white/5 border-white/10 hover:bg-white/10 text-white font-bold h-8">
                        {estimating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
                        Estimate Audience
                      </Button>
                      {estimate && (
                        <span className="text-xs text-white/40">
                          ~<strong className="text-white">{estimate.count.toLocaleString()}</strong> active phone numbers
                          {estimate.optOuts > 0 && <>, <span className="text-amber-400 font-bold">{estimate.optOuts} opted out</span></>}
                        </span>
                      )}
                    </div>

                    {/* Test SMS */}
                    <div className="space-y-1.5 pt-2 border-t border-white/5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Send Single Test Message</p>
                      <div className="flex gap-2 max-w-sm">
                        <Input value={testPhone} onChange={(e) => setTestPhone(e.target.value)}
                          placeholder="e.g. 0545091897" className="bg-black/20 border-white/10 text-xs h-9 rounded-xl" />
                        <Button size="sm" variant="outline" onClick={handleTestSms} disabled={testSending} className="shrink-0 gap-1.5 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20 text-amber-400 font-bold h-9">
                          {testSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Phone className="w-3.5 h-3.5" />}
                          Send Test
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Schedule toggle */}
              <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-black text-white flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-amber-500" /> Queue Broadcast for Later
                    </p>
                    <p className="text-xs text-white/40 mt-1">Select a specific date and time to deliver this broadcast automatically</p>
                  </div>
                  <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} className="data-[state=checked]:bg-amber-500" />
                </div>
                {scheduleEnabled && (
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                    className="bg-black/20 border-white/10 text-xs h-10 rounded-xl text-white"
                  />
                )}
              </div>

              {/* Save as template */}
              <div className="flex flex-wrap items-start gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowSaveTemplate((v) => !v)} className="gap-1.5 text-xs bg-white/5 border-white/10 hover:bg-white/10 text-white font-bold h-8">
                  <Save className="w-3.5 h-3.5" /> Save Template
                </Button>
                {showSaveTemplate && (
                  <div className="flex gap-2 flex-1 max-w-md animate-in slide-in-from-left-3 duration-200">
                    <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="Template name..." className="h-8 text-xs bg-black/20 border-white/10 rounded-lg flex-1" />
                    <Button size="sm" onClick={handleSaveTemplate} disabled={savingTemplate} className="h-8 gap-1 text-xs bg-amber-500 hover:bg-amber-400 text-black font-black">
                      {savingTemplate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      Save
                    </Button>
                  </div>
                )}
              </div>

              {/* Send button */}
              <Button onClick={handleSend} disabled={sending} className="gap-2 w-full sm:w-auto h-11 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-black mt-2">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : scheduleEnabled ? <Clock className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                {scheduleEnabled ? "Schedule Broadcast" : sendSms ? "Launch Notification & SMS" : "Launch Notification"}
              </Button>
            </CardContent>
          </Card>

          {/* Scheduled queue */}
          {scheduledBroadcasts.length > 0 && (
            <Card className="bg-white/[0.02] border-white/10 shadow-xl">
              <CardHeader className="border-b border-white/5 pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-white">
                  <Clock className="w-4 h-4 text-amber-500" /> Scheduled Queue
                  <Badge className="ml-auto text-[10px] bg-white/5 border-white/10 border text-white/50">{scheduledBroadcasts.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-4">
                {scheduledBroadcasts.map((b) => (
                  <div key={b.id} className="flex items-start justify-between p-3.5 rounded-2xl bg-black/40 border border-white/5 gap-3 transition-colors hover:border-white/10">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <p className="font-bold text-sm text-white truncate">{b.title || "(No title)"}</p>
                        <Badge variant="outline" className="text-[9px] shrink-0 text-white/50 border-white/10">{TARGET_LABELS[b.target_type] || b.target_type}</Badge>
                        {b.status === "processing" && <Badge className="text-[9px] bg-amber-500 shrink-0 text-black font-bold animate-pulse">Processing…</Badge>}
                      </div>
                      <p className="text-xs text-white/40 line-clamp-1">{b.message}</p>
                      <p className="text-[10px] text-amber-400/90 mt-1.5 flex items-center gap-1 font-bold">
                        <Clock className="w-3 h-3" /> {new Date(b.scheduled_at).toLocaleString()}
                      </p>
                    </div>
                    {b.status === "pending" && (
                      <Button variant="ghost" size="icon" className="text-white/20 hover:text-red-400 hover:bg-red-500/10 shrink-0 h-8 w-8 rounded-lg"
                        onClick={() => handleCancelScheduled(b.id)}>
                        <XCircle className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Delivery report */}
          {lastResult && (
            <Card className="border-emerald-500/20 bg-emerald-500/[0.02] shadow-xl">
              <CardHeader className="border-b border-emerald-500/10 pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" /> SMS Delivery Report
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm">
                  {[
                    { label: "Recipients", value: lastResult.total_recipients },
                    { label: "Sent", value: lastResult.sent, green: true },
                    { label: "Failed", value: lastResult.failed, red: true },
                    { label: "Opt-outs", value: lastResult.opt_out_count ?? 0, amber: true },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl bg-black/40 border border-white/5 p-3">
                      <p className={cn("font-black text-xl leading-none",
                        s.green ? "text-emerald-400" : s.red && s.value > 0 ? "text-red-500 animate-bounce" : s.amber && s.value > 0 ? "text-amber-500" : "text-white"
                      )}>
                        {s.value}
                      </p>
                      <p className="text-[10px] text-white/35 font-bold uppercase tracking-wider mt-1">{s.label}</p>
                    </div>
                  ))}
                </div>

                {lastResult.failures && lastResult.failures.length > 0 && (
                  <div className="space-y-2.5 pt-3 border-t border-emerald-500/10">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-red-400 flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4" /> {lastResult.failures.length} failed delivery attempts
                      </p>
                      <Button size="sm" variant="outline" onClick={handleRetryFailed} disabled={retrying} className="h-7 text-xs gap-1 bg-red-500/10 border-red-500/20 hover:bg-red-500/20 text-red-400 font-bold">
                        {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        Retry Failed
                      </Button>
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1 bg-black/30 border border-white/5 p-3 rounded-xl scrollbar-thin">
                      {lastResult.failures.map((f, i) => (
                        <p key={i} className="text-xs text-white/40 font-mono flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                          <span className="font-bold text-white/60">{f.phone}:</span> {f.reason}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Tab 2: Notification History */}
      {activeTab === "history" && (
        <Card className="bg-white/[0.02] border-white/10 shadow-2xl">
          <CardHeader className="border-b border-white/5">
            <CardTitle className="text-lg text-white">Notification Broadcast History</CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            {notifications.length === 0 ? (
              <div className="text-center py-16">
                <Bell className="w-8 h-8 mx-auto mb-3 text-white/15" />
                <p className="text-white/30 text-sm font-semibold">No notifications sent yet.</p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {notifications.map((n) => (
                  <div key={n.id} className="flex items-start justify-between p-4 rounded-2xl bg-black/40 border border-white/5 gap-3 transition-all hover:border-white/10">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <p className="font-bold text-sm text-white truncate">{n.title}</p>
                        <Badge variant="outline" className="text-[9px] shrink-0 text-white/40 border-white/5 bg-white/5">{TARGET_LABELS[n.target_type] || n.target_type}</Badge>
                      </div>
                      <p className="text-xs text-white/50 line-clamp-2 leading-relaxed">{n.message}</p>
                      <p className="text-[10px] text-white/20 mt-2 font-medium">{new Date(n.created_at).toLocaleString()}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="text-white/20 hover:text-red-400 hover:bg-red-500/10 shrink-0 rounded-lg h-8 w-8"
                      onClick={() => handleDeleteNotification(n.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab 3: Real-time SMS Logs */}
      {activeTab === "sms_logs" && (
        <div className="space-y-4">
          {/* Controls / Filtering Bar */}
          <Card className="bg-white/[0.02] border-white/10 shadow-xl">
            <CardContent className="p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by phone number, message..."
                  className="bg-black/30 border-white/10 pl-9 rounded-xl text-white text-xs h-10 focus-visible:ring-amber-500/30"
                />
              </div>

              {/* Status Filter */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest pl-1">Status</span>
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                    <SelectTrigger className="bg-black/30 border-white/10 text-white rounded-xl h-9 text-xs w-[110px]"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#111116] border-white/10 text-white">
                      <SelectItem value="all" className="hover:bg-white/5 text-xs text-white/80">All Status</SelectItem>
                      <SelectItem value="success" className="hover:bg-white/5 text-xs text-emerald-400 font-bold">Success</SelectItem>
                      <SelectItem value="failed" className="hover:bg-white/5 text-xs text-rose-400 font-bold">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Type Filter */}
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest pl-1">SMS Type</span>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="bg-black/30 border-white/10 text-white rounded-xl h-9 text-xs w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#111116] border-white/10 text-white max-h-56">
                      <SelectItem value="all" className="hover:bg-white/5 text-xs text-white/80">All Types</SelectItem>
                      {Object.keys(TYPE_COLORS).map((type) => (
                        <SelectItem key={type} value={type} className="hover:bg-white/5 text-xs text-white/80 capitalize">
                          {type.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button variant="outline" size="icon" onClick={fetchSmsLogs} disabled={smsLogsLoading}
                  className="h-9 w-9 bg-white/5 border-white/10 hover:bg-white/10 text-white rounded-xl mt-4 self-end shrink-0">
                  <RefreshCw className={cn("w-4 h-4", smsLogsLoading && "animate-spin")} />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Logs List Container */}
          <Card className="bg-white/[0.02] border-white/10 shadow-2xl">
            <CardHeader className="border-b border-white/5 py-4">
              <CardTitle className="text-base flex items-center justify-between text-white">
                <span className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-500" /> SMS Traffic Logs
                </span>
                <span className="text-xs text-white/30 font-medium">
                  Showing {filteredSmsLogs.length} of {smsLogs.length} records
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 scrollbar-thin">
              {smsLogsLoading && smsLogs.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 text-white/15 animate-spin" />
                </div>
              ) : filteredSmsLogs.length === 0 ? (
                <div className="text-center py-16">
                  <MessageSquare className="w-8 h-8 mx-auto mb-3 text-white/15" />
                  <p className="text-white/30 text-sm font-semibold">No matching SMS logs found.</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1 scrollbar-thin">
                  {filteredSmsLogs.map((log) => (
                    <div key={log.id} className={cn(
                      "p-4 rounded-2xl border bg-black/40 gap-3 transition-all hover:scale-[0.99] flex flex-col sm:flex-row sm:items-start justify-between border-white/5",
                      log.status === "failed" ? "border-rose-500/20 bg-rose-500/[0.01]" : "hover:border-white/10"
                    )}>
                      {/* Left: Metadata & Body */}
                      <div className="flex-1 space-y-2 min-w-0">
                        {/* Meta strip */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-black text-white text-xs sm:text-sm bg-white/5 border border-white/10 px-2 py-0.5 rounded-lg flex items-center gap-1.5 shadow-sm">
                            <Phone className="w-3 h-3 text-white/40" />
                            {log.recipient}
                          </span>

                          <Badge className={cn("text-[9px] h-5 font-black border uppercase px-1.5 tracking-wider",
                            TYPE_COLORS[log.type] || "bg-white/5 text-white/40 border-white/5"
                          )}>
                            {log.type.replace("_", " ")}
                          </Badge>

                          {log.sender_id && (
                            <span className="text-[10px] text-white/35 font-bold flex items-center gap-1 bg-white/[0.02] border border-white/5 px-1.5 py-0.5 rounded-md">
                              Sender: <strong className="text-white/50">{log.sender_id}</strong>
                            </span>
                          )}
                        </div>

                        {/* Body */}
                        <div className="bg-[#050508]/60 border border-white/5 rounded-xl px-3.5 py-2.5">
                          <p className="text-xs sm:text-sm leading-relaxed text-white/70 whitespace-pre-wrap">{log.body}</p>
                        </div>

                        {/* Error box if failed */}
                        {log.status === "failed" && log.error_message && (
                          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 flex items-start gap-2.5 animate-in slide-in-from-top-2">
                            <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                            <div className="text-xs">
                              <p className="font-black text-red-400 uppercase tracking-widest text-[9px]">API Failure Reason</p>
                              <p className="text-white/60 font-mono mt-0.5 leading-snug">{log.error_message}</p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Right: Timestamp & Status badge */}
                      <div className="sm:text-right shrink-0 flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 sm:gap-1.5 pt-1">
                        <Badge className={cn("text-[9px] font-black tracking-widest border uppercase h-5 px-2",
                          log.status === "success" 
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.08)]" 
                            : "bg-red-500/10 text-red-400 border-red-500/20 shadow-[0_0_8px_rgba(239,68,68,0.08)]"
                        )}>
                          {log.status === "success" ? (
                            <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Active</span>
                          ) : (
                            <span className="flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Failed</span>
                          )}
                        </Badge>
                        <p className="text-[10px] text-white/20 font-bold flex items-center gap-1">
                          <Clock className="w-3 h-3 text-white/10" />
                          {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          <span className="hidden sm:inline">· {new Date(log.created_at).toLocaleDateString()}</span>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default AdminNotificationsPage;
