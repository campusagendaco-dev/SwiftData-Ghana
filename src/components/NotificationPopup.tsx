import { useState, useEffect, useRef } from "react";
import { useAuth, Profile } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Bell, X, Info, Zap, AlertCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { playSound, safeVibrate } from "@/lib/sound";

interface Notification {
  id: string;
  title: string;
  message: string;
  target_type: string;
  created_at: string;
}

const NOTIFICATION_SOUND = "/sounds/notification_system.mp3";

const NotificationPopup = () => {
  const { user, profile } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const settingsRef = useRef({
    tone: "/sounds/notification_system.mp3",
    vibeEnabled: true,
    vibePattern: "200,100,200"
  });

  useEffect(() => {
    if (!user) return;

    let active = true;

    const fetchNotifications = async () => {
      // 1. Fetch custom audio & vibe settings
      const { data: sysSettings } = await supabase
        .from("public_system_settings")
        .select("notification_tone, notification_vibration_enabled, notification_vibration_pattern")
        .eq("id", 1)
        .maybeSingle();

      let currentTone = "/sounds/notification_system.mp3";
      let currentVibeEnabled = true;
      let currentVibePattern = "200,100,200";

      if (sysSettings) {
        if (sysSettings.notification_tone) currentTone = sysSettings.notification_tone;
        currentVibeEnabled = sysSettings.notification_vibration_enabled !== false;
        if (sysSettings.notification_vibration_pattern) currentVibePattern = sysSettings.notification_vibration_pattern;

        settingsRef.current = {
          tone: currentTone,
          vibeEnabled: currentVibeEnabled,
          vibePattern: currentVibePattern
        };
      }

      // 2. Fetch notifications
      const { data: dismissals } = await supabase
        .from("notification_dismissals")
        .select("notification_id")
        .eq("user_id", user.id);

      const dismissedIds = (dismissals || []).map((d: any) => d.notification_id);

      const { data: notifs } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false });

      if (!notifs || !active) return;

      const p = profile as Profile | null;
      const isAgent = Boolean(p?.agent_approved || p?.sub_agent_approved || p?.is_agent || p?.is_sub_agent);
      
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
          if (!active) return;
          setIsVisible(true);
          playPing(currentTone, currentVibeEnabled, currentVibePattern);
        }, 1500);
      }
    };

    fetchNotifications();

    // REAL-TIME NOTIFICATION SUBSCRIBER: Listen for instant webhook alerts (deposits/purchases)
    const uniqueChannelName = `public-notifications-live-${user.id}-${Math.random().toString(36).substring(7)}`;
    const channel = supabase
      .channel(uniqueChannelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const newNotif = payload.new as Notification;
          const p = profile as Profile | null;
          const isAgent = Boolean(p?.agent_approved || p?.sub_agent_approved || p?.is_agent || p?.is_sub_agent);
          
          let matches = false;
          if (newNotif.target_type === "all") matches = true;
          else if (newNotif.target_type === "agents" && isAgent) matches = true;
          else if (newNotif.target_type === "users" && !isAgent) matches = true;
          else if (newNotif.target_type === "specific" && newNotif.target_user_id === user.id) matches = true;

          if (matches && active) {
            setNotifications(prev => [newNotif, ...prev]);
            setIsVisible(true);
            playPing(settingsRef.current.tone, settingsRef.current.vibeEnabled, settingsRef.current.vibePattern);
          }
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [user, profile]);

  const playPing = (
    customTone = settingsRef.current.tone,
    customVibeEnabled = settingsRef.current.vibeEnabled,
    customVibePattern = settingsRef.current.vibePattern
  ) => {
    if (customTone) {
      playSound(customTone, 0.4);
    }

    if (customVibeEnabled && customVibePattern) {
      const pattern = String(customVibePattern)
        .split(",")
        .map(Number)
        .filter((num) => !isNaN(num) && num >= 0);
      if (pattern.length > 0) safeVibrate(pattern);
    }
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
          playPing(settingsRef.current.tone, settingsRef.current.vibeEnabled, settingsRef.current.vibePattern);
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
                      title="Dismiss notification"
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
