import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  MessageCircle, Search, Send,
  Loader2, CheckCircle2, Trash2, Bot, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";

// Matches the fixed bot sender ID in the support-bot edge function
const BOT_SENDER_ID = "00000000-0000-0000-0000-000000000001";

const ESCALATION_RE = /escalat|human support|support agent|follow up shortly|review.*conversation/i;

interface Conversation {
  id: string;
  user_id: string;
  last_message: string;
  last_message_at: string;
  profiles?: {
    full_name: string;
    store_name: string;
  };
}

interface Message {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  is_bot?: boolean;
}

const AdminSupport = () => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [botReplying, setBotReplying] = useState(false);
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConversations();

    const channel = supabase
      .channel("admin-support-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_conversations" }, () => {
        fetchConversations();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (selectedConv) {
      fetchMessages(selectedConv.id);

      const channel = supabase
        .channel(`admin-support-${selectedConv.id}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "support_messages",
          filter: `conversation_id=eq.${selectedConv.id}`,
        }, (payload: any) => {
          setMessages(prev => [...prev, payload.new as Message]);
        })
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    }
  }, [selectedConv]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchConversations = async () => {
    const { data } = await supabase
      .from("support_conversations")
      .select("*, profiles:user_id(full_name, store_name)")
      .order("last_message_at", { ascending: false });
    setConversations((data as any) || []);
    setLoading(false);
  };

  const fetchMessages = async (convId: string) => {
    const { data } = await supabase
      .from("support_messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    setMessages(data || []);
  };

  /** Save a Q&A pair to the AI knowledge base so the bot can learn from admin replies */
  const saveKnowledge = async (question: string, answer: string) => {
    await Promise.resolve(
      (supabase as any)
        .from("ai_support_knowledge")
        .insert({ question, answer })
    ).catch(() => {/* non-critical */});
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedConv || !user || sending) return;

    setSending(true);
    const content = newMessage.trim();
    setNewMessage("");

    // If the bot previously escalated, save this admin reply as learned knowledge
    const lastBotMsg = [...messages].reverse().find(
      m => m.sender_id === BOT_SENDER_ID || m.is_bot
    );
    const lastUserMsg = [...messages].reverse().find(
      m => m.sender_id !== user.id && m.sender_id !== BOT_SENDER_ID && !m.is_bot
    );
    if (lastBotMsg && lastUserMsg && ESCALATION_RE.test(lastBotMsg.content)) {
      saveKnowledge(lastUserMsg.content, content);
    }

    const { error } = await supabase
      .from("support_messages")
      .insert([{ conversation_id: selectedConv.id, sender_id: user.id, content }]);

    if (!error) {
      await supabase
        .from("support_conversations")
        .update({ last_message: content, last_message_at: new Date().toISOString() })
        .eq("id", selectedConv.id);
    }
    setSending(false);
  };

  /** Invoke SwiftBot to auto-reply to the current conversation */
  const handleAiReply = async () => {
    if (!selectedConv || botReplying) return;
    setBotReplying(true);
    try {
      const { error } = await supabase.functions.invoke("support-bot", {
        body: { conversation_id: selectedConv.id },
      });
      if (error) throw error;
      toast.success("SwiftBot replied");
    } catch (err: any) {
      toast.error("AI reply failed: " + (err?.message || "unknown error"));
    } finally {
      setBotReplying(false);
    }
  };

  const handleMarkResolved = async () => {
    if (!selectedConv) return;
    await (supabase as any)
      .from("support_conversations")
      .update({ status: "resolved" })
      .eq("id", selectedConv.id);
    toast.success("Conversation marked resolved");
    fetchConversations();
  };

  const handleDelete = async () => {
    if (!selectedConv) return;
    await supabase.from("support_messages" as any).delete().eq("conversation_id", selectedConv.id);
    await supabase.from("support_conversations" as any).delete().eq("id", selectedConv.id);
    setSelectedConv(null);
    setMessages([]);
    fetchConversations();
  };

  const filtered = conversations.filter(c =>
    !search || c.profiles?.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.last_message?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-[calc(100vh-100px)] flex bg-card border border-border shadow-xl rounded-[2.5rem] overflow-hidden my-6">

      {/* ── Sidebar ── */}
      <div className="w-80 border-r border-border flex flex-col bg-muted/20">
        <div className="p-6 border-b border-border bg-muted/30">
          <h2 className="text-xl font-black text-foreground flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-primary" />
            Support Inbox
          </h2>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search chats..."
              className="pl-10 h-10 bg-background border-border text-foreground placeholder:text-muted-foreground/40 rounded-xl text-xs focus:ring-primary/20"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-10 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground/30" />
            </div>
          ) : filtered.length > 0 ? (
            filtered.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => setSelectedConv(c)}
                className={cn(
                  "w-full p-4 flex items-center gap-3 border-b border-border/50 transition-all text-left",
                  selectedConv?.id === c.id
                    ? "bg-primary/10 dark:bg-primary/20 border-r-2 border-r-primary"
                    : "hover:bg-muted/50"
                )}
              >
                <Avatar className="w-10 h-10 border border-border">
                  <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${c.user_id}`} />
                  <AvatarFallback>{c.profiles?.full_name?.charAt(0)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-foreground font-black text-sm truncate">{c.profiles?.full_name}</p>
                    <span className="text-[8px] text-muted-foreground/60 font-black uppercase tracking-widest">
                      {new Date(c.last_message_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-muted-foreground/60 text-[10px] font-medium truncate">{c.profiles?.store_name}</p>
                  <p className="text-muted-foreground text-xs truncate mt-1 font-medium">{c.last_message}</p>
                </div>
              </button>
            ))
          ) : (
            <div className="p-10 text-center text-muted-foreground/50 text-sm font-medium">No active chats</div>
          )}
        </div>
      </div>

      {/* ── Main Chat Area ── */}
      <div className="flex-1 flex flex-col bg-background">
        {selectedConv ? (
          <>
            {/* Header */}
            <div className="h-20 px-6 border-b border-border flex items-center justify-between bg-muted/30 shrink-0">
              <div className="flex items-center gap-4">
                <Avatar className="w-10 h-10 border border-border">
                  <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedConv.user_id}`} />
                  <AvatarFallback>{selectedConv.profiles?.full_name?.charAt(0)}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-foreground font-black text-base">{selectedConv.profiles?.full_name}</p>
                  <p className="text-primary text-[10px] font-black uppercase tracking-widest leading-none mt-0.5">
                    {selectedConv.profiles?.store_name}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* AI Reply button */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAiReply}
                  disabled={botReplying}
                  className="h-9 rounded-xl gap-2 font-bold shadow-sm border-primary/30 text-primary hover:bg-primary/10"
                >
                  {botReplying
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Sparkles className="w-4 h-4" />
                  }
                  AI Reply
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleMarkResolved}
                  className="h-9 rounded-xl bg-background border-border hover:bg-muted font-bold gap-2 shadow-sm"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  Resolve
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  className="h-9 w-9 rounded-xl text-red-500 hover:bg-red-500/10 hover:text-red-600 p-0"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-8 space-y-5 bg-muted/10">
              {messages.map((m) => {
                const isAdmin = m.sender_id === user?.id && !m.is_bot;
                const isBot = m.is_bot || m.sender_id === BOT_SENDER_ID;
                const isEscalation = isBot && ESCALATION_RE.test(m.content);

                return (
                  <div key={m.id} className={cn("flex flex-col", isAdmin ? "items-end" : "items-start")}>
                    {isBot && (
                      <div className="flex items-center gap-1 mb-1 px-1">
                        <Bot className="w-3 h-3 text-primary/60" />
                        <span className="text-[9px] font-black text-primary/60 uppercase tracking-widest">SwiftBot</span>
                        {isEscalation && (
                          <span className="ml-1 text-[8px] font-black uppercase tracking-widest bg-amber-500/15 text-amber-500 border border-amber-500/25 px-1.5 py-0.5 rounded-md">
                            Escalated
                          </span>
                        )}
                      </div>
                    )}
                    <div className={cn(
                      "max-w-[70%] px-5 py-3 rounded-[1.5rem] text-sm leading-relaxed shadow-sm",
                      isAdmin
                        ? "bg-primary text-primary-foreground font-semibold rounded-tr-none shadow-md"
                        : isBot
                        ? isEscalation
                          ? "bg-amber-500/10 text-foreground rounded-tl-none border border-amber-500/30"
                          : "bg-primary/8 text-foreground rounded-tl-none border border-primary/20"
                        : "bg-card text-foreground rounded-tl-none border border-border font-medium"
                    )}>
                      {m.content}
                    </div>
                    <span className="text-[9px] font-black text-muted-foreground/40 uppercase tracking-widest mt-2 px-2">
                      {new Date(m.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Input */}
            <form onSubmit={handleSend} className="p-6 bg-card border-t border-border flex gap-3 shadow-[0_-4px_20px_rgba(0,0,0,0.02)] shrink-0">
              <Input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type your response… (admin replies are learned by SwiftBot)"
                className="bg-muted/30 border-border text-foreground h-14 rounded-2xl flex-1 px-6 focus:ring-primary/20 text-sm"
              />
              <Button
                type="submit"
                disabled={!newMessage.trim() || sending}
                className="h-14 px-8 rounded-2xl font-black text-xs uppercase tracking-widest gap-2 shadow-lg hover:shadow-xl shadow-primary/20 transition-all"
              >
                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                Send
              </Button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-10 space-y-6 bg-muted/20">
            <div className="w-24 h-24 rounded-[3rem] bg-card border border-border flex items-center justify-center shadow-xl shadow-muted/30">
              <MessageCircle className="w-12 h-12 text-muted-foreground/30" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-black text-foreground tracking-tight">Select a Chat</h3>
              <p className="text-muted-foreground text-sm font-medium max-w-xs mx-auto leading-relaxed">
                Choose a conversation from the sidebar. Use <span className="text-primary font-bold">AI Reply</span> to let SwiftBot respond instantly, or type a manual reply below — it will be learned.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminSupport;
