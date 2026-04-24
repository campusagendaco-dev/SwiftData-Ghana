import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  LifeBuoy, Inbox, CheckCircle2, Loader2, Send, Search,
  RefreshCw, Clock, AlertCircle, ChevronDown, ChevronUp,
  User, Phone, Mail, MessageSquare, AlertTriangle, X,
} from "lucide-react";

interface UserInfo {
  user_id: string;
  full_name: string;
  email: string;
  phone: string;
}

interface Ticket {
  id: string;
  user_id: string | null;
  subject: string;
  description: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  admin_response: string | null;
  created_at: string;
  updated_at: string;
  userInfo?: UserInfo | null;
}

type FilterTab = "all" | "open" | "in_progress" | "resolved";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ElementType }> = {
  open:        { label: "Open",        color: "text-amber-400",  bg: "bg-amber-500/15",   border: "border-amber-500/25",  icon: Inbox },
  in_progress: { label: "In Progress", color: "text-blue-400",   bg: "bg-blue-500/15",    border: "border-blue-500/25",   icon: Clock },
  resolved:    { label: "Resolved",    color: "text-green-400",  bg: "bg-green-500/15",   border: "border-green-500/25",  icon: CheckCircle2 },
  closed:      { label: "Closed",      color: "text-white/30",   bg: "bg-white/5",        border: "border-white/10",      icon: X },
};

const SETUP_SQL = `-- Run this in Supabase Dashboard → SQL Editor
CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    admin_response TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage tickets" ON support_tickets FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Users view own tickets" ON support_tickets FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users create tickets" ON support_tickets FOR INSERT WITH CHECK (user_id = auth.uid());`;

