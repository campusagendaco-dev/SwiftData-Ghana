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
import { Bell, Send, Trash2, Loader2 } from "lucide-react";

interface NotificationRow {
  id: string;
  title: string;
  message: string;
  target_type: string;
  created_at: string;
}

const AdminNotificationsPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [targetType, setTargetType] = useState("all");
  const [sendSms, setSendSms] = useState(false);

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
    const { error } = await supabase.from("notifications").insert({
      title: title.trim(),
      message: message.trim(),
      target_type: targetType,
      created_by: user?.id,
    });

    if (error) {
      toast({ title: "Failed to send", description: error.message, variant: "destructive" });
    } else {
      let smsSummary = "";

      if (sendSms) {
        const { data: smsData, error: smsError } = await supabase.functions.invoke("admin-send-sms", {
          body: {
            title: title.trim(),
            message: message.trim(),
            target_type: targetType,
          },
        });

        if (smsError) {
          smsSummary = ` Notification saved, but SMS failed: ${smsError.message}`;
          toast({ title: "SMS failed", description: smsError.message, variant: "destructive" });
        } else if (smsData?.success) {
          smsSummary = ` SMS sent: ${smsData.sent}, failed: ${smsData.failed}, skipped: ${smsData.skipped_invalid_or_empty}.`;
        }
      }

      toast({ title: `Notification sent!${smsSummary}`.trim() });
      setTitle("");
      setMessage("");
      await fetchNotifications();
    }
    setSending(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("notifications").delete().eq("id", id);
    await fetchNotifications();
    toast({ title: "Notification deleted" });
  };

  const targetLabels: Record<string, string> = {
    all: "Everyone",
    agents: "Agents Only",
    users: "Users Only",
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-6">Send Notifications</h1>

      <Card className="mb-8">
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Bell className="w-5 h-5 text-primary" /> New Notification</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Notification title" className="mt-1 bg-secondary" />
            </div>
            <div>
              <Label>Target Audience</Label>
              <Select value={targetType} onValueChange={setTargetType}>
                <SelectTrigger className="mt-1 bg-secondary"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  <SelectItem value="agents">Agents Only</SelectItem>
                  <SelectItem value="users">Users Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Message</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write your message..." className="mt-1 bg-secondary min-h-[100px]" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3">
            <div>
              <p className="text-sm font-medium">Also send as SMS</p>
              <p className="text-xs text-muted-foreground">Uses phone numbers in profiles and sends to the selected audience.</p>
            </div>
            <Switch checked={sendSms} onCheckedChange={setSendSms} />
          </div>
          <Button onClick={handleSend} disabled={sending} className="gap-2">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sendSms ? "Send Notification + SMS" : "Send Notification"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Sent Notifications</CardTitle></CardHeader>
        <CardContent>
          {notifications.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">No notifications sent yet.</p>
          ) : (
            <div className="space-y-3">
              {notifications.map((n) => (
                <div key={n.id} className="flex items-start justify-between p-4 rounded-lg bg-secondary/50 border border-border">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm">{n.title}</p>
                      <Badge variant="outline" className="text-xs">{targetLabels[n.target_type] || n.target_type}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{n.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString()}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(n.id)}>
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
