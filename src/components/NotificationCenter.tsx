import { useState, useEffect, useCallback, useMemo } from "react";
import { Bell, AlertTriangle, CheckCircle2, Info, CheckCheck, ChevronRight, XCircle, X, BellOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { playSound } from "@/lib/sound";

interface UserNotification {
  id: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  read: boolean;
  link?: string;
  created_at: string;
}

// Module-level deduplication so multiple mounted bells never fire duplicate toasts or chimes.
const processedRealtimeNotifIds = new Set<string>();

function timeAgo(dateString: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(dateString).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(dateString).toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}

const TYPE_STYLE: Record<string, { icon: typeof Info; tint: string; dot: string }> = {
  success: { icon: CheckCircle2, tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  warning: { icon: AlertTriangle, tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  error: { icon: XCircle, tint: "bg-rose-500/10 text-rose-600 dark:text-rose-400", dot: "bg-rose-500" },
  info: { icon: Info, tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400", dot: "bg-sky-500" },
};
const styleFor = (t?: string) => TYPE_STYLE[t || "info"] || TYPE_STYLE.info;

/** Opens in-app paths with the router, and full URLs in a new tab (only http/https). */
function openLink(link: string | undefined, navigate: (p: string) => void) {
  if (!link) return;
  const l = link.trim();
  if (l.startsWith("/")) return navigate(l);
  try {
    const u = new URL(l);
    if (u.origin === window.location.origin) return navigate(u.pathname + u.search + u.hash);
    if (u.protocol === "https:" || u.protocol === "http:") window.open(u.href, "_blank", "noopener,noreferrer");
  } catch {
    /* not a valid link — ignore */
  }
}

function NotificationToast({ id, n, onOpen }: { id: string | number; n: UserNotification; onOpen?: () => void }) {
  const s = styleFor(n.type);
  const Icon = s.icon;
  return (
    <div className="w-[min(380px,calc(100vw-24px))] rounded-2xl border border-border bg-popover text-popover-foreground shadow-[0_18px_40px_-14px_rgba(0,0,0,0.35)] p-3.5 flex items-start gap-3">
      <span className={cn("h-9 w-9 shrink-0 rounded-xl flex items-center justify-center", s.tint)}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold leading-snug">{n.title}</p>
        {n.message ? <p className="mt-0.5 text-[12.5px] text-muted-foreground line-clamp-2">{n.message}</p> : null}
        {onOpen ? (
          <button
            type="button"
            onClick={() => {
              onOpen();
              toast.dismiss(id);
            }}
            className="mt-2 inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-primary hover:underline"
          >
            View <ChevronRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <button type="button" onClick={() => toast.dismiss(id)} aria-label="Dismiss" className="-mr-1 -mt-1 h-7 w-7 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// isDark kept for API compatibility with existing callers.
export const NotificationCenter = (_props: { isDark?: boolean }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");

  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    const { count, error } = await supabase
      .from("user_notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("read", false);
    if (!error && typeof count === "number") setUnreadCount(count);
  }, [user]);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) console.warn("[NotificationCenter] fetch warning:", error.message);
      else if (data) setNotifications(data as UserNotification[]);
    } catch (err: any) {
      console.warn("[NotificationCenter] fetch error:", err?.message || err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const markAsRead = async (id: string) => {
    if (!user) return;
    const { error } = await supabase.from("user_notifications").update({ read: true }).eq("id", id).eq("user_id", user.id);
    if (!error) {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;
    const { error } = await supabase.from("user_notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
    if (!error) {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    }
  };

  const handleNotificationClick = (notif: UserNotification) => {
    if (!notif.read) markAsRead(notif.id);
    if (notif.link) {
      setOpen(false);
      openLink(notif.link, navigate);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchNotifications();
    fetchUnreadCount();

    let activeTone = "/sounds/notification_system.mp3";
    supabase
      .from("public_system_settings")
      .select("notification_tone")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if ((data as any)?.notification_tone) activeTone = (data as any).notification_tone;
      });

    const channel = supabase
      .channel(`user-notifs-${user.id}-${Math.random().toString(36).substring(7)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "user_notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as UserNotification;
          setNotifications((prev) => [n, ...prev.filter((x) => x.id !== n.id)].slice(0, 30));
          if (!n.read) setUnreadCount((c) => c + 1);

          if (n.id && processedRealtimeNotifIds.has(n.id)) return;
          if (n.id) {
            processedRealtimeNotifIds.add(n.id);
            if (processedRealtimeNotifIds.size > 200) {
              const first = processedRealtimeNotifIds.values().next().value;
              if (first) processedRealtimeNotifIds.delete(first);
            }
          }

          toast.custom(
            (id) => (
              <NotificationToast
                id={id}
                n={n}
                onOpen={
                  n.link
                    ? () => {
                        openLink(n.link, navigate);
                      }
                    : undefined
                }
              />
            ),
            { duration: 6000, unstyled: true }
          );
          if (activeTone) playSound(activeTone, 0.45);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchNotifications, fetchUnreadCount, navigate]);

  // Re-sync when the panel opens (another device may have read things).
  useEffect(() => {
    if (open) {
      fetchNotifications();
      fetchUnreadCount();
    }
  }, [open, fetchNotifications, fetchUnreadCount]);

  const visible = useMemo(() => (tab === "unread" ? notifications.filter((n) => !n.read) : notifications), [notifications, tab]);
  const groups = useMemo(() => {
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const today = visible.filter((n) => new Date(n.created_at) >= startToday);
    const earlier = visible.filter((n) => new Date(n.created_at) < startToday);
    return [
      { label: "Today", items: today },
      { label: "Earlier", items: earlier },
    ].filter((g) => g.items.length);
  }, [visible]);

  if (!user) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
          className="relative h-9 w-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <Bell className="h-[18px] w-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold leading-4 text-center ring-2 ring-background tabular-nums">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={10} className="w-[min(380px,calc(100vw-16px))] p-0 overflow-hidden rounded-2xl border-border shadow-[0_24px_60px_-20px_rgba(0,0,0,0.4)]">
        <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold text-foreground">Notifications</p>
            <p className="text-xs text-muted-foreground">{unreadCount ? `${unreadCount} unread` : "You’re all caught up"}</p>
          </div>
          {unreadCount > 0 && (
            <button type="button" onClick={markAllAsRead} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted">
              <CheckCheck className="h-4 w-4" /> Mark all read
            </button>
          )}
        </div>

        <div className="px-4 pb-2">
          <div className="inline-flex rounded-lg bg-muted p-0.5" role="tablist">
            {(["all", "unread"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn("h-7 px-3 rounded-md text-[12.5px] font-semibold capitalize transition-colors", tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {t}
                {t === "unread" && unreadCount > 0 ? <span className="ml-1 text-muted-foreground tabular-nums">{unreadCount}</span> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[min(420px,60vh)] overflow-y-auto overscroll-contain border-t border-border/70">
          {loading && notifications.length === 0 ? (
            <div className="p-4 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3">
                  <div className="h-9 w-9 rounded-xl bg-muted animate-pulse" />
                  <div className="flex-1 space-y-1.5 pt-1">
                    <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
                    <div className="h-2.5 w-1/2 rounded bg-muted/70 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="py-12 px-6 flex flex-col items-center text-center gap-2">
              <span className="h-11 w-11 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                <BellOff className="h-5 w-5" />
              </span>
              <p className="text-sm font-semibold text-foreground">{tab === "unread" ? "No unread notifications" : "No notifications yet"}</p>
              <p className="text-xs text-muted-foreground">Order updates, wallet credits and news will appear here.</p>
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-muted-foreground">{g.label}</p>
                <ul>
                  {g.items.map((n) => {
                    const s = styleFor(n.type);
                    const Icon = s.icon;
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => handleNotificationClick(n)}
                          className={cn("w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-muted/60 transition-colors", !n.read && "bg-primary/[0.04]")}
                        >
                          <span className={cn("h-9 w-9 shrink-0 rounded-xl flex items-center justify-center", s.tint)}>
                            <Icon className="h-[18px] w-[18px]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start gap-2">
                              <span className={cn("flex-1 text-[13.5px] leading-snug", n.read ? "font-medium text-foreground/80" : "font-semibold text-foreground")}>{n.title}</span>
                              <span className="text-[11px] text-muted-foreground whitespace-nowrap mt-0.5">{timeAgo(n.created_at)}</span>
                            </span>
                            {n.message ? <span className="mt-0.5 block text-[12.5px] text-muted-foreground line-clamp-2">{n.message}</span> : null}
                          </span>
                          {!n.read && <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", s.dot)} aria-label="Unread" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setOpen(false);
            navigate("/dashboard/notifications");
          }}
          className="w-full h-11 border-t border-border/70 text-[13px] font-semibold text-foreground hover:bg-muted/60 flex items-center justify-center gap-1"
        >
          Open inbox <ChevronRight className="h-4 w-4" />
        </button>
      </PopoverContent>
    </Popover>
  );
};
