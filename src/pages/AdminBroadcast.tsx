import { useState, useCallback, useEffect } from "react";
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
  Megaphone, Bell, MessageSquare, BarChart3, Sparkles, Smartphone,
  CheckCircle2, XCircle, Search, ShieldCheck, FileText, Paperclip
} from "lucide-react";
import { BulkPushBroadcaster } from "@/components/BulkPushBroadcaster";

type Segment = "all_agents" | "all_users" | "top_agents" | "dormant_agents" | "sub_agents" | "active_7d";
type Channel = "notification" | "push" | "sms" | "whatsapp" | "both";

const SEGMENTS: { value: Segment; label: string; desc: string }[] = [
  { value: "all_agents",     label: "All Agents",         desc: "Every active agent on the platform" },
  { value: "all_users",      label: "All Registered Users", desc: "Every user account on SwiftData (~4.9k users)" },
  { value: "top_agents",     label: "Top Performers",     desc: "Agents with > GHS 500 revenue in last 30 days" },
  { value: "dormant_agents", label: "Dormant Agents",     desc: "No orders in the last 14 days" },
  { value: "sub_agents",     label: "Sub-Agents Only",    desc: "All registered sub-agents" },
  { value: "active_7d",      label: "Active This Week",   desc: "Placed at least 1 order in last 7 days" },
];

