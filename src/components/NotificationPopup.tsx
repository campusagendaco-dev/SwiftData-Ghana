import { useState, useEffect, useRef } from "react";
import { useAuth, Profile } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { 
  X, Sparkles, Phone, ChevronRight, Heart, MessageCircle
} from "lucide-react";
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
  target_user_id?: string | null;
  created_at: string;
}

interface NotificationMeta {
  category: string;
  badgeText: string;
  icon: "zap" | "tv" | "phone" | "gift" | "wallet" | "data" | "bell";
  gradient: string;
  blobColor: string;
  badgeColor: string;
  btnGradient: string;
  actionUrl: string;
  actionLabel: string;
  emoji: string;
  tagEmoji: string;
}

function getNotificationMeta(title: string, message: string, targetType: string): NotificationMeta {
  const combined = `${title || ""} ${message || ""}`.toLowerCase();

  // 1. ECG Electricity Prepaid
  if (combined.includes("ecg") || combined.includes("prepaid") || combined.includes("electricity") || combined.includes("meter")) {
    return {
      category: "ECG Prepaid",
      badgeText: "Instant Meter Recharge",
      icon: "zap",
      gradient: "from-amber-400 via-emerald-400 to-teal-400",
      blobColor: "bg-emerald-500/25",
      badgeColor: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
      btnGradient: "from-emerald-400 via-teal-400 to-cyan-400 shadow-emerald-500/30 text-slate-950",
      actionUrl: "/buy-utility",
      actionLabel: "⚡ Recharge Meter Now",
      emoji: "💡",
      tagEmoji: "⚡",
    };
  }

  // 2. DStv & GOtv Television
  if (combined.includes("dstv") || combined.includes("gotv") || combined.includes("decoder") || combined.includes("showmax") || combined.includes("tv sub")) {
    return {
      category: "TV & Entertainment",
      badgeText: "DStv & GOtv Renewal",
      icon: "tv",
      gradient: "from-fuchsia-400 via-purple-400 to-pink-500",
      blobColor: "bg-fuchsia-500/25",
      badgeColor: "bg-fuchsia-500/15 border-fuchsia-500/30 text-fuchsia-300",
      btnGradient: "from-fuchsia-500 via-pink-500 to-rose-400 shadow-fuchsia-500/30 text-white",
      actionUrl: "/buy-utility",
      actionLabel: "🍿 Renew Decoder Now",
      emoji: "📺",
      tagEmoji: "✨",
    };
  }

  // 3. Airtime Top-Up
  if (combined.includes("airtime") || combined.includes("talktime")) {
    return {
      category: "Airtime Top-Up",
      badgeText: "Instant Airtime 24/7",
      icon: "phone",
      gradient: "from-cyan-400 via-sky-400 to-blue-500",
      blobColor: "bg-cyan-500/25",
      badgeColor: "bg-cyan-500/15 border-cyan-500/30 text-cyan-300",
      btnGradient: "from-cyan-400 via-sky-400 to-indigo-500 shadow-cyan-500/30 text-slate-950",
      actionUrl: "/buy-airtime",
      actionLabel: "⚡ Top Up Airtime Now",
      emoji: "📲",
      tagEmoji: "🚀",
    };
  }

  // 4. Referral & Bonuses
  if (combined.includes("refer") || combined.includes("invite") || combined.includes("bonus") || combined.includes("commission")) {
    return {
      category: "Rewards & Cash",
      badgeText: "Special Rewards Live",
      icon: "gift",
      gradient: "from-pink-400 via-rose-400 to-amber-400",
      blobColor: "bg-rose-500/25",
      badgeColor: "bg-rose-500/15 border-rose-500/30 text-rose-300",
      btnGradient: "from-rose-500 via-pink-500 to-amber-400 shadow-rose-500/30 text-white",
      actionUrl: "/dashboard/marketing",
      actionLabel: "🎁 Claim My Bonus",
      emoji: "🎁",
      tagEmoji: "🎉",
    };
  }

  // 5. Wallet Top-Up
  if (combined.includes("wallet") || combined.includes("deposit")) {
    return {
      category: "Wallet Top-Up",
      badgeText: "Instant Wallet Top-Up",
      icon: "wallet",
      gradient: "from-amber-400 via-yellow-400 to-orange-400",
      blobColor: "bg-amber-500/25",
      badgeColor: "bg-amber-500/15 border-amber-500/30 text-amber-300",
      btnGradient: "from-amber-400 via-yellow-400 to-orange-400 shadow-amber-500/30 text-slate-950",
      actionUrl: "/dashboard/wallet",
      actionLabel: "💰 View Wallet Balance",
      emoji: "💸",
      tagEmoji: "✨",
    };
  }

  // 6. Data Bundles
  if (combined.includes("data") || combined.includes("bundle") || combined.includes("sme") || combined.includes("mash up")) {
    return {
      category: "Data Bundles",
      badgeText: "Wholesale Data Rates",
      icon: "data",
      gradient: "from-violet-400 via-purple-400 to-indigo-500",
      blobColor: "bg-violet-500/25",
      badgeColor: "bg-violet-500/15 border-violet-500/30 text-violet-300",
      btnGradient: "from-violet-500 via-purple-500 to-indigo-500 shadow-violet-500/30 text-white",
      actionUrl: "/buy-data",
      actionLabel: "🚀 Buy Cheap Data Now",
      emoji: "⚡",
      tagEmoji: "🔥",
    };
  }

  // Default Announcement
  return {
    category: targetType === "agents" ? "Pro Agent Notice" : "Official Update",
    badgeText: targetType === "agents" ? "⚡ Pro Agent Notice" : "✨ Special Announcement",
    icon: "bell",
    gradient: "from-sky-400 via-indigo-400 to-purple-500",
    blobColor: "bg-sky-500/20",
    badgeColor: "bg-sky-500/15 border-sky-500/30 text-sky-300",
    btnGradient: "from-sky-400 via-indigo-500 to-purple-500 shadow-sky-500/30 text-white",
    actionUrl: "/dashboard",
    actionLabel: "✨ Explore Update",
    emoji: "🔔",
    tagEmoji: "✨",
  };
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

    if (fetchedRef.current) return;
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
      const userJoinedAt = new Date((p as any)?.created_at || user.created_at || 0).getTime();
      
      const filtered = notifs.filter((n: any) => {
        if (dismissedIds.includes(n.id)) return false;
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
        setTimeout(() => {
          if (!active) return;
          setIsVisible(true);
          playPing(currentTone, currentVibeEnabled, currentVibePattern);
        }, 1200);
      }
    };

    fetchNotifications();

    // REAL-TIME NOTIFICATION SUBSCRIBER
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
    if (customTone) playSound(customTone, 0.4);
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
        }, 800);
      }
    }, 300);
  };

  if (notifications.length === 0) return null;

  const current = notifications[0];
  const meta = getNotificationMeta(current.title, current.message, current.target_type);

  // Extract support phone or whatsapp if present in message
  const supportMatch = current.message.match(/(?:Support:\s*|tel:?)(\d{9,12})/i);
  const supportPhone = supportMatch ? supportMatch[1] : null;

  const whatsappMatch = current.message.match(/https:\/\/whatsapp\.com\/channel\/[^\s]+/i);
  const whatsappUrl = whatsappMatch ? whatsappMatch[0] : null;

  // Clean title: convert overly aggressive all-caps into attractive Title/Sentence case
  const formatCuteTitle = (raw: string) => {
    if (!raw) return "New Update For You ✨";
    // If it's shouting all uppercase, make it natural
    if (raw === raw.toUpperCase() && raw.length > 15) {
      return raw.charAt(0) + raw.slice(1).toLowerCase().replace(/(^\w{1})|(\s+\w{1})/g, (letter) => letter.toUpperCase());
    }
    return raw;
  };

  // Clean body text from raw repetitive URLs to make it friendly
  const cleanBodyText = current.message
    .replace(/https?:\/\/[^\s]+/gi, "")
    .replace(/(?:Support:\s*\d{9,12})/gi, "")
    .replace(/Channel:\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return (
    <Dialog open={isVisible} onOpenChange={(open) => { if (!open) handleDismiss(); }}>
      <DialogContent className="sm:max-w-[420px] w-[94vw] p-0 overflow-visible border-none bg-transparent shadow-none [&>button.absolute]:hidden z-[100]">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-[#0c0d18]/95 backdrop-blur-3xl border border-white/[0.14] shadow-[0_25px_70px_rgba(0,0,0,0.85)] p-6 sm:p-8 text-center animate-in zoom-in-95 duration-200">
          
          {/* Top aesthetic gradient shimmer bar */}
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-pink-500 via-amber-400 to-cyan-400 opacity-90" />

          {/* Dynamic ambient background glow matching the category */}
          <div className={`absolute -top-12 -right-12 w-48 h-48 ${meta.blobColor} rounded-full blur-[70px] pointer-events-none animate-pulse`} />
          <div className="absolute -bottom-12 -left-12 w-44 h-44 bg-sky-500/15 rounded-full blur-[70px] pointer-events-none" />

          {/* Single, Cute Floating Close Button */}
          <button 
            type="button"
            onClick={handleDismiss}
            aria-label="Close announcement"
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/[0.18] border border-white/10 flex items-center justify-center text-white/50 hover:text-white transition-all hover:rotate-90 duration-200 z-20 group"
          >
            <X className="w-4 h-4 group-hover:scale-110 transition-transform" />
          </button>

          {/* Multiple updates indicator pill */}
          {notifications.length > 1 && (
            <div className="mb-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-[11px] font-bold text-white/70">
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>Update 1 of {notifications.length}</span>
              <div className="flex gap-1 ml-1">
                {notifications.slice(0, 4).map((_, idx) => (
                  <span
                    key={idx}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${
                      idx === 0 ? "bg-amber-400 w-3" : "bg-white/20"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 3D Cute Icon Badge */}
          <div className="mx-auto mb-4 relative inline-block">
            <div className={`w-18 h-18 sm:w-20 sm:h-20 rounded-[1.75rem] p-0.5 bg-gradient-to-br ${meta.gradient} shadow-[0_12px_30px_rgba(0,0,0,0.5)] transition-transform hover:scale-105 active:scale-95 duration-200`}>
              <div className="w-full h-full rounded-[1.65rem] bg-[#121324] flex items-center justify-center relative overflow-hidden">
                <div className={`absolute inset-0 bg-gradient-to-br ${meta.gradient} opacity-20`} />
                <span className="text-3xl sm:text-4xl filter drop-shadow-md select-none transform transition-transform group-hover:scale-110">
                  {meta.emoji}
                </span>
              </div>
            </div>

            {/* Cute Sparkle Corner Bubble */}
            <div className="absolute -top-1.5 -right-1.5 w-7 h-7 rounded-full bg-gradient-to-tr from-amber-400 to-yellow-300 shadow-[0_0_15px_rgba(251,191,36,0.6)] flex items-center justify-center text-slate-950 font-black text-xs border-2 border-[#0c0d18] animate-bounce [animation-duration:2.5s]">
              {meta.tagEmoji}
            </div>
          </div>

          {/* Category Pill */}
          <div className="mb-3 flex justify-center">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider border shadow-sm ${meta.badgeColor}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping" />
              {meta.badgeText}
            </span>
          </div>

          {/* Dialog Title & Description */}
          <DialogHeader className="space-y-2.5">
            <DialogTitle className="text-lg sm:text-xl font-black text-white tracking-tight leading-snug px-2">
              {formatCuteTitle(current.title)}
            </DialogTitle>
            <DialogDescription className="text-white/70 text-xs sm:text-sm leading-relaxed max-w-sm mx-auto font-medium">
              {cleanBodyText || current.message}
            </DialogDescription>
          </DialogHeader>

          {/* Quick Contact & Channel Chips (if present) */}
          {(supportPhone || whatsappUrl) && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {supportPhone && (
                <a
                  href={`tel:${supportPhone}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-[11px] font-bold text-white/80 hover:text-white transition-colors"
                >
                  <Phone className="w-3 h-3 text-emerald-400" />
                  <span>Call: {supportPhone}</span>
                </a>
              )}
              {whatsappUrl && (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-[11px] font-bold text-emerald-300 hover:text-emerald-200 transition-colors"
                >
                  <MessageCircle className="w-3 h-3 text-emerald-400" />
                  <span>Join WhatsApp Channel</span>
                </a>
              )}
            </div>
          )}

          {/* Cute Action Buttons */}
          <div className="mt-6 sm:mt-7 w-full flex flex-col gap-2.5">
            <Button 
              type="button"
              onClick={async () => {
                handleDismiss();
                if (meta.actionUrl) {
                  navigate(meta.actionUrl);
                }
              }}
              className={`w-full h-13 sm:h-14 rounded-2xl bg-gradient-to-r ${meta.btnGradient} font-black text-xs sm:text-sm tracking-wide shadow-xl hover:opacity-95 active:scale-95 transition-all flex items-center justify-center gap-2 group cursor-pointer`}
            >
              <span>
                {notifications.length > 1 
                  ? `Next Update (${notifications.length - 1} left)` 
                  : meta.actionLabel}
              </span>
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Button>

            <button 
              type="button"
              onClick={handleDismiss}
              className="text-[11px] font-semibold text-white/40 hover:text-white/80 transition-colors py-1.5 flex items-center justify-center gap-1 mx-auto cursor-pointer"
            >
              <span>Maybe later</span>
              <Heart className="w-2.5 h-2.5 opacity-60 hover:opacity-100" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default NotificationPopup;
