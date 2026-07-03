import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Send, Users, Filter, RefreshCw,
  Megaphone, Bell, MessageSquare, BarChart3,
} from "lucide-react";

type Segment = "all_agents" | "top_agents" | "dormant_agents" | "sub_agents" | "active_7d";
type Channel = "notification" | "sms" | "both";

const SEGMENTS: { value: Segment; label: string; desc: string }[] = [
  { value: "all_agents",     label: "All Agents",         desc: "Every active agent on the platform" },
  { value: "top_agents",     label: "Top Performers",     desc: "Agents with > GHS 500 revenue in last 30 days" },
  { value: "dormant_agents", label: "Dormant Agents",     desc: "No orders in the last 14 days" },
  { value: "sub_agents",     label: "Sub-Agents Only",    desc: "All registered sub-agents" },
  { value: "active_7d",      label: "Active This Week",   desc: "Placed at least 1 order in last 7 days" },
];

const TEMPLATES = [
  { label: "Withdrawal Info",    title: "Profit Withdrawals Active 💸", body: "Good news! You can now withdraw your earned profits. Navigate to the Withdrawals tab on your dashboard to request a payout. Minimum withdrawal is GHS 25.00. Please try your withdrawal again." },
  { label: "Maintenance Notice",  title: "Scheduled Maintenance", body: "We will be performing scheduled maintenance on {date}. Services may be temporarily unavailable. We apologize for any inconvenience." },
  { label: "New Feature",         title: "New Feature Available!",body: "We've just launched a new feature! Log in to your SwiftData dashboard to check it out." },
  { label: "Promo Announcement",  title: "Special Promotion 🎉",  body: "For a limited time, enjoy special rates on {network} data bundles! Log in now to take advantage." },
  { label: "Balance Reminder",    title: "Top Up Your Wallet",    body: "Your SwiftData wallet balance is running low. Top up now to keep selling without interruption." },
  { label: "World Cup Promo",     title: "🏆 World Cup Special Promo! ⚽", body: "Catch every match live! Get cheap, non-expiry data bundles for MTN, Telecel, and AirtelTigo to stream the games without interruption. Top up now! 📲" },
  { label: "System Restored",     title: "⚡ System Restored & Fully Active", body: "All carrier networks (MTN, Telecel, AirtelTigo) are fully operational. You can now resume purchases safely. Thank you for your patience! 🤝" },
  { label: "Weekend Flash Sale",  title: "🔥 Weekend Flash Data Sale!", body: "Super discounts on all MTN & Telecel data bundles active right now! Purchase high-speed bundles at absolute wholesale rates. Ends Sunday midnight! 💸" },
  { label: "Wallet Bonus",        title: "💰 2% Wallet Top-Up Bonus!", body: "Get a 2% cash bonus instantly in your wallet on all manual top-ups above GHS 200 today! Boost your selling capacity and earn more profit. 🚀" },
  { label: "Referral Bonus",      title: "🎁 Invite Friends & Earn Cash!", body: "Share your referral link with friends! Get GHS 5.00 cash bonus credited to your wallet immediately they complete their first purchase. Start sharing! 🔗" },
  { label: "AFA Update",          title: "AFA Registration Active 🛡️", body: "AFA Registration is now live on SwiftData! You can register yourself or customers for AFA at just GHS 15.00. Keep selling and earning commissions! 🚀" },
  { label: "MTN Mash Up Promo",  title: "⚡ MTN Mash Up Bundles Live! 📲", body: "Sell MTN Mash Up bundles directly to clients! Purchase at agent wholesale rates and earn up to GHS 5.00 commission per transaction. Log in to https://swiftdatagh.shop to start selling now!" },
  { label: "Telecel Promo",      title: "🔥 Telecel Cash & Data Active!", body: "Earn massive agent commissions on all Telecel packages. Fast delivery and high reliability. Check wholesale pricing at https://swiftdatagh.shop today!" },
  { label: "AirtelTigo Promo",   title: "💰 AirtelTigo Big Time Data! 🚀", body: "Enjoy wholesale agent commissions on AirtelTigo packages. Fast, instant top-ups for your customers. Log in to https://swiftdatagh.shop to make a sale." },
  { label: "MTN SME wholesale",  title: "📦 MTN SME Affordable Data! 💸", body: "Get cheap MTN SME bundles: buy 5GB at GHS 21.20, sell at GHS 23.74, and make GHS 2.54 commission instantly! Visit https://swiftdatagh.shop." },
  { label: "Custom",              title: "",                       body: "" },
];

interface BroadcastLog {
  id: string;
  created_at: string;
  title: string;
  message: string;
  segment: string;
  channel: string;
  recipient_count: number;
  sent_by: string | null;
}

