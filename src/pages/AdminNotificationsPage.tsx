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
import {
  Bell, Send, Trash2, Loader2, MessageSquare, CheckCircle2,
  XCircle, Phone, BookTemplate, Save, Clock, RefreshCw,
  Users, Calendar, ChevronDown, ChevronUp, Sparkles, AlertCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type TargetType = "all" | "agents" | "sub_agents" | "parent_agents" | "users" | "pending_orders";

interface TargetFilters {
  inactive_days?: number;
  min_balance?: number;
  max_balance?: number;
}

interface SmsTemplate {
  id: string;
  name: string;
  title: string;
  message: string;
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

// ─── Constants ────────────────────────────────────────────────────────────────

const SMS_LIMIT = 160;

const TARGET_LABELS: Record<string, string> = {
  all: "Everyone",
  agents: "All Agents & Sub-agents",
  sub_agents: "Sub-agents Only",
  parent_agents: "Parent Agents Only",
  users: "Customers Only",
  pending_orders: "Pending Order Phones",
};

const TOKENS = [
  { label: "{{name}}", desc: "Recipient's full name" },
  { label: "{{balance}}", desc: "Agent wallet balance" },
];

// ─── Component ────────────────────────────────────────────────────────────────

const AdminNotificationsPage = () => {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const smsBody = title.trim() ? `${title.trim()}\n${message.trim()}` : message.trim();
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

  useEffect(() => { fetchAll(); }, [fetchAll]);

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
    setTitle(tmpl.title);
    setMessage(tmpl.message);
    toast({ title: `Template "${tmpl.name}" loaded` });
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
    await supabase.from("notifications").delete().eq("id", id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const handleRunScheduler = async () => {
    const { data, error } = await supabase.functions.invoke("process-scheduled-sms", {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (error) { toast({ title: "Scheduler error", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Scheduler ran: ${data?.processed ?? 0} broadcast(s) processed` });
    await fetchAll();
  };

  if (loading) return <div className="text-muted-foreground p-4 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Send Notifications</h1>
        {scheduledBroadcasts.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleRunScheduler} className="gap-1.5 text-xs">
            <RefreshCw className="w-3.5 h-3.5" /> Run Scheduler
          </Button>
        )}
      </div>

      {/* ── Templates bar ────────────────────────────────────────────────────── */}
      {templates.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
            <BookTemplate className="w-3.5 h-3.5" /> Templates:
          </span>
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => loadTemplate(t)}
                className="text-xs px-2.5 py-1 rounded-lg border border-border bg-secondary hover:bg-secondary/80 transition-colors"
              >
                {t.name}
              </button>
              <button
                type="button"
                aria-label={`Delete template ${t.name}`}
                onClick={() => handleDeleteTemplate(t.id)}
                className="text-muted-foreground hover:text-destructive transition-colors p-1"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Compose card ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" /> Compose
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Title + Target */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Title</Label>
              <Input value={title} onChange={(e) => { setTitle(e.target.value); resetEstimate(); }}
                placeholder="e.g. New bundle available" className="mt-1 bg-secondary" />
            </div>
            <div>
              <Label>Target Audience</Label>
              <Select value={targetType} onValueChange={(v) => { setTargetType(v as TargetType); resetEstimate(); }}>
                <SelectTrigger className="mt-1 bg-secondary"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TARGET_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Advanced filters toggle */}
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Advanced filters
          </button>

          {showFilters && (
            <div className="rounded-lg border border-border bg-secondary/30 p-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Inactive days</Label>
                <Input
                  type="number" min={1} placeholder="e.g. 30"
                  value={targetFilters.inactive_days ?? ""}
                  onChange={(e) => { setTargetFilters((f) => ({ ...f, inactive_days: e.target.value ? Number(e.target.value) : undefined })); resetEstimate(); }}
                  className="mt-1 h-8 text-sm bg-background"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">Only inactive for N+ days</p>
              </div>
              <div>
                <Label className="text-xs">Min wallet balance (GHS)</Label>
                <Input
                  type="number" min={0} placeholder="e.g. 10"
                  value={targetFilters.min_balance ?? ""}
                  onChange={(e) => { setTargetFilters((f) => ({ ...f, min_balance: e.target.value ? Number(e.target.value) : undefined })); resetEstimate(); }}
                  className="mt-1 h-8 text-sm bg-background"
                />
              </div>
              <div>
                <Label className="text-xs">Max wallet balance (GHS)</Label>
                <Input
                  type="number" min={0} placeholder="e.g. 5"
                  value={targetFilters.max_balance ?? ""}
                  onChange={(e) => { setTargetFilters((f) => ({ ...f, max_balance: e.target.value ? Number(e.target.value) : undefined })); resetEstimate(); }}
                  className="mt-1 h-8 text-sm bg-background"
                />
              </div>
            </div>
          )}

          {/* Message */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Message</Label>
              {sendSms && (
                <span className={`text-xs tabular-nums ${smsChars > SMS_LIMIT ? "text-amber-500" : "text-muted-foreground"}`}>
                  {smsChars}/{SMS_LIMIT} · {smsSegments} segment{smsSegments !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <Textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => { setMessage(e.target.value); resetEstimate(); }}
              placeholder="Write your message..."
              className="mt-1 bg-secondary min-h-[100px]"
            />
            {/* Token chips */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className="text-[10px] text-muted-foreground self-center flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Insert:
              </span>
              {TOKENS.map((t) => (
                <button
                  key={t.label}
                  onClick={() => insertToken(t.label)}
                  title={t.desc}
                  className="text-[11px] font-mono px-2 py-0.5 rounded border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* SMS toggle */}
          <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" /> Also send as SMS
                </p>
                <p className="text-xs text-muted-foreground">Sends via TxtConnect to phone numbers for the selected audience.</p>
              </div>
              <Switch checked={sendSms} onCheckedChange={setSendSms} />
            </div>

            {sendSms && (
              <div className="space-y-3">
                {/* Preview */}
                {smsBody && (
                  <div className="rounded-lg bg-background border border-border p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">SMS Preview</p>
                    <p className="text-sm whitespace-pre-wrap">{smsBody}</p>
                  </div>
                )}

                {/* Estimate */}
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleEstimate} disabled={estimating} className="gap-1.5 text-xs h-8 shrink-0">
                    {estimating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
                    Estimate Recipients
                  </Button>
                  {estimate && (
                    <span className="text-xs text-muted-foreground">
                      ~<strong className="text-foreground">{estimate.count.toLocaleString()}</strong> recipients
                      {estimate.optOuts > 0 && <>, <span className="text-amber-500">{estimate.optOuts} opted out</span></>}
                    </span>
                  )}
                </div>

                {/* Test SMS */}
                <div>
                  <p className="text-xs font-medium mb-1.5">Send test to a single number</p>
                  <div className="flex gap-2">
                    <Input value={testPhone} onChange={(e) => setTestPhone(e.target.value)}
                      placeholder="0241234567" className="bg-background text-sm h-9" />
                    <Button size="sm" variant="outline" onClick={handleTestSms} disabled={testSending} className="shrink-0 gap-1.5">
                      {testSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Phone className="w-3.5 h-3.5" />}
                      Test
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Schedule toggle */}
          <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" /> Schedule for later
                </p>
                <p className="text-xs text-muted-foreground">Pick a date/time to send automatically.</p>
              </div>
              <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} />
            </div>
            {scheduleEnabled && (
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                className="bg-background text-sm"
              />
            )}
          </div>

          {/* Save as template */}
          <div className="flex items-start gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowSaveTemplate((v) => !v)} className="gap-1.5 text-xs h-8">
              <Save className="w-3.5 h-3.5" /> Save as Template
            </Button>
            {showSaveTemplate && (
              <div className="flex gap-2 flex-1">
                <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name" className="h-8 text-sm bg-secondary flex-1" />
                <Button size="sm" onClick={handleSaveTemplate} disabled={savingTemplate} className="h-8 gap-1 text-xs">
                  {savingTemplate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </Button>
              </div>
            )}
          </div>

          {/* Send button */}
          <Button onClick={handleSend} disabled={sending} className="gap-2 w-full sm:w-auto">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : scheduleEnabled ? <Clock className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            {scheduleEnabled ? "Schedule Broadcast" : sendSms ? "Send Notification + SMS" : "Send Notification"}
          </Button>
        </CardContent>
      </Card>

      {/* ── Scheduled queue ───────────────────────────────────────────────────── */}
      {scheduledBroadcasts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" /> Scheduled Queue
              <Badge variant="outline" className="ml-auto text-xs">{scheduledBroadcasts.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {scheduledBroadcasts.map((b) => (
              <div key={b.id} className="flex items-start justify-between p-3 rounded-lg bg-secondary/50 border border-border gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <p className="font-medium text-sm truncate">{b.title || "(No title)"}</p>
                    <Badge variant="outline" className="text-[10px] shrink-0">{TARGET_LABELS[b.target_type] || b.target_type}</Badge>
                    {b.status === "processing" && <Badge className="text-[10px] bg-amber-500 shrink-0">Processing…</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-1">{b.message}</p>
                  <p className="text-xs text-amber-500 mt-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {new Date(b.scheduled_at).toLocaleString()}
                  </p>
                </div>
                {b.status === "pending" && (
                  <Button variant="ghost" size="icon" className="text-destructive shrink-0 h-8 w-8"
                    onClick={() => handleCancelScheduled(b.id)}>
                    <XCircle className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Delivery report ───────────────────────────────────────────────────── */}
      {lastResult && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="w-4 h-4" /> SMS Delivery Report
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm">
              {[
                { label: "Recipients", value: lastResult.total_recipients },
                { label: "Sent", value: lastResult.sent, green: true },
                { label: "Failed", value: lastResult.failed, red: true },
                { label: "Opt-outs", value: lastResult.opt_out_count ?? 0, amber: true },
              ].map((s) => (
                <div key={s.label} className="rounded-lg bg-background border border-border p-2">
                  <p className={`font-bold text-lg ${s.green ? "text-green-500" : s.red && s.value > 0 ? "text-red-500" : s.amber && s.value > 0 ? "text-amber-500" : ""}`}>
                    {s.value}
                  </p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>

            {lastResult.failures && lastResult.failures.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-red-500 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {lastResult.failures.length} failed deliver{lastResult.failures.length === 1 ? "y" : "ies"}
                  </p>
                  <Button size="sm" variant="outline" onClick={handleRetryFailed} disabled={retrying} className="h-7 text-xs gap-1">
                    {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Retry Failed
                  </Button>
                </div>
                <div className="max-h-28 overflow-y-auto space-y-1">
                  {lastResult.failures.map((f, i) => (
                    <p key={i} className="text-xs text-muted-foreground font-mono">{f.phone}: {f.reason}</p>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Notification history ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Notification History</CardTitle>
        </CardHeader>
        <CardContent>
          {notifications.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">No notifications sent yet.</p>
          ) : (
            <div className="space-y-3">
              {notifications.map((n) => (
                <div key={n.id} className="flex items-start justify-between p-3 sm:p-4 rounded-lg bg-secondary/50 border border-border gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <p className="font-medium text-sm truncate">{n.title}</p>
                      <Badge variant="outline" className="text-xs shrink-0">{TARGET_LABELS[n.target_type] || n.target_type}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{n.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString()}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="text-destructive shrink-0"
                    onClick={() => handleDeleteNotification(n.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminNotificationsPage;
