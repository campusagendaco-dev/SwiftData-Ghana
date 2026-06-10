import { useState, useEffect, useRef } from "react";
import { useAuth, Profile } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Bell, X, Info, Zap, AlertCircle, Gift, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { playSound, safeVibrate } from "@/lib/sound";
import { useNavigate } from "react-router-dom";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription
} from "@/components/ui/dialog";

interface Notification {
  id: string;
  title: string;
  message: string;
  target_type: string;
  created_at: string;
}

const NotificationPopup = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const settingsRef = useRef({
    tone: "/sounds/notification_system.mp3",
    vibeEnabled: true,
    vibePattern: "200,100,200"
  });
  const dismissingRef = useRef<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!user) {
      fetchedRef.current = false;
      return;
    }

    // Prevent duplicate fetch loops when profile/user updates
    if (fetchedRef.current) return;

    // Wait for profile data to load so we know user's role (isAgent status)
    if (!profile) return;

    fetchedRef.current = true;
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
      
      // Calculate user signup time to avoid historical notifications spam
      const userJoinedAt = new Date(p?.created_at || user.created_at || 0).getTime();
      
      const filtered = notifs.filter((n: any) => {
        if (dismissedIds.includes(n.id)) return false;

        // Skip historical announcements created before the user signed up
        const notifTime = new Date(n.created_at).getTime();
        if (notifTime < userJoinedAt) return false;

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
    if (!current || !user || dismissingRef.current === current.id) return;

    dismissingRef.current = current.id;
    setIsVisible(false);

    // Wait for animation to finish before updating state/DB
    setTimeout(async () => {
      await supabase.from("notification_dismissals").insert({
        notification_id: current.id,
        user_id: user.id,
      });

      const remaining = notifications.slice(1);
      setNotifications(remaining);
      dismissingRef.current = null;
      
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

  const isReferral = current.title.toLowerCase().includes("refer") || current.message.toLowerCase().includes("refer");
  const isWallet = current.title.toLowerCase().includes("wallet") || current.title.toLowerCase().includes("deposit") || current.message.toLowerCase().includes("wallet") || current.message.toLowerCase().includes("deposit");

  return (
    <Dialog open={isVisible} onOpenChange={(open) => { if (!open) handleDismiss(); }}>
      <DialogContent className="sm:max-w-[450px] p-0 overflow-hidden border-none bg-transparent shadow-2xl z-[100]">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-[#0A0A0F] border border-white/10 shadow-2xl">
          {/* Animated Background Elements */}
          <div className={`absolute top-0 right-0 w-64 h-64 ${
            isReferral ? "bg-emerald-500/10 shadow-emerald-500/10" : isWallet ? "bg-amber-500/10 shadow-amber-500/10" : "bg-sky-500/10 shadow-sky-500/10"
          } rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2 animate-pulse`} />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-slate-500/5 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2" />

          {/* Content Wrapper */}
          <div className="relative z-10 p-8 md:p-10 flex flex-col items-center text-center">
            {/* Icon Header */}
            <div className="mb-6 relative">
              <div className={`w-20 h-20 rounded-3xl ${
                isReferral ? "bg-emerald-500/20 border-emerald-500/20 text-emerald-400" : isWallet ? "bg-amber-500/20 border-amber-500/20 text-amber-400" : "bg-sky-500/20 border-sky-500/20 text-sky-400"
              } border flex items-center justify-center`}>
                {isReferral ? (
                  <Gift className="w-10 h-10" />
                ) : isWallet ? (
                  <Zap className="w-10 h-10" />
                ) : (
                  <Bell className="w-10 h-10" />
                )}
              </div>
              <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center shadow-lg border-2 border-[#0A0A0F]">
                <Sparkles className="w-4 h-4 text-black" />
              </div>
            </div>

            <DialogHeader className="space-y-3">
              <DialogTitle className="text-2xl font-black text-white tracking-tight leading-tight uppercase">
                {current.title}
              </DialogTitle>
              <DialogDescription className="text-white/60 text-sm leading-relaxed max-w-sm">
                {current.message}
              </DialogDescription>
            </DialogHeader>

            {/* Feature Pills */}
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {current.target_type === "agents" ? (
                <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/5 text-[10px] font-black uppercase tracking-widest text-white/40 flex items-center gap-1.5">
                  <Zap className="w-3 h-3 text-sky-400" />
                  Pro Agent Alert
                </div>
              ) : current.target_type === "specific" ? (
                <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/5 text-[10px] font-black uppercase tracking-widest text-white/40 flex items-center gap-1.5">
                  <Zap className="w-3 h-3 text-sky-400" />
                  Secure Direct Alert
                </div>
              ) : (
                <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/5 text-[10px] font-black uppercase tracking-widest text-white/40 flex items-center gap-1.5">
                  <Zap className="w-3 h-3 text-sky-400" />
                  Platform Update
                </div>
              )}

              {isReferral && (
                <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/5 text-[10px] font-black uppercase tracking-widest text-white/40 flex items-center gap-1.5">
                  <Gift className="w-3 h-3 text-emerald-400" />
                  Instant Rewards
                </div>
              )}
              {isWallet && (
                <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/5 text-[10px] font-black uppercase tracking-widest text-white/40 flex items-center gap-1.5">
                  <Zap className="w-3 h-3 text-amber-400" />
                  Wallet Credit
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="mt-10 w-full flex flex-col gap-3">
              <Button 
                onClick={async () => {
                  handleDismiss();
                  if (isReferral) navigate("/dashboard/referral");
                  else if (isWallet) navigate("/dashboard/wallet");
                }}
                className={`w-full h-14 rounded-2xl ${
                  isReferral 
                    ? "bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20 text-black" 
                    : isWallet 
                    ? "bg-amber-400 hover:bg-amber-500 text-black shadow-amber-400/20" 
                    : "bg-sky-500 hover:bg-sky-600 shadow-sky-500/20 text-black"
                } font-black text-sm uppercase tracking-widest shadow-xl transition-all active:scale-95`}
              >
                {notifications.length > 1 
                  ? `Next Update (${notifications.length - 1} remaining)` 
                  : isReferral 
                  ? "Start Earning Now" 
                  : isWallet 
                  ? "View Wallet Now" 
                  : "Got It"}
              </Button>
              <button 
                onClick={handleDismiss}
                className="text-[10px] font-bold text-white/25 uppercase tracking-widest hover:text-white/40 transition-colors py-2"
              >
                Dismiss for now
              </button>
            </div>
          </div>
          
          {/* Close Button Override */}
          <button 
            onClick={handleDismiss}
            className="absolute top-6 right-6 p-2 rounded-full bg-white/5 hover:bg-white/10 transition-all border border-white/5"
            title="Close"
          >
            <X className="w-4 h-4 text-white/40" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default NotificationPopup;
