import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Bell, X, Info, Zap, AlertCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";

interface Notification {
  id: string;
  title: string;
  message: string;
  target_type: string;
  created_at: string;
}

const NOTIFICATION_SOUND = "https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3";

const NotificationPopup = () => {
  const { user, profile } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!user) return;

    const fetchNotifications = async () => {
      const { data: dismissals } = await supabase
        .from("notification_dismissals")
        .select("notification_id")
        .eq("user_id", user.id);

      const dismissedIds = (dismissals || []).map((d: any) => d.notification_id);

      const { data: notifs } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false });

      if (!notifs) return;

      const isAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved || profile?.is_agent || profile?.is_sub_agent);
      
      const filtered = notifs.filter((n: any) => {
        if (dismissedIds.includes(n.id)) return false;
        if (n.target_type === "all") return true;
        if (n.target_type === "agents" && isAgent) return true;
        if (n.target_type === "users" && !isAgent) return true;
        if (n.target_type === "specific" && n.target_user_id === user.id) return true;
        return false;
      });

      if (filtered.length > 0) {
        setNotifications(filtered);
        // Delay visibility slightly for dramatic effect
        setTimeout(() => {
          setIsVisible(true);
          playPing();
        }, 1500);
      }
    };

    fetchNotifications();
  }, [user, profile]);

  const playPing = () => {
    const audio = new Audio(NOTIFICATION_SOUND);
    audio.volume = 0.4;
    audio.play().catch(() => {
      console.log("[NotificationPopup] Audio blocked by browser");
    });
  };

  const handleDismiss = async () => {
    const current = notifications[0];
    if (!current || !user) return;

    setIsVisible(false);

    // Wait for animation to finish before updating state/DB
    setTimeout(async () => {
      await supabase.from("notification_dismissals").insert({
        notification_id: current.id,
        user_id: user.id,
      });

      const remaining = notifications.slice(1);
      setNotifications(remaining);
      
      if (remaining.length > 0) {
        setTimeout(() => {
          setIsVisible(true);
          playPing();
        }, 1000);
      }
    }, 400);
  };

  if (notifications.length === 0) return null;

  const current = notifications[0];

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 100, scale: 0.9, x: "-50%" }}
          animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
          exit={{ opacity: 0, y: 50, scale: 0.95, x: "-50%" }}
          className="fixed bottom-6 left-1/2 z-[100] w-full max-w-md px-4"
        >
          <div className="relative group">
            {/* Glow effect */}
            <div className="absolute -inset-1 bg-gradient-to-r from-sky-500/20 via-primary/20 to-indigo-500/20 rounded-3xl blur-xl opacity-100" />
            
            <div className="relative bg-[#0F0F12]/90 backdrop-blur-2xl border border-white/10 rounded-2xl p-5 shadow-2xl overflow-hidden">
              {/* Progress bar (aesthetic) */}
              <div className="absolute bottom-0 left-0 h-0.5 bg-sky-500/40 w-full animate-in slide-in-from-left duration-[5000ms]" />
              
              <div className="flex gap-4">
                <div className="shrink-0 w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
                  <Bell className="w-6 h-6 text-sky-400" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-black text-white tracking-tight uppercase">{current.title}</h3>
                    <button 
                      onClick={handleDismiss}
                      className="p-1 rounded-lg hover:bg-white/5 text-white/20 hover:text-white/60 transition-all"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-white/50 leading-relaxed line-clamp-3 mb-4">
                    {current.message}
                  </p>
                  
                  <div className="flex items-center gap-2">
                    <Button 
                      onClick={handleDismiss}
                      size="sm"
                      className="h-8 px-4 bg-sky-500 hover:bg-sky-400 text-black font-black text-[10px] uppercase rounded-lg shadow-lg shadow-sky-500/10"
                    >
                      {notifications.length > 1 ? `Next (${notifications.length})` : "Got it"}
                    </Button>
                    <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest ml-auto">
                      Official Update
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NotificationPopup;