const AdminTickets = () => {
  const { toast } = useToast();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [sqlCopied, setSqlCopied] = useState(false);
  const [activeTicket, setActiveTicket] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("support_tickets")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("support_tickets") || msg.includes("relation") || msg.includes("schema cache") || msg.includes("does not exist")) {
        setTableMissing(true);
        setLoading(false);
        return;
      }
      toast({ title: "Failed to load tickets", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const rows = (data || []) as Ticket[];
    setTableMissing(false);

    // Fetch user profiles separately (support_tickets.user_id → auth.users, not profiles directly)
    const userIds = [...new Set(rows.map(t => t.user_id).filter(Boolean))] as string[];
    const userMap: Record<string, UserInfo> = {};

    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, phone")
        .in("user_id", userIds);

      (profiles || []).forEach((p: any) => {
        userMap[p.user_id] = p as UserInfo;
      });
    }

    setTickets(rows.map(t => ({ ...t, userInfo: t.user_id ? (userMap[t.user_id] || null) : null })));
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const handleUpdateStatus = async (id: string, status: Ticket["status"]) => {
    setUpdatingStatus(id);
    const { error } = await (supabase as any)
      .from("support_tickets")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      toast({ title: "Failed to update status", description: error.message, variant: "destructive" });
    } else {
      setTickets(prev => prev.map(t => t.id === id ? { ...t, status } : t));
      toast({ title: `Ticket marked as ${status.replace("_", " ")}` });
    }
    setUpdatingStatus(null);
  };

  const handleReply = async (ticket: Ticket) => {
    const text = (replyText[ticket.id] || "").trim();
    if (!text) { toast({ title: "Enter a response first", variant: "destructive" }); return; }

    setSubmitting(ticket.id);
    const { error } = await (supabase as any)
      .from("support_tickets")
      .update({
        admin_response: text,
        status: "resolved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticket.id);

    if (error) {
      toast({ title: "Failed to reply", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Reply sent & ticket resolved" });
      setReplyText(prev => { const n = { ...prev }; delete n[ticket.id]; return n; });
      setActiveTicket(null);
      fetchTickets();
    }
    setSubmitting(null);
  };

  const handleCopySQL = async () => {
    await navigator.clipboard.writeText(SETUP_SQL);
    setSqlCopied(true);
    setTimeout(() => setSqlCopied(false), 2500);
  };

  const tabCounts = {
    all: tickets.length,
    open: tickets.filter(t => t.status === "open").length,
    in_progress: tickets.filter(t => t.status === "in_progress").length,
    resolved: tickets.filter(t => t.status === "resolved" || t.status === "closed").length,
  };

  const filtered = tickets.filter(t => {
    const matchSearch = !search || [t.subject, t.description, t.userInfo?.full_name, t.userInfo?.email, t.userInfo?.phone]
      .filter(Boolean).some(v => v!.toLowerCase().includes(search.toLowerCase()));
    if (!matchSearch) return false;
    if (filterTab === "open") return t.status === "open";
    if (filterTab === "in_progress") return t.status === "in_progress";
    if (filterTab === "resolved") return t.status === "resolved" || t.status === "closed";
    return true;
  });

  // ── Missing table state ──
  if (tableMissing) {
    return (
      <div className="space-y-6 pb-10">
        <div className="border-b border-white/5 pb-6">
          <h1 className="font-display text-3xl font-black tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
            Support Tickets
          </h1>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 overflow-hidden">
          <div className="p-6 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-amber-400 mb-1">Database Setup Required</h3>
              <p className="text-sm text-white/60 mb-4">
                The <code className="bg-white/10 px-1 rounded text-white/80">support_tickets</code> table doesn't exist yet.
                Copy the SQL below and run it in{" "}
                <a href="https://supabase.com/dashboard/project/lsocdjpflecduumopijn/sql" target="_blank" rel="noopener noreferrer"
                  className="text-amber-400 hover:text-amber-300 underline">
                  Supabase SQL Editor ↗
                </a>
              </p>
              <div className="relative rounded-xl overflow-hidden border border-white/10">
                <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10">
                  <span className="text-xs text-white/40 font-mono">SQL</span>
                  <button onClick={handleCopySQL}
                    className="text-xs font-bold px-3 py-1 rounded-lg transition-all"
                    style={{ background: sqlCopied ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.08)", color: sqlCopied ? "#4ade80" : "rgba(255,255,255,0.7)" }}>
                    {sqlCopied ? "Copied!" : "Copy SQL"}
                  </button>
                </div>
                <pre className="p-4 text-xs text-green-400/80 overflow-x-auto leading-relaxed font-mono bg-black/40">
                  {SETUP_SQL}
                </pre>
              </div>
              <p className="text-xs text-white/40 mt-3">After running the SQL, refresh this page.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <h1 className="font-display text-3xl font-black tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
            Support Tickets
          </h1>
          <p className="text-sm text-white/50 mt-1">Respond to user issues and manage ticket status.</p>
        </div>
        <Button onClick={fetchTickets} disabled={loading} className="gap-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-xl">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          { label: "Open", count: tabCounts.open, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
          { label: "In Progress", count: tabCounts.in_progress, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
          { label: "Resolved", count: tabCounts.resolved, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
          { label: "Total", count: tabCounts.all, color: "text-white", bg: "bg-white/5", border: "border-white/10" },
        ]).map(s => (
          <div key={s.label} className={`rounded-2xl ${s.bg} border ${s.border} p-4 text-center`}>
            <p className={`font-display text-2xl font-black ${s.color}`}>{s.count}</p>
            <p className="text-xs text-white/40 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs + Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-2 flex-wrap">
          {([
            { key: "all", label: "All" },
            { key: "open", label: "Open" },
            { key: "in_progress", label: "In Progress" },
            { key: "resolved", label: "Resolved" },
          ] as { key: FilterTab; label: string }[]).map(({ key, label }) => (
            <button key={key} onClick={() => setFilterTab(key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                filterTab === key
                  ? "bg-amber-400/20 text-amber-400 border border-amber-400/30"
                  : "bg-white/5 text-white/50 border border-white/10 hover:text-white/70"
              }`}>
              {label} <span className="opacity-60">({tabCounts[key]})</span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <Input placeholder="Search tickets, users..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl text-sm h-9 focus:border-amber-400/40" />
        </div>
      </div>

      {/* Ticket list */}
      {loading ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
          <p className="text-white/40 text-sm">Loading tickets...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <LifeBuoy className="w-12 h-12 text-white/10 mb-4" />
          <p className="text-white/40 font-semibold">
            {search ? "No tickets match your search" : filterTab === "all" ? "No tickets yet — inbox zero!" : `No ${filterTab.replace("_", " ")} tickets`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(ticket => {
            const cfg = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
            const StatusIcon = cfg.icon;
            const isExpanded = activeTicket === ticket.id;

            return (
              <div key={ticket.id} className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden">
                {/* Ticket header row */}
                <button
                  onClick={() => setActiveTicket(isExpanded ? null : ticket.id)}
                  className="w-full flex items-center gap-4 p-4 hover:bg-white/[0.03] transition-colors text-left"
                >
                  {/* Status icon */}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${cfg.bg} border ${cfg.border}`}>
                    <StatusIcon className={`w-4 h-4 ${cfg.color}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <p className="font-bold text-white text-sm truncate">{ticket.subject}</p>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
                        {cfg.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-white/40">
                      {ticket.userInfo ? (
                        <>
                          <span className="flex items-center gap-1"><User className="w-3 h-3" /> {ticket.userInfo.full_name || "Unknown"}</span>
                          {ticket.userInfo.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {ticket.userInfo.phone}</span>}
                          {ticket.userInfo.email && <span className="hidden sm:flex items-center gap-1"><Mail className="w-3 h-3" /> {ticket.userInfo.email}</span>}
                        </>
                      ) : (
                        <span className="text-white/20">Anonymous</span>
                      )}
                      <span>{new Date(ticket.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </div>

                  <div className="shrink-0 text-white/30">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-white/5 p-4 bg-black/20 space-y-4">
                    {/* User message */}
                    <div>
                      <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">User Message</p>
                      <div className="rounded-xl bg-white/5 border border-white/8 p-4 text-sm text-white/80 leading-relaxed whitespace-pre-wrap">
                        {ticket.description}
                      </div>
                    </div>

                    {/* Admin response (if exists) */}
                    {ticket.admin_response && (
                      <div>
                        <p className="text-xs font-bold text-amber-400/70 uppercase tracking-wider mb-2">Your Response</p>
                        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4 text-sm text-amber-100/80 leading-relaxed whitespace-pre-wrap">
                          {ticket.admin_response}
                        </div>
                      </div>
                    )}

                    {/* Status controls */}
                    <div>
                      <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Update Status</p>
                      <div className="flex flex-wrap gap-2">
                        {(["open", "in_progress", "resolved", "closed"] as Ticket["status"][]).map(s => {
                          const c = STATUS_CONFIG[s];
                          const isActive = ticket.status === s;
                          return (
                            <button key={s}
                              onClick={() => handleUpdateStatus(ticket.id, s)}
                              disabled={isActive || updatingStatus === ticket.id}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                                isActive ? `${c.bg} ${c.color} ${c.border}` : "bg-white/5 text-white/40 border-white/10 hover:text-white/70"
                              } disabled:opacity-50`}>
                              {updatingStatus === ticket.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <c.icon className={`w-3 h-3 ${isActive ? c.color : ""}`} />}
                              {c.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Reply form */}
                    <div>
                      <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">
                        {ticket.admin_response ? "Update Response" : "Reply to User"}
                      </p>
                      <Textarea
                        placeholder="Type your response to the user..."
                        value={replyText[ticket.id] || ticket.admin_response || ""}
                        onChange={e => setReplyText(prev => ({ ...prev, [ticket.id]: e.target.value }))}
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/30 resize-none rounded-xl text-sm focus:border-amber-400/40 min-h-[100px]"
                        rows={4}
                      />
                      <div className="flex gap-2 mt-2">
                        <Button
                          onClick={() => handleReply(ticket)}
                          disabled={submitting === ticket.id || !(replyText[ticket.id] || "").trim()}
                          className="bg-amber-400 text-black font-bold hover:bg-amber-300 rounded-xl gap-2"
                        >
                          {submitting === ticket.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          Send & Resolve
                        </Button>
                        {ticket.status !== "in_progress" && (
                          <Button variant="outline" size="sm"
                            onClick={() => handleUpdateStatus(ticket.id, "in_progress")}
                            disabled={updatingStatus === ticket.id}
                            className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10 rounded-xl">
                            Mark In Progress
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminTickets;
