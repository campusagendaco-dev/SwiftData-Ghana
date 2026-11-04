import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  MessageCircle, X, Send, Loader2, Zap, Minus, Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";

// Fixed bot sender ID — matches the one in the support-bot edge function
const BOT_SENDER_ID = "00000000-0000-0000-0000-000000000001";

interface Message {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  is_bot?: boolean;
}

const SupportChat = () => {
  const { user, profile } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [botTyping, setBotTyping] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastSeenRef = useRef<string | null>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Clear unread count when chat is opened / not minimized
  useEffect(() => {
    if (isOpen && !isMinimized) {
      setUnreadCount(0);
      lastSeenRef.current = messages[messages.length - 1]?.id ?? null;
    }
  }, [isOpen, isMinimized, messages]);

  const subscribeToMessages = useCallback((convId: string) => {
    // Clean up any existing channel first
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const ch = supabase
      .channel(`support-${convId}`)
      .on(
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "support_messages",
          filter: `conversation_id=eq.${convId}`,
        },
        (payload: any) => {
          const msg = payload.new as Message;
          setMessages((prev) => {
            // Avoid duplicates (optimistic insert already added it)
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          // Increment unread if chat is closed or minimized and message is from support
          if (msg.sender_id !== user?.id) {
            setUnreadCount((n) => (isOpen && !isMinimized ? 0 : n + 1));
          }
        },
      )
      .subscribe();

    channelRef.current = ch;
  }, [user?.id, isOpen, isMinimized]);

  const initChat = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    // Find or create conversation
    let { data: conv } = await supabase
      .from("support_conversations")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!conv) {
      const { data: newConv, error } = await supabase
        .from("support_conversations")
        .insert([{ user_id: user.id }])
        .select()
        .single();
      if (error) {
        console.error("[SupportChat] create conv error:", error);
        setLoading(false);
        return;
      }
      conv = newConv;
    }

    if (!conv) { setLoading(false); return; }

    setConversationId(conv.id);

    // Fetch existing messages
    const { data: msgs } = await supabase
      .from("support_messages")
      .select("id, sender_id, content, created_at, is_bot")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true });

    setMessages(msgs || []);
    setLoading(false);

    // Subscribe to live messages
    subscribeToMessages(conv.id);
  }, [user, subscribeToMessages]);

  // Open / close chat
  useEffect(() => {
    if (isOpen && user && !conversationId) {
      initChat();
    }
    if (!isOpen && channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, [isOpen, user, conversationId, initChat]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !conversationId || !user || sending) return;

    setSending(true);
    const content = newMessage.trim();
    setNewMessage("");

    // Optimistic insert
    const optimistic: Message = {
      id: `opt-${Date.now()}`,
      sender_id: user.id,
      content,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    const { data: inserted, error } = await supabase
      .from("support_messages")
      .insert([{ conversation_id: conversationId, sender_id: user.id, content }])
      .select()
      .single();

    if (error) {
      // Roll back optimistic insert
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      console.error("[SupportChat] send error:", error);
      setSending(false);
      return;
    }

    if (inserted) {
      // Replace optimistic with real row
      setMessages((prev) => prev.map((m) => m.id === optimistic.id ? inserted : m));
      await supabase
        .from("support_conversations")
        .update({ last_message: content, last_message_at: new Date().toISOString() })
        .eq("id", conversationId);
    }

    setSending(false);

    // Trigger AI bot reply
    setBotTyping(true);
    try {
      await supabase.functions.invoke("support-bot", {
        body: { conversation_id: conversationId },
      });
    } catch (botErr) {
      console.error("[SupportChat] bot error:", botErr);
    } finally {
      setBotTyping(false);
    }
  };

  if (!user) return null;

  return (
    <div data-dash-float className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-4 pointer-events-none">
      {/* Chat Window */}
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className={cn(
            "w-[380px] max-w-[calc(100vw-48px)] bg-[#0d140d] border border-white/10 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col pointer-events-auto transition-all duration-300 origin-bottom-right",
            isMinimized ? "h-16" : "h-[500px]",
          )}
        >
          {/* Header */}
          <div className="h-16 px-6 bg-white/5 border-b border-white/5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <Zap className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-white font-black text-sm leading-none">SwiftSupport</p>
                <div className="flex items-center gap-1 mt-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500/80">Support Active</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setIsMinimized(!isMinimized)} 
                title={isMinimized ? "Expand chat" : "Minimize chat"}
                className="p-2 text-white/20 hover:text-white transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setIsOpen(false)} 
                title="Close chat"
                className="p-2 text-white/20 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Messages Area */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 scroll-smooth">
                {loading ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-3">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-white/20 text-xs font-black uppercase tracking-widest">Connecting to Support...</p>
                  </div>
                ) : messages.length > 0 ? (
                  <>
                    {messages.map((m) => {
                      const isMe = m.sender_id === user.id && !m.is_bot;
                      const isBot = m.is_bot || m.sender_id === BOT_SENDER_ID;
                      return (
                        <div key={m.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                          {isBot && (
                            <div className="flex items-center gap-1 mb-1 px-1">
                              <Bot className="w-3 h-3 text-primary/60" />
                              <span className="text-[9px] font-black text-primary/60 uppercase tracking-widest">SwiftBot</span>
                            </div>
                          )}
                          <div className={cn(
                            "max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed",
                            isMe
                              ? "bg-primary text-black font-medium rounded-tr-none shadow-lg shadow-primary/10"
                              : isBot
                              ? "bg-primary/10 text-white/90 rounded-tl-none border border-primary/20"
                              : "bg-white/5 text-white/80 rounded-tl-none border border-white/5",
                          )}>
                            {m.content}
                          </div>
                          <span className="text-[9px] font-black text-white/20 uppercase tracking-widest mt-1.5 px-1">
                            {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      );
                    })}
                    {/* Typing indicator while bot is generating */}
                    {botTyping && (
                      <div className="flex flex-col items-start">
                        <div className="flex items-center gap-1 mb-1 px-1">
                          <Bot className="w-3 h-3 text-primary/60" />
                          <span className="text-[9px] font-black text-primary/60 uppercase tracking-widest">SwiftBot</span>
                        </div>
                        <div className="bg-primary/10 border border-primary/20 rounded-2xl rounded-tl-none px-4 py-3 flex items-center gap-1.5">
                          {[0, 1, 2].map((i) => (
                            <motion.span
                              key={i}
                              animate={{ y: [0, -4, 0] }}
                              transition={{
                                repeat: Infinity,
                                duration: 0.6,
                                delay: i * 0.15,
                                ease: "easeInOut"
                              }}
                              className="w-1.5 h-1.5 bg-primary/60 rounded-full"
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 px-6">
                    <div className="w-16 h-16 rounded-[2rem] bg-white/5 flex items-center justify-center border border-white/10 shadow-2xl">
                      <MessageCircle className="w-8 h-8 text-white/10" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-white font-black">Hello {profile?.full_name?.split(" ")[0]}! 👋</p>
                      <p className="text-white/30 text-xs leading-relaxed">
                        Need help with a payment or have a question? Message us below and a support agent will assist you instantly.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Input Area */}
              <form onSubmit={handleSend} className="p-4 bg-white/5 border-t border-white/5 flex gap-2">
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type your message..."
                  className="bg-white/5 border-white/10 h-12 rounded-xl text-sm flex-1"
                />
                <Button type="submit" disabled={!newMessage.trim() || sending} title="Send message" className="h-12 w-12 rounded-xl p-0 shrink-0">
                  {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </Button>
              </form>
            </>
          )}
        </motion.div>
      )}

      {/* Floating Trigger Button */}
      {!isOpen && (
        <motion.button
          drag
          dragConstraints={{ left: -window.innerWidth + 80, right: 0, top: -window.innerHeight + 80, bottom: 0 }}
          whileDrag={{ scale: 1.1, cursor: "grabbing" }}
          onClick={() => setIsOpen(true)}
          title="Open support chat"
          className="group relative w-16 h-16 rounded-[2rem] bg-primary text-black flex items-center justify-center shadow-[0_15px_35px_rgba(251,191,36,0.4)] transition-all duration-500 hover:scale-110 active:scale-95 pointer-events-auto"
        >
          <div className="absolute -inset-2 bg-primary/20 rounded-[2.5rem] blur-xl opacity-0 group-hover:opacity-100 transition duration-500" />
          <MessageCircle className="w-7 h-7 relative z-10" />
          {/* Unread badge — only shown when there are actual unread messages */}
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 bg-red-500 text-white text-[10px] font-black rounded-full border-2 border-[#030703] flex items-center justify-center px-1 animate-bounce">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </motion.button>
      )}
    </div>
  );
};

export default SupportChat;
