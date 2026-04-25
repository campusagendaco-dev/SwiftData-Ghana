import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { 
  MessageCircle, X, Send, User, 
  Loader2, ShieldCheck, Zap, Minus, 
  Maximized2, ExternalLink
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Message {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

const SupportChat = () => {
  const { user, profile } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && user) {
      initChat();
    }
  }, [isOpen, user]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const initChat = async () => {
    if (!user) return;
    setLoading(true);
    
    // 1. Find or create conversation
    let { data: conv, error: convError } = await supabase
      .from("support_conversations")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!conv && !convError) {
      const { data: newConv } = await supabase
        .from("support_conversations")
        .insert([{ user_id: user.id }])
        .select()
        .single();
      conv = newConv;
    }

    if (conv) {
      setConversationId(conv.id);
      // 2. Fetch messages
      const { data: msgs } = await supabase
        .from("support_messages")
        .select("*")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: true });
      
      setMessages(msgs || []);

      // 3. Subscribe to new messages
      const channel = supabase
        .channel(`support-${conv.id}`)
        .on("postgres_changes", { 
          event: "INSERT", 
          schema: "public", 
          table: "support_messages", 
          filter: `conversation_id=eq.${conv.id}` 
        }, (payload: any) => {
          setMessages(prev => [...prev, payload.new as Message]);
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
    setLoading(false);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !conversationId || !user || sending) return;

    setSending(true);
    const content = newMessage.trim();
    setNewMessage("");

    const { error } = await supabase
      .from("support_messages")
      .insert([
        {
          conversation_id: conversationId,
          sender_id: user.id,
          content
        }
      ]);

    if (error) {
      console.error("Error sending message:", error);
    } else {
      // Update last_message in conversation
      await supabase
        .from("support_conversations")
        .update({ 
          last_message: content, 
          last_message_at: new Date().toISOString(),
          unread_count_admin: supabase.rpc('increment', { row_id: conversationId }) // This needs a function or manual increment
        })
        .eq("id", conversationId);
    }
    setSending(false);
  };

  if (!user) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-4 pointer-events-none">
      {/* Chat Window */}
      {isOpen && (
        <div className={cn(
          "w-[380px] max-w-[calc(100vw-48px)] bg-[#0d140d] border border-white/10 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col pointer-events-auto transition-all duration-300 origin-bottom-right",
          isMinimized ? "h-16" : "h-[500px]"
        )}>
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
              <button onClick={() => setIsMinimized(!isMinimized)} className="p-2 text-white/20 hover:text-white transition-colors">
                <Minus className="w-4 h-4" />
              </button>
              <button onClick={() => setIsOpen(false)} className="p-2 text-white/20 hover:text-white transition-colors">
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
                  messages.map((m) => {
                    const isMe = m.sender_id === user.id;
                    return (
                      <div key={m.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                        <div className={cn(
                          "max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed",
                          isMe 
                            ? "bg-primary text-black font-medium rounded-tr-none shadow-lg shadow-primary/10" 
                            : "bg-white/5 text-white/80 rounded-tl-none border border-white/5"
                        )}>
                          {m.content}
                        </div>
                        <span className="text-[9px] font-black text-white/20 uppercase tracking-widest mt-1.5 px-1">
                          {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 px-6">
                    <div className="w-16 h-16 rounded-[2rem] bg-white/5 flex items-center justify-center border border-white/10 shadow-2xl">
                      <MessageCircle className="w-8 h-8 text-white/10" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-white font-black">Hello {profile?.full_name?.split(" ")[0]}! 👋</p>
                      <p className="text-white/30 text-xs leading-relaxed">
                        Need help with a payment or have a question? Message us below and an agent will assist you instantly.
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
                <Button type="submit" disabled={!newMessage.trim() || sending} className="h-12 w-12 rounded-xl p-0 shrink-0">
                  {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </Button>
              </form>
            </>
          )}
        </div>
      )}

      {/* Floating Trigger Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="group relative w-16 h-16 rounded-[2rem] bg-primary text-black flex items-center justify-center shadow-[0_15px_35px_rgba(251,191,36,0.4)] transition-all duration-500 hover:scale-110 active:scale-95 pointer-events-auto"
        >
          <div className="absolute -inset-2 bg-primary/20 rounded-[2.5rem] blur-xl opacity-0 group-hover:opacity-100 transition duration-500" />
          <MessageCircle className="w-7 h-7 relative z-10" />
          {/* Notification dot */}
          <span className="absolute top-0 right-0 w-4 h-4 bg-red-500 rounded-full border-2 border-[#030703] animate-bounce" />
        </button>
      )}
    </div>
  );
};

export default SupportChat;