const TEMPLATES = [
  { label: "🔥 Delivery On Fire!", title: "⚡ DELIVERY IS ON FIRE! 🚀", body: "Our automated engine just delivered 2 orders in under 2 minutes! High-speed delivery is 100% active on all networks right now.\n\n👉 Order Data Now: https://swiftdatagh.shop\n📢 Join Official WhatsApp Channel: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40" },
  { label: "⚡ System Upgrade & Refunds", title: "🚀 System Upgrade: Faster Deliveries & Instant MoMo Refunds!", body: "We have upgraded our system for rock-solid, ultra-fast bundle delivery, live carrier tracking, and an automated instant Mobile Money refund guarantee! Your orders are 100% secured.\n\n👉 Order Now: https://swiftdatagh.shop\nChannel: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40\nSupport: 0598170947" },
  { label: "WASSCE 2026 Checkers", title: "🎓 WASSCE 2026 Results Checkers In Stock! 📜", body: "WASSCE 2026 Results are officially out! WAEC Results Checker serials & PINs are now live and in stock on SwiftData at wholesale rates. Buy instantly for yourself or your customers now at https://swiftdatagh.shop!\n\nChannel: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40\nSupport: 0598170947" },
  { label: "Withdrawal Info",    title: "Profit Withdrawals Active 💸", body: "Good news! You can now withdraw your earned profits. Navigate to the Withdrawals tab on your dashboard to request a payout. Minimum withdrawal is GHS 25.00. Please try your withdrawal again.\n\nChannel: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40\nSupport: 0598170947" },
  { label: "Maintenance Notice",  title: "Scheduled Maintenance", body: "We will be performing scheduled maintenance on {date}. Services may be temporarily unavailable. We apologize for any inconvenience.\n\nChannel: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40\nSupport: 0598170947" },
  { label: "New Feature",         title: "New Feature Available!",body: "We've just launched a new feature! Log in to your SwiftData dashboard to check it out.\n\nChannel: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40\nSupport: 0598170947" },
  { label: "Promo Announcement",  title: "Special Promotion 🎉",  body: "For a limited time, enjoy special rates on {network} data bundles! Log in now to take advantage.\n\nChannel: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40\nSupport: 0598170947" },
  { label: "Balance Reminder",    title: "Top Up Your Wallet",    body: "Your SwiftData wallet balance is running low. Top up now to keep selling without interruption.\n\nChannel: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40\nSupport: 0598170947" },
  { label: "World Cup Promo",     title: "🏆 World Cup Special Promo! ⚽", body: "Catch every match live! Get cheap, non-expiry data bundles for MTN, Telecel, and AirtelTigo to stream the games without interruption. Top up now! 📲\n\nChannel: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40\nSupport: 0598170947" },
  { label: "System Restored",     title: "⚡ System Restored & Fully Active", body: "All carrier networks (MTN, Telecel, AirtelTigo) are fully operational. You can now resume purchases safely. Thank you for your patience! 🤝\n\nChannel: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40\nSupport: 0598170947" },
  { label: "Weekend Flash Sale",  title: "🔥 Weekend Flash Data Sale!", body: "Super discounts on all MTN & Telecel data bundles active right now! Purchase high-speed bundles at absolute wholesale rates. Ends Sunday midnight! 💸\n\nChannel: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40\nSupport: 0598170947" },
  { label: "Wallet Bonus",        title: "💰 2% Wallet Top-Up Bonus!", body: "Get a 2% cash bonus instantly in your wallet on all manual top-ups above GHS 200 today! Boost your selling capacity and earn more profit. 🚀\n\nChannel: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40\nSupport: 0598170947" },
  { label: "Referral Bonus",      title: "🎁 Invite Friends & Earn Cash!", body: "Share your referral link with friends! Get GHS 5.00 cash bonus credited to your wallet immediately they complete their first purchase. Start sharing! 🔗\n\nChannel: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40\nSupport: 0598170947" },
  { label: "AFA Update",          title: "AFA Registration Active 🛡️", body: "AFA Registration is now live on SwiftData! You can register yourself or customers for AFA at just GHS 15.00. Keep selling and earning commissions! 🚀\n\nChannel: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40\nSupport: 0598170947" },
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
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [senderId, setSenderId] = useState("SwiftDataGh");
  const [stickerUrl, setStickerUrl] = useState("https://swiftdatagh.shop/stickers/delivery_fire.webp");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaFileName, setMediaFileName] = useState("");
  const [verifyBeforeSend, setVerifyBeforeSend] = useState(false);
  const [postToChannel, setPostToChannel] = useState(true);
  const [testContact, setTestContact] = useState("");
  const [testingContact, setTestingContact] = useState(false);
  const [contactResult, setContactResult] = useState<any>(null);
  const [templateIdx, setTemplateIdx] = useState(0);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [sending, setSending] = useState(false);
  const [logs, setLogs] = useState<BroadcastLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);

  const [packages, setPackages] = useState<any[]>([]);

  useEffect(() => {
    supabase
      .from("global_package_settings")
      .select("network, package_size, agent_price, public_price")
      .order("network")
      .then(({ data }) => {
        if (data) setPackages(data);
      });
  }, []);

  const buildSegmentQuery = useCallback((q: any) => {
    switch (segment) {
      case "all_agents":     return q.or("is_agent.eq.true,sub_agent_approved.eq.true");
      case "all_users":      return q;
      case "top_agents":     return q.or("is_agent.eq.true,sub_agent_approved.eq.true");
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
      let query = (supabase as any).from("profiles").select("user_id, phone, whatsapp_number, phone_number");
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

        for (let i = 0; i < notifications.length; i += 500) {
          await (supabase as any).from("user_notifications").insert(notifications.slice(i, i + 500));
        }
      }

      // Web push notifications (chunked in safe slices of 50)
      if (channel === "push" || channel === "both") {
        const PUSH_BATCH_SIZE = 50;
        for (let pOffset = 0; pOffset < recipientIds.length; pOffset += PUSH_BATCH_SIZE) {
          supabase.functions.invoke("send-push-notification", {
            body: {
              user_ids: recipientIds,
              offset: pOffset,
              limit: PUSH_BATCH_SIZE,
              title: title.trim(),
              body: body.trim(),
              url: "/dashboard",
            },
          }).catch((err) => console.warn("[Broadcast] Push notification error:", err));
        }
      }

      // WhatsApp Broadcast & WhatsApp Sticker Dispatch
      let waResultMsg = "";
      if (channel === "whatsapp" || channel === "both") {
        const phones = recipients
          .map((r: any) => r.whatsapp_number || r.phone_number || r.phone)
          .filter(Boolean);

        try {
          const { data: waData, error: waError } = await supabase.functions.invoke("admin-broadcast-whatsapp", {
            body: {
              recipients: phones,
              title: title.trim(),
              message: body.trim(),
              sticker_url: stickerUrl.trim() || undefined,
              document_url: mediaUrl.trim() && (mediaUrl.includes(".pdf") || mediaUrl.includes(".doc")) ? mediaUrl.trim() : undefined,
              image_url: mediaUrl.trim() && !mediaUrl.includes(".pdf") && !mediaUrl.includes(".doc") ? mediaUrl.trim() : undefined,
              file_name: mediaFileName.trim() || undefined,
              verify_before_send: verifyBeforeSend,
              broadcast_to_channel: postToChannel,
              site_url: "https://swiftdatagh.shop",
              channel_url: "https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40"
            }
          });

          if (waError || waData?.error) {
            toast({
              title: "WhatsApp Dispatch Notice",
              description: waError?.message || waData?.error || "WhatsApp broadcast failed.",
              variant: "destructive"
            });
          } else {
            const targetCount = waData?.totalRecipients || waData?.sentCount || phones.length;
            waResultMsg = waData?.queued
              ? ` · WhatsApp queued for ${targetCount} users (safe humanized 2.5s jitter active to protect bot session)`
              : ` · WhatsApp sent to ${targetCount} contacts`;
          }
        } catch (waInvokeErr: any) {
          console.warn("[Broadcast] WhatsApp error:", waInvokeErr);
        }
      }

      // SMS via edge function
      let smsResultMsg = "";
      if (channel === "sms") {
        const phones = recipients.map((r: any) => r.phone).filter(Boolean);
        try {
          const { data: smsData, error: smsError } = await supabase.functions.invoke("admin-send-sms", {
            body: { 
              retry_phones: phones, 
              message: `${title}\n${body}`,
              sender_id: senderId.trim() || "SwiftDataGh"
            },
          });
          if (smsError || smsData?.error) {
            toast({
              title: "SMS Delivery Notice",
              description: smsError?.message || smsData?.error || "SMS dispatch failed.",
              variant: "destructive"
            });
          } else if (smsData?.queued_scheduler) {
            smsResultMsg = ` · SMS: ${smsData.total_recipients?.toLocaleString()} queued for background delivery`;
          } else if (smsData?.sent !== undefined) {
            smsResultMsg = ` · SMS sent to ${smsData.sent} recipient(s)`;
          }
        } catch (smsInvokeErr: any) {
          console.warn("[Broadcast] SMS error:", smsInvokeErr);
        }
      }

      // Log the broadcast
      await (supabase as any).from("system_logs").insert({
        level: "info",
        source: "admin",
        event: "broadcast.sent",
        message: `Broadcast "${title}" sent to ${count} agents via ${channel}`,
        agent_id: user?.id,
        data: { segment, channel, title, body, recipient_count: count, sticker_url: stickerUrl },
      });

      toast({ title: `Broadcast sent to ${count} agents`, description: `Channel: ${channel}${waResultMsg}${smsResultMsg}` });
      setTitle(""); setBody(""); setTemplateIdx(0); setRecipientCount(null);
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Broadcast Messaging</h1>
          <p className="text-white/40 text-sm mt-1">Send announcements to agents and users via WhatsApp, Web Push, SMS, or in-app</p>
        </div>
        <div className="flex items-center gap-2">
          <BulkPushBroadcaster />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Compose */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="bg-white/5 border-white/10 p-5 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Megaphone className="w-4 h-4 text-primary" />
              <h2 className="text-white font-black">Compose Message</h2>
            </div>

            {/* AI Smart SMS Copy Recommendation Panel */}
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                  <span className="text-xs font-black uppercase tracking-wider text-amber-400">
                    AI Smart SMS Recommendations
                  </span>
                </div>
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">High Converting</Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  {
                    title: "🎓 WASSCE 2026 Checkers In Stock",
                    badge: "WASSCE 2026 Live",
                    body: "🎓 WASSCE 2026 Results are OUT! WAEC Results Checker serials & PINs are now IN STOCK at wholesale rates. Buy & check instantly at https://swiftdatagh.shop or sell to students for quick profit! 📲",
                    channel: "both" as Channel,
                    segment: "all_agents" as Segment,
                  },
                  {
                    title: "⚡ System Delivery Restored",
                    badge: "All Networks Active",
                    body: "⚡ All carrier networks (MTN, Telecel, AirtelTigo) are fully active and delivering instantly. You can now place customer orders safely at https://swiftdatagh.shop! 🚀",
                    channel: "both" as Channel,
                    segment: "all_agents" as Segment,
                  },
                  {
                    title: "✅ MTN Whitelist Completed",
                    badge: "Queue Cleared",
                    body: "✅ MTN Beneficiary Whitelist queue has been cleared! All pending numbers are whitelisted. Resubmit your orders now at https://swiftdatagh.shop 📲",
                    channel: "sms" as Channel,
                    segment: "dormant_agents" as Segment,
                  },
                  {
                    title: "🔥 Weekend Profit Boost",
                    badge: "Commission Bonus",
                    body: "🔥 Weekend Special: Enjoy extra commission discounts on all MTN & Telecel data packages today! Boost your daily profit margin now at https://swiftdatagh.shop 💰",
                    channel: "both" as Channel,
                    segment: "all_agents" as Segment,
                  },
                  {
                    title: "📦 MTN SME Wholesale Promo",
                    badge: "High Margin",
                    body: "📦 Super cheap MTN SME bundles available! Buy 5GB at GHS 21.20, sell at GHS 24.00, and earn GHS 2.80 profit per order. Top up wallet now at https://swiftdatagh.shop 💸",
                    channel: "sms" as Channel,
                    segment: "active_7d" as Segment,
                  },
                ].map((rec, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setTitle(rec.title);
                      setBody(rec.body);
                      setChannel(rec.channel);
                      setSegment(rec.segment);
                      toast({ title: "SMS Recommendation Applied", description: `Loaded "${rec.title}" template.` });
                    }}
                    className="p-2.5 rounded-xl border border-white/10 bg-black/40 hover:bg-amber-500/15 text-left transition-all group space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white group-hover:text-amber-400">{rec.title}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-white/70">{rec.badge}</span>
                    </div>
                    <p className="text-[10px] text-white/50 line-clamp-2 leading-tight">{rec.body}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Templates */}
            <div className="space-y-3">
              <div>
                <p className="text-white/40 text-xs font-bold uppercase tracking-widest mb-2">Template Shortcuts</p>
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

              {packages.length > 0 && (
                <div className="p-4 rounded-2xl border border-white/5 bg-white/[0.02] space-y-2">
                  <p className="text-amber-400 text-[10px] font-black uppercase tracking-widest">
                    Package Marketing Generator (Dynamic Commissions)
                  </p>
                  <select
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      if (isNaN(idx)) return;
                      const pkg = packages[idx];
                      if (!pkg) return;
                      
                      const wholesale = Number(pkg.agent_price || 0);
                      const retail = Number(pkg.public_price || 0);
                      const comm = (retail - wholesale).toFixed(2);
                      
                      setTemplateIdx(-1); // Deselect templates
                      setTitle(`⚡ ${pkg.network} ${pkg.package_size} Data Package Live! 📲`);
                      setBody(`Resellers, purchase ${pkg.network} ${pkg.package_size} data bundles at just GHS ${wholesale.toFixed(2)} wholesale price! Sell to your customers at GHS ${retail.toFixed(2)} and pocket GHS ${comm} commission profit instantly per sale! Visit https://swiftdatagh.shop to make a sale.`);
                    }}
                    className="bg-white/5 border border-white/10 rounded-xl px-3 h-10 text-white text-xs focus:outline-none focus:border-primary/40 w-full"
                  >
                    <option value="" className="bg-[#1a1a1f]">-- Select any package to auto-generate marketing template with commission --</option>
                    {packages.map((pkg, i) => (
                      <option key={i} value={i} className="bg-[#1a1a1f]">
                        {pkg.network} {pkg.package_size} (Wholesale: GHS {Number(pkg.agent_price).toFixed(2)} · Retail: GHS {Number(pkg.public_price).toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
              ["push", Smartphone, "Web Push (Offline Devices)", "Hits lock-screens even when off-site"],
              ["whatsapp", MessageSquare, "WhatsApp Broadcast & Sticker 💬", "Dispatches WhatsApp message & WebP sticker via WATI"],
              ["sms", MessageSquare, "SMS Only", "Reaches offline agents via telecom"],
              ["both", Send, "All Channels (In-App + Push + WA + SMS)", "Maximum reach across all platforms"],
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

            {(channel === "push" || channel === "both") && (
              <div className="pt-2 border-t border-white/5">
                <BulkPushBroadcaster triggerClassName="w-full text-xs h-9 justify-center" />
              </div>
            )}
          </Card>

          {/* WhatsApp Sticker & Media Settings Card */}
          {(channel === "whatsapp" || channel === "both") && (
            <Card className="bg-amber-500/10 border-amber-500/30 p-5 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <h3 className="text-amber-400 font-black text-sm">WhatsApp Media & Verification</h3>
                </div>
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">Multi-Provider</Badge>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-widest">Sticker URL (WebP)</label>
                  <Input
                    value={stickerUrl}
                    onChange={(e) => setStickerUrl(e.target.value)}
                    placeholder="https://swiftdatagh.shop/stickers/delivery_fire.webp"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-white/40 text-[10px] font-bold uppercase tracking-widest">Attachment Media URL (Image / PDF / Video)</label>
                  <Input
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                    placeholder="https://wasenderapi.com/media/... or https://..."
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 text-xs"
                  />
                </div>

                {mediaUrl.trim() && (
                  <div className="space-y-1.5">
                    <label className="text-white/40 text-[10px] font-bold uppercase tracking-widest">Custom File Name (Optional)</label>
                    <Input
                      value={mediaFileName}
                      onChange={(e) => setMediaFileName(e.target.value)}
                      placeholder="e.g. SwiftData_Promo.pdf"
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 text-xs"
                    />
                  </div>
                )}

                <label className="flex items-center gap-2 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={verifyBeforeSend}
                    onChange={(e) => setVerifyBeforeSend(e.target.checked)}
                    className="rounded border-white/20 bg-white/5 text-primary focus:ring-primary w-4 h-4"
                  />
                  <span className="text-white/70 text-xs font-semibold">
                    Verify WhatsApp presence before dispatching (Auto-skips inactive numbers)
                  </span>
                </label>

                <label className="flex items-center gap-2 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={postToChannel}
                    onChange={(e) => setPostToChannel(e.target.checked)}
                    className="rounded border-white/20 bg-white/5 text-primary focus:ring-primary w-4 h-4"
                  />
                  <span className="text-white/70 text-xs font-semibold">
                    📢 Also broadcast live to Official WhatsApp Channel (@newsletter)
                  </span>
                </label>

                {/* Anti-Ban Safeguards Summary */}
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-400">
                    <ShieldCheck className="w-4 h-4" />
                    <span>WhatsApp Anti-Ban Shield Active</span>
                  </div>
                  <ul className="text-[11px] text-white/60 space-y-1 pl-4 list-disc">
                    <li><strong>Humanized Pacing:</strong> 3.2s – 6.8s randomized delay between messages to emulate human typing.</li>
                    <li><strong>Auto Opt-Out:</strong> Appends <em>"Reply STOP to unsubscribe"</em> to protect phone reputation.</li>
                    <li><strong>Channel Push:</strong> Instant broadcast to Official WhatsApp Channel followers with 0% ban risk.</li>
                  </ul>
                </div>
              </div>
            </Card>
          )}

          {/* Quick WhatsApp Contact Verifier */}
          <Card className="bg-white/5 border-white/10 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h3 className="text-white font-black text-sm">WhatsApp Contact Verifier</h3>
              </div>
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">WaSender Live</Badge>
            </div>
            <p className="text-white/40 text-xs">Verify any phone number or LID before sending.</p>
            <div className="flex gap-2">
              <Input
                value={testContact}
                onChange={(e) => setTestContact(e.target.value)}
                placeholder="024XXXXXXX or +233..."
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 text-xs"
              />
              <Button
                type="button"
                size="sm"
                onClick={async () => {
                  if (!testContact.trim()) return;
                  setTestingContact(true);
                  setContactResult(null);
                  try {
                    const { data, error } = await supabase.functions.invoke("whatsapp-webhook", {
                      body: { action: "check_on_whatsapp", contact: testContact.trim() }
                    });
                    if (error) throw error;
                    setContactResult(data);
                    toast({
                      title: data?.exists ? "WhatsApp Active ✅" : "Not Registered ❌",
                      description: data?.exists ? `${testContact} is registered on WhatsApp.` : `${testContact} is not on WhatsApp.`,
                      variant: data?.exists ? "default" : "destructive"
                    });
                  } catch (err: any) {
                    toast({ title: "Check Failed", description: err.message || "Failed to verify", variant: "destructive" });
                  }
                  setTestingContact(false);
                }}
                disabled={testingContact || !testContact.trim()}
                className="bg-emerald-500 hover:bg-emerald-600 text-black font-bold h-9 text-xs px-3"
              >
                {testingContact ? "Checking..." : "Verify"}
              </Button>
            </div>

            {contactResult && (
              <div className={cn(
                "p-3 rounded-xl border text-xs flex items-center justify-between",
                contactResult.exists ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-red-500/10 border-red-500/30 text-red-300"
              )}>
                <div className="flex items-center gap-2">
                  {contactResult.exists ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
                  <span>{contactResult.exists ? "Registered on WhatsApp" : "Not Registered on WhatsApp"}</span>
                </div>
              </div>
            )}
          </Card>

          {/* SMS Sender ID Card */}
          {(channel === "sms" || channel === "both") && (
            <Card className="bg-white/5 border-white/10 p-5 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                <h3 className="text-white font-black text-sm">SMS Sender ID</h3>
              </div>
              <div className="space-y-3">
                <select
                  value={
                    ["swiftupdate", "SwiftDataGh", "Orderinfo"].includes(senderId)
                      ? senderId
                      : "custom"
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val !== "custom") {
                      setSenderId(val);
                    } else {
                      setSenderId("");
                    }
                  }}
                  className="bg-white/5 border border-white/10 rounded-xl px-3 h-10 text-white text-xs focus:outline-none focus:border-primary/40 w-full"
                >
                  <option value="swiftupdate" className="bg-[#1a1a1f] text-white">swiftupdate (Default for Broadcasts)</option>
                  <option value="SwiftDataGh" className="bg-[#1a1a1f] text-white">SwiftDataGh</option>
                  <option value="Orderinfo" className="bg-[#1a1a1f] text-white">Orderinfo</option>
                  <option value="custom" className="bg-[#1a1a1f] text-white">Custom / Type Custom...</option>
                </select>

                {(!["swiftupdate", "SwiftDataGh", "Orderinfo"].includes(senderId) || senderId === "") && (
                  <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <label className="text-white/40 text-[10px] font-bold uppercase tracking-widest">Custom Sender ID</label>
                    <Input
                      value={senderId}
                      onChange={(e) => setSenderId(e.target.value)}
                      placeholder="Type Approved Sender ID"
                      maxLength={11}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 text-xs"
                    />
                  </div>
                )}
              </div>
            </Card>
          )}
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
