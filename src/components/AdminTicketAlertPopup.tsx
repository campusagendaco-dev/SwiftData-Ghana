import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  LifeBuoy,
  Send,
  Sparkles,
  X,
  Loader2,
  User,
  Phone,
  Bell,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { showSafeBrowserNotification } from "@/utils/safeBrowserNotification";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

interface LiveTicket {
  id: string;
  user_id: string | null;
  subject: string;
  description: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  admin_response: string | null;
  created_at: string;
  customer_name?: string;
  customer_phone?: string;
}

export default function AdminTicketAlertPopup() {
  const navigate = useNavigate();
  const { supported, permissionState, subscribeUser, loading: pushLoading } = usePushNotifications();
  const [tickets, setTickets] = useState<LiveTicket[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [aiDraftingId, setAiDraftingId] = useState<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  const enrichWithProfiles = useCallback(async (rows: LiveTicket[]): Promise<LiveTicket[]> => {
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
    if (userIds.length === 0) return rows;

    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, phone")
      .in("user_id", userIds);

    const map = new Map<string, { full_name?: string; phone?: string }>();
    (profiles || []).forEach((p: any) => {
      map.set(p.user_id, { full_name: p.full_name, phone: p.phone });
    });

    return rows.map((row) => {
      const prof = row.user_id ? map.get(row.user_id) : undefined;
      return {
        ...row,
        customer_name: prof?.full_name || row.customer_name || "Customer",
        customer_phone: prof?.phone || row.customer_phone || "",
      };
    });
  }, []);

  const loadActionableTickets = useCallback(async () => {
    try {
      const { data } = await (supabase as any)
        .from("support_tickets")
        .select("id, user_id, subject, description, status, admin_response, created_at")
        .in("status", ["open", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(5);

      if (!Array.isArray(data)) return;
      const enriched = await enrichWithProfiles(data as LiveTicket[]);

      if (initializedRef.current) {
        enriched.forEach((t) => {
          if (!seenIdsRef.current.has(t.id)) {
            seenIdsRef.current.add(t.id);
            toast.info(`🎫 New Support Ticket: ${t.subject}`, {
              description: `${t.customer_name || "Customer"} needs a quick reply.`,
              duration: 7000,
            });
            void showSafeBrowserNotification("🎫 New Support Ticket", {
              body: `${t.customer_name || "Customer"}: ${t.subject}`,
              tag: `admin-ticket-${t.id}`,
              url: "/admin/tickets",
            });
          }
        });
      } else {
        enriched.forEach((t) => seenIdsRef.current.add(t.id));
        initializedRef.current = true;
      }

      setTickets(enriched);
    } catch {
      // Ignore transient load errors
    }
  }, [enrichWithProfiles]);

  useEffect(() => {
    void loadActionableTickets();

    const channel = supabase
      .channel("admin-live-support-tickets")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_tickets" },
        async (payload: any) => {
          const row = payload.new as LiveTicket | undefined;
          if (!row?.id) return;

          if (row.status === "open" || row.status === "in_progress") {
            const [enriched] = await enrichWithProfiles([row]);
            const isBrandNew = !seenIdsRef.current.has(row.id);
            seenIdsRef.current.add(row.id);

            setTickets((prev) => {
              const filtered = prev.filter((t) => t.id !== row.id);
              return [enriched, ...filtered].slice(0, 5);
            });

            if (isBrandNew) {
              setDismissedIds((prev) => {
                const next = new Set(prev);
                next.delete(row.id);
                return next;
              });
              toast.info(`🎫 New Support Ticket: ${enriched.subject}`, {
                description: `${enriched.customer_name || "Customer"} needs quick help.`,
                duration: 8000,
              });
              void showSafeBrowserNotification("🎫 New Support Ticket", {
                body: `${enriched.customer_name || "Customer"}: ${enriched.subject}`,
                tag: `admin-ticket-${row.id}`,
                url: "/admin/tickets",
              });
            }
          } else {
            setTickets((prev) => prev.filter((t) => t.id !== row.id));
          }
        }
      )
      .subscribe();

    // 30s fallback refresh in case realtime drops on flaky mobile networks
    const poll = window.setInterval(() => {
      void loadActionableTickets();
    }, 30000);

    return () => {
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [enrichWithProfiles, loadActionableTickets]);

  const handleAiDraft = async (ticket: LiveTicket) => {
    setAiDraftingId(ticket.id);
    try {
      const prompt = `Act as SwiftData Ghana Support (Ama). Draft a warm, concise (2-3 sentences), helpful response to resolve this customer ticket:
Customer: ${ticket.customer_name || "Customer"}
Subject: ${ticket.subject}
Details: ${ticket.description}
Output only the reply text with no quotes or prefix.`;

      const { data, error } = await supabase.functions.invoke("oracle-ai", {
        body: { message: prompt },
      });
      if (error) throw error;
      const draft = String(data?.oracle_opinion || "").trim();
      if (!draft) throw new Error("AI returned an empty draft");
      setReplyDrafts((prev) => ({ ...prev, [ticket.id]: draft }));
    } catch (err: any) {
      toast.error(err?.message || "Could not generate AI draft");
    } finally {
      setAiDraftingId(null);
    }
  };

  const handleQuickResolve = async (ticket: LiveTicket) => {
    const reply = (replyDrafts[ticket.id] || "").trim();
    if (!reply) {
      toast.error("Type a quick response (or tap AI Draft) first.");
      return;
    }

    setBusyId(ticket.id);
    try {
      const { data, error } = await supabase.functions.invoke("auto-ticket-resolver", {
        body: {
          action: "admin_reply",
          ticket_id: ticket.id,
          response: reply,
          status: "resolved",
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
      setReplyDrafts((prev) => {
        const next = { ...prev };
        delete next[ticket.id];
        return next;
      });
      toast.success(`Resolved & notified ${ticket.customer_name || "customer"}!`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to send reply");
    } finally {
      setBusyId(null);
    }
  };

  const visible = tickets.filter((t) => !dismissedIds.has(t.id));
  if (visible.length === 0) return null;

  const active = visible[0];

  return (
    <div className="fixed bottom-4 left-4 lg:left-72 z-[9998] w-[calc(100vw-2rem)] max-w-sm">
      <div className="rounded-2xl border border-primary/40 bg-zinc-950/95 backdrop-blur-xl text-white shadow-2xl shadow-black/60 p-4 space-y-3 animate-in slide-in-from-bottom-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 rounded-xl bg-primary/15 border border-primary/30 shrink-0">
              <LifeBuoy className="w-4 h-4 text-primary animate-pulse" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-black uppercase tracking-wider text-primary">
                  Quick Ticket Alert
                </span>
                <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[9px] px-1.5 py-0">
                  {visible.length} OPEN
                </Badge>
              </div>
              <p className="text-[11px] text-zinc-400 truncate">Reply right here — user is notified live</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissedIds((prev) => new Set(prev).add(active.id))}
            className="text-zinc-500 hover:text-white p-1 shrink-0"
            title="Dismiss for now"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {supported && permissionState !== "granted" && (
          <button
            type="button"
            onClick={() => void subscribeUser()}
            disabled={pushLoading}
            className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[11px] font-semibold hover:bg-amber-500/25 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-amber-400" />
              Enable browser push alerts for tickets
            </span>
            <span className="text-[10px] font-black uppercase text-amber-400">
              {pushLoading ? "..." : "Allow"}
            </span>
          </button>
        )}

        <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-semibold truncate">
              <User className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span className="truncate">{active.customer_name || "Customer"}</span>
            </div>
            {active.customer_phone && (
              <span className="flex items-center gap-1 text-[10px] font-mono text-zinc-400 shrink-0">
                <Phone className="w-3 h-3" />
                {active.customer_phone}
              </span>
            )}
          </div>
          <p className="font-bold text-white text-xs leading-snug">{active.subject}</p>
          <p className="text-[11px] text-zinc-300 line-clamp-3 leading-snug">{active.description}</p>
          {active.admin_response && (
            <p className="text-[10px] text-primary/90 italic pt-1 border-t border-white/10 line-clamp-2">
              Ama AI: &ldquo;{active.admin_response}&rdquo;
            </p>
          )}
        </div>

        <Textarea
          value={replyDrafts[active.id] || ""}
          onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [active.id]: e.target.value }))}
          placeholder="Type a quick response to resolve & notify user..."
          rows={2}
          className="bg-black/40 border-white/15 text-xs text-white placeholder:text-zinc-500 rounded-xl resize-none"
        />

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={aiDraftingId === active.id || busyId === active.id}
            onClick={() => void handleAiDraft(active)}
            className="border-primary/40 text-primary hover:bg-primary/15 text-xs h-9 px-2.5"
            title="Generate AI reply draft"
          >
            {aiDraftingId === active.id ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
          </Button>
          <Button
            size="sm"
            disabled={busyId === active.id}
            onClick={() => void handleQuickResolve(active)}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs h-9"
          >
            {busyId === active.id ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            )}
            Reply & Resolve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate("/admin/tickets")}
            className="text-zinc-400 hover:text-white text-xs h-9 px-2"
            title="Open full tickets page"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
