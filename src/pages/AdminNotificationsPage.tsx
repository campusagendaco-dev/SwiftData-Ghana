import { useState, useEffect } from "react";
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
import { Bell, Send, Trash2, Loader2, MessageSquare, CheckCircle2, XCircle, Phone } from "lucide-react";

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
  skipped_invalid_or_empty: number;
  total_recipients: number;
  valid_numbers: number;
  failures?: Array<{ phone: string; reason: string }>;
}

const SMS_LIMIT = 160;

const targetLabels: Record<string, string> = {
  all: "Everyone",
  agents: "Agents Only",
  users: "Users Only",
  pending_orders: "Pending Orders Only",
};

const AdminNotificationsPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [testSending, setTestSending] = useState(false);

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [targetType, setTargetType] = useState("all");
  const [sendSms, setSendSms] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [lastSmsResult, setLastSmsResult] = useState<SmsResult | null>(null);

  const smsBody = title.trim() ? `${title.trim()}\n${message.trim()}` : message.trim();
  const smsChars = smsBody.length;
  const smsSegments = Math.ceil(smsChars / SMS_LIMIT) || 1;

  const fetchNotifications = async () => {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setNotifications((data || []) as NotificationRow[]);
    setLoading(false);
  };

  useEffect(() => { fetchNotifications(); }, []);

  const handleSend = async () => {
    if (!title.trim() || !message.trim()) {
      toast({ title: "Title and message are required", variant: "destructive" });
      return;
    }
    setSending(true);
    setLastSmsResult(null);

    const { error } = await supabase.from("notifications").insert({
      title: title.trim(),
      message: message.trim(),
      target_type: targetType,
      created_by: user?.id,
    });

    if (error) {
      toast({ title: "Failed to send", description: error.message, variant: "destructive" });
      setSending(false);
      return;
    }

    if (sendSms) {
      const { data: smsData, error: smsError } = await supabase.functions.invoke("admin-send-sms", {
        body: { title: title.trim(), message: message.trim(), target_type: targetType },
      });

      if (smsError) {
        toast({ title: "Notification saved, SMS failed", description: smsError.message, variant: "destructive" });
      } else if (smsData?.success) {
        setLastSmsResult(smsData as SmsResult);
        toast({ title: `SMS sent to ${smsData.sent} of ${smsData.valid_numbers} numbers` });
      } else if (smsData?.error) {
        toast({ title: "SMS error", description: smsData.error, variant: "destructive" });
      }
    } else {
      toast({ title: "Notification sent!" });
    }

    setTitle("");
    setMessage("");
    await fetchNotifications();
    setSending(false);
  };

  const handleTestSms = async () => {
    if (!testPhone.trim()) {
      toast({ title: "Enter a test phone number", variant: "destructive" });
      return;
    }
    if (!message.trim()) {
      toast({ title: "Write a message first", variant: "destructive" });
      return;
    }
    setTestSending(true);

    const { data, error } = await supabase.functions.invoke("admin-send-sms", {
      body: {
        title: title.trim(),
        message: message.trim(),
        target_type: "test",
        test_phone: testPhone.trim(),
      },
    });

    if (error || data?.error) {
      toast({ title: "Test SMS failed", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: `Test SMS sent to ${testPhone}` });
    }
    setTestSending(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("notifications").delete().eq("id", id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    toast({ title: "Notification deleted" });
  };

  if (loading) return <div className="text-muted-foreground p-4">Loading...</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="font-display text-2xl font-bold">Send Notifications</h1>

      {/* Compose card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" /> New Notification
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. New bundle available"
                className="mt-1 bg-secondary"
              />
            </div>
            <div>
              <Label>Target Audience</Label>
              <Select value={targetType} onValueChange={setTargetType}>
                <SelectTrigger className="mt-1 bg-secondary"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  <SelectItem value="agents">Agents Only</SelectItem>
                  <SelectItem value="users">Users Only</SelectItem>
                  <SelectItem value="pending_orders">Pending Orders Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Message</Label>
              {sendSms && (
                <span className={`text-xs tabular-nums ${smsChars > SMS_LIMIT ? "text-amber-500" : "text-muted-foreground"}`}>
                  {smsChars}/{SMS_LIMIT} · {smsSegments} SMS segment{smsSegments !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your message..."
              className="mt-1 bg-secondary min-h-[100px]"
            />
          </div>

          {/* SMS toggle */}
          <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" /> Also send as SMS
                </p>
                <p className="text-xs text-muted-foreground">Sends to phone numbers in profiles for the selected audience.</p>
              </div>
              <Switch checked={sendSms} onCheckedChange={setSendSms} />
            </div>

            {sendSms && (
              <>
                {/* SMS preview */}
                {smsBody && (
                  <div className="rounded-lg bg-background border border-border p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">SMS Preview</p>
                    <p className="text-sm whitespace-pre-wrap">{smsBody}</p>
                  </div>
                )}

                {/* Test SMS */}
                <div>
                  <p className="text-xs font-medium mb-1.5">Send test SMS to a single number</p>
                  <div className="flex gap-2">
                    <Input
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      placeholder="0241234567"
                      className="bg-background text-sm h-9"
                    />
                    <Button size="sm" variant="outline" onClick={handleTestSms} disabled={testSending} className="shrink-0 gap-1.5">
                      {testSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Phone className="w-3.5 h-3.5" />}
                      Test
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>

          <Button onClick={handleSend} disabled={sending} className="gap-2">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sendSms ? "Send Notification + SMS" : "Send Notification"}
          </Button>
        </CardContent>
      </Card>

      {/* SMS result card */}
      {lastSmsResult && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="w-4 h-4" /> SMS Delivery Report
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm">
              {[
                { label: "Recipients", value: lastSmsResult.total_recipients },
                { label: "Valid Numbers", value: lastSmsResult.valid_numbers },
                { label: "Sent", value: lastSmsResult.sent, green: true },
                { label: "Failed", value: lastSmsResult.failed, red: true },
              ].map((s) => (
                <div key={s.label} className="rounded-lg bg-background border border-border p-2">
                  <p className={`font-bold text-lg ${s.green ? "text-green-500" : s.red && s.value > 0 ? "text-red-500" : ""}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
            {lastSmsResult.skipped_invalid_or_empty > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                {lastSmsResult.skipped_invalid_or_empty} skipped (no valid phone number on profile)
              </p>
            )}
            {lastSmsResult.failures && lastSmsResult.failures.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs font-medium text-red-500 flex items-center gap-1"><XCircle className="w-3 h-3" /> Failed deliveries</p>
                {lastSmsResult.failures.map((f, i) => (
                  <p key={i} className="text-xs text-muted-foreground font-mono">{f.phone}: {f.reason}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* History */}
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
                      <Badge variant="outline" className="text-xs shrink-0">{targetLabels[n.target_type] || n.target_type}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{n.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString()}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="text-destructive shrink-0" onClick={() => handleDelete(n.id)}>
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
