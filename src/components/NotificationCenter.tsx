import { useState, useEffect } from "react";
import { Bell, AlertTriangle, CheckCircle2, Info, Check, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { playSound } from "@/lib/sound";

interface UserNotification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  link?: string;
  created_at: string;
}

function timeAgo(dateString: string) {
  const date = new Date(dateString);
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + "y ago";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + "mo ago";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + "d ago";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + "h ago";
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + "m ago";
  return "Just now";
}

export const NotificationCenter = ({ isDark }: { isDark: boolean }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const fetchNotifications = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("user_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    if (!error && data) {
      setNotifications(data as UserNotification[]);
    }
    setLoading(false);
  };

  const markAsRead = async (id: string) => {
    const { error } = await supabase
      .from("user_notifications")
      .update({ read: true })
      .eq("id", id);
    
    if (!error) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("user_notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);

    if (!error) {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  };

  const handleNotificationClick = (notif: UserNotification) => {
    if (!notif.read) markAsRead(notif.id);
    if (notif.link) navigate(notif.link);
  };

  useEffect(() => {
    if (!user) return;

    fetchNotifications();

    let activeTone = "/sounds/notification_system.mp3";

    // Fetch system tone settings dynamically
    supabase
      .from("public_system_settings")
      .select("notification_tone")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.notification_tone) {
          activeTone = data.notification_tone;
        }
      });

    const playPing = () => {
      if (activeTone) {
        playSound(activeTone, 0.45);
      }
    };

    // Generate unique ephemeral channel ID to prevent race conditions in strict mode
    const channelId = `user-notifs-${user.id}-${Math.random().toString(36).substring(7)}`;
    
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotif = payload.new as UserNotification;
          setNotifications((prev) => [newNotif, ...prev]);
          
          // TRG: Trigger instant in-app popup (Toast)
          const notifyMethod = newNotif.type === "error" ? toast.error : 
                              newNotif.type === "warning" ? toast.warning : 
                              newNotif.type === "success" ? toast.success : 
                              toast.info;
          
          notifyMethod(newNotif.title, {
            description: newNotif.message,
            duration: 6000,
            action: newNotif.link ? {
              label: "View",
              onClick: () => navigate(newNotif.link!)
            } : undefined
          });

          // Play real-time ping alert audio sound
          playPing();
          
          // Apply pulse animation to the red badge element directly
          const pulseEl = document.getElementById("notification-ring");
          if (pulseEl) {
            pulseEl.classList.add("animate-ping");
            setTimeout(() => pulseEl.classList.remove("animate-ping"), 3000);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  if (!user) return null;

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "warning": return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case "error": return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case "success": return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      default: return <Info className="w-4 h-4 text-blue-500" />;
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn(
            "relative w-9 h-9 rounded-xl flex items-center justify-center transition-all border outline-none group",
            isDark 
              ? "text-white/50 hover:text-white hover:bg-white/[0.08] border-transparent hover:border-white/[0.08]" 
              : "text-gray-500 hover:text-gray-900 hover:bg-black/[0.05] border-transparent hover:border-black/[0.07]"
          )}
        >
          <Bell className="w-4 h-4 transition-transform duration-300 group-hover:rotate-12" />
          
          <AnimatePresence>
            {unreadCount > 0 && (
              <>
                <span 
                  id="notification-ring"
                  className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full pointer-events-none opacity-75"
                />
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] font-black text-white bg-red-600 border-2 rounded-full leading-none shadow-lg"
                  style={{ borderColor: isDark ? '#0c0a1f' : '#ffffff' }}
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </motion.span>
              </>
            )}
          </AnimatePresence>
        </motion.button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent 
        align="end" 
        sideOffset={8}
        className={cn(
          "w-[340px] sm:w-[380px] p-0 overflow-hidden rounded-2xl border-2 shadow-2xl backdrop-blur-xl",
          isDark ? "bg-[#0c0a1f]/95 border-white/5" : "bg-white/95 border-black/5"
        )}
      >
        <div className={cn("p-4 flex items-center justify-between border-b", isDark ? "border-white/10 bg-white/5" : "border-black/5 bg-black/5")}>
          <div>
            <h3 className={cn("font-black text-sm tracking-tight", isDark ? "text-white" : "text-gray-900")}>Notifications</h3>
            <p className={cn("text-[10px] font-medium", isDark ? "text-white/40" : "text-gray-500")}>Stay updated with activity</p>
          </div>
          {unreadCount > 0 && (
            <button 
              onClick={markAllAsRead}
              className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-amber-500 hover:text-amber-400 transition-colors"
            >
              <Check className="w-3 h-3" /> Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[360px] overflow-y-auto overscroll-contain py-1 custom-scrollbar">
          {loading ? (
            <div className="p-8 flex flex-col items-center justify-center gap-3 opacity-50">
              <motion.div 
                animate={{ rotate: 360 }} 
                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
              >
                <Bell className="w-6 h-6" />
              </motion.div>
              <span className="text-xs font-medium">Loading items...</span>
            </div>
          ) : notifications.length === 0 ? (
            <div className={cn("p-10 flex flex-col items-center justify-center gap-3 text-center", isDark ? "text-white/30" : "text-gray-400")}>
              <div className={cn("w-12 h-12 rounded-full flex items-center justify-center", isDark ? "bg-white/5" : "bg-black/5")}>
                <Bell className="w-6 h-6 opacity-50" />
              </div>
              <div className="space-y-1">
                <p className="font-bold text-sm">No notifications yet</p>
                <p className="text-[10px]">We&apos;ll notify you when important events happen.</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col">
              {notifications.map((notif) => (
                <DropdownMenuItem
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={cn(
                    "flex items-start gap-3 p-4 cursor-pointer border-b last:border-0 transition-all focus:bg-transparent focus:outline-none outline-none",
                    isDark ? "border-white/5 hover:bg-white/[0.03]" : "border-black/5 hover:bg-black/[0.02]",
                    !notif.read && (isDark ? "bg-amber-500/[0.03]" : "bg-amber-500/[0.02]")
                  )}
                >
                  <div className={cn(
                    "mt-0.5 w-8 h-8 shrink-0 rounded-full flex items-center justify-center relative",
                    isDark ? "bg-white/5 border border-white/10" : "bg-black/5 border border-black/10"
                  )}>
                    {getTypeIcon(notif.type)}
                    {!notif.read && (
                      <span className="absolute top-0 right-0 w-2 h-2 bg-amber-500 rounded-full animate-pulse border border-white dark:border-black" />
                    )}
                  </div>
                  
                  <div className="flex-1 space-y-0.5 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn("text-[13px] font-black leading-tight tracking-tight truncate", isDark ? "text-white/90" : "text-gray-900")}>
                        {notif.title}
                      </p>
                      <span className={cn("text-[9px] font-medium whitespace-nowrap mt-0.5 shrink-0", isDark ? "text-white/30" : "text-gray-400")}>
                        {timeAgo(notif.created_at)}
                      </span>
                    </div>
                    <p className={cn(
                      "text-xs leading-relaxed line-clamp-2",
                      isDark ? (notif.read ? "text-white/40" : "text-white/70") : (notif.read ? "text-gray-500" : "text-gray-800")
                    )}>
                      {notif.message}
                    </p>
                  </div>
                </DropdownMenuItem>
              ))}
            </div>
          )}
        </div>

        <div className={cn("p-3.5 text-center border-t", isDark ? "border-white/10 bg-white/[0.02]" : "border-black/5 bg-black/[0.02]")}>
          <button
            onClick={() => navigate("/dashboard/notifications")}
            className="text-xs font-black uppercase tracking-wider text-sky-500 hover:text-sky-400 transition-colors w-full py-1.5 flex items-center justify-center gap-1.5"
          >
            View Full Inbox <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