export default function AdminBroadcast() {
  const { toast } = useToast();
  const { user } = useAuth();

  const [segment, setSegment] = useState<Segment>("all_agents");
  const [channel, setChannel] = useState<Channel>("notification");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [templateIdx, setTemplateIdx] = useState(5);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [sending, setSending] = useState(false);
  const [logs, setLogs] = useState<BroadcastLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);

  const buildSegmentQuery = useCallback((q: any) => {
    switch (segment) {
      case "all_agents":     return q.or("is_agent.eq.true,sub_agent_approved.eq.true");
      case "top_agents":     return q.or("is_agent.eq.true,sub_agent_approved.eq.true"); // filtered post-fetch via v_agent_performance
      case "dormant_agents": return q.or("is_agent.eq.true,sub_agent_approved.eq.true");
      case "sub_agents":     return q.eq("is_sub_agent", true);
      case "active_7d":      return q.or("is_agent.eq.true,sub_agent_approved.eq.true");
      default:               return q;
    }
  }, [segment]);

  const handleCountRecipients = async () => {
    setCounting(true);
    setRecipientCount(null);
    try {
      let query = (supabase as any).from("profiles").select("user_id", { count: "exact", head: true });
      query = buildSegmentQuery(query);
      const { count } = await query;
      setRecipientCount(count || 0);
    } catch {
      setRecipientCount(0);
    }
    setCounting(false);
  };

  const handleTemplateSelect = (idx: number) => {
    setTemplateIdx(idx);
    if (idx < TEMPLATES.length - 1) {
      setTitle(TEMPLATES[idx].title);
      setBody(TEMPLATES[idx].body);
    }
  };

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) {
      toast({ title: "Missing fields", description: "Title and message are required.", variant: "destructive" });
      return;
    }
    setSending(true);

    try {
      // Fetch recipient user_ids based on segment
      let query = (supabase as any).from("profiles").select("user_id, phone");
      query = buildSegmentQuery(query);
      const { data: recipients } = await query;

      if (!recipients?.length) {
        toast({ title: "No recipients found", description: "Segment returned 0 users.", variant: "destructive" });
        setSending(false);
        return;
      }

      const recipientIds: string[] = recipients.map((r: any) => r.user_id);
      const count = recipientIds.length;

      // In-app notifications
      if (channel === "notification" || channel === "both") {
        const notifications = recipientIds.map((uid) => ({
          user_id: uid,
          title: title.trim(),
          message: body.trim(),
          type: "info",
          data: { broadcast: true, sent_by: user?.id },
        }));

        // Insert in batches of 500
        for (let i = 0; i < notifications.length; i += 500) {
          await (supabase as any).from("user_notifications").insert(notifications.slice(i, i + 500));
        }
      }

      // SMS via edge function (fire and forget for large batches)
      if (channel === "sms" || channel === "both") {
        const phones = recipients.map((r: any) => r.phone).filter(Boolean);
        supabase.functions.invoke("admin-send-sms", {
          body: { retry_phones: phones, message: `${title}\n${body}` },
        }).catch(() => {});
      }

      // Log the broadcast
      await (supabase as any).from("system_logs").insert({
        level: "info",
        source: "admin",
        event: "broadcast.sent",
        message: `Broadcast "${title}" sent to ${count} agents via ${channel}`,
        agent_id: user?.id,
        data: { segment, channel, title, body, recipient_count: count },
      });

      toast({ title: `Broadcast sent to ${count} agents`, description: `Channel: ${channel}` });
      setTitle(""); setBody(""); setTemplateIdx(4); setRecipientCount(null);
      loadLogs();
    } catch (e: any) {
      toast({ title: "Broadcast failed", description: e.message, variant: "destructive" });
    }
    setSending(false);
  };

  const loadLogs = async () => {
    const { data } = await (supabase as any)
      .from("system_logs")
      .select("id, created_at: ts, data, message")
      .eq("event", "broadcast.sent")
      .order("ts", { ascending: false })
      .limit(20);

    setLogs((data || []).map((l: any) => ({
      id: l.id,
      created_at: l.created_at,
      title: l.data?.title || "",
      message: l.data?.body || "",
      segment: l.data?.segment || "",
      channel: l.data?.channel || "",
      recipient_count: l.data?.recipient_count || 0,
      sent_by: l.data?.sent_by || null,
    })));
    setLogsLoaded(true);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-white">Broadcast Messaging</h1>
        <p className="text-white/40 text-sm mt-1">Send announcements to agents via notification or SMS</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Compose */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="bg-white/5 border-white/10 p-5 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Megaphone className="w-4 h-4 text-primary" />
              <h2 className="text-white font-black">Compose Message</h2>
            </div>

            {/* Templates */}
            <div>
              <p className="text-white/40 text-xs font-bold uppercase tracking-widest mb-2">Template</p>
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.map((t, i) => (
                  <button type="button" key={i} onClick={() => handleTemplateSelect(i)}
                    className={cn("px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
                      templateIdx === i ? "bg-primary/20 text-primary border-primary/30" : "bg-white/5 text-white/40 border-white/10 hover:text-white/70")}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-white/40 text-xs font-bold uppercase tracking-widest">Title</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Announcement title..."
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
            </div>

            {/* Body */}
            <div className="space-y-1.5">
              <label className="text-white/40 text-xs font-bold uppercase tracking-widest">Message</label>
              <textarea
                value={body} onChange={(e) => setBody(e.target.value)}
                rows={5} placeholder="Write your message here..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/20 resize-none focus:outline-none focus:border-primary/40"
              />
              <p className="text-white/20 text-[11px] text-right">{body.length} chars</p>
            </div>

            {/* Send button */}
            <Button type="button" onClick={handleSend} disabled={sending || !title || !body}
              className="w-full gap-2 bg-primary hover:bg-primary/90 text-black font-black h-11">
              <Send className="w-4 h-4" />
              {sending ? "Sending..." : `Send to ${recipientCount !== null ? recipientCount.toLocaleString() : "?"} agents`}
            </Button>
          </Card>
        </div>

        {/* Settings panel */}
        <div className="space-y-4">
          {/* Segment */}
          <Card className="bg-white/5 border-white/10 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-primary" />
              <h3 className="text-white font-black text-sm">Target Segment</h3>
            </div>
            <div className="space-y-2">
              {SEGMENTS.map((s) => (
                <button type="button" key={s.value} onClick={() => { setSegment(s.value); setRecipientCount(null); }}
                  className={cn("w-full text-left px-3 py-2.5 rounded-xl border transition-all",
                    segment === s.value ? "bg-primary/10 border-primary/30" : "bg-white/[0.03] border-white/5 hover:bg-white/5")}>
                  <p className={cn("text-sm font-bold", segment === s.value ? "text-primary" : "text-white/70")}>{s.label}</p>
                  <p className="text-white/30 text-[11px] mt-0.5">{s.desc}</p>
                </button>
              ))}
            </div>

            <Button type="button" variant="outline" size="sm" onClick={handleCountRecipients} disabled={counting}
              className="w-full border-white/10 text-white/60 hover:bg-white/5 gap-2">
              <Users className="w-3.5 h-3.5" />
              {counting ? "Counting..." : recipientCount !== null ? `${recipientCount} recipients` : "Count Recipients"}
            </Button>
          </Card>

          {/* Channel */}
          <Card className="bg-white/5 border-white/10 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              <h3 className="text-white font-black text-sm">Delivery Channel</h3>
            </div>
            {([
              ["notification", Bell, "In-App Notification", "Instant, free"],
              ["sms", MessageSquare, "SMS Only", "Reaches offline agents"],
              ["both", Send, "Both", "Maximum reach"],
            ] as const).map(([val, Icon, label, desc]) => (
              <button type="button" key={val} onClick={() => setChannel(val)}
                className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all",
                  channel === val ? "bg-primary/10 border-primary/30" : "bg-white/[0.03] border-white/5 hover:bg-white/5")}>
                <Icon className={cn("w-4 h-4 shrink-0", channel === val ? "text-primary" : "text-white/30")} />
                <div className="text-left">
                  <p className={cn("text-sm font-bold", channel === val ? "text-primary" : "text-white/60")}>{label}</p>
                  <p className="text-white/20 text-[10px]">{desc}</p>
                </div>
              </button>
            ))}
          </Card>
        </div>
      </div>

      {/* History */}
      <Card className="bg-white/5 border-white/10 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h3 className="text-white font-black">Broadcast History</h3>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={loadLogs}
            className="border-white/10 text-white/40 hover:bg-white/5 gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />Load
          </Button>
        </div>

        {!logsLoaded ? (
          <p className="text-white/20 text-sm text-center py-8">Click Load to view broadcast history</p>
        ) : logs.length === 0 ? (
          <p className="text-white/20 text-sm text-center py-8">No broadcasts sent yet</p>
        ) : (
          <div className="divide-y divide-white/5">
            {logs.map((log) => (
              <div key={log.id} className="py-3 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-bold truncate">{log.title}</p>
                  <p className="text-white/40 text-xs truncate mt-0.5">{log.message}</p>
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <div className="flex items-center gap-1.5 justify-end">
                    <Badge className="text-[9px] h-4 bg-white/10 text-white/50 border-white/10">{log.segment}</Badge>
                    <Badge className="text-[9px] h-4 bg-primary/10 text-primary border-primary/20">{log.channel}</Badge>
                  </div>
                  <p className="text-white/20 text-[10px]">{log.recipient_count} recipients</p>
                  <p className="text-white/20 text-[10px]">{new Date(log.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
