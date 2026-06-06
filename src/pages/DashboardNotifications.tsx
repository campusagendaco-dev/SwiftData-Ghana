import { useState, useEffect } from "react";
import { safeVibrate } from "@/lib/sound";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAppTheme } from "@/contexts/ThemeContext";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell, Check, Trash2, ShieldAlert, AlertTriangle, CheckCircle2,
  Info, Search, SlidersHorizontal, Settings2, Sparkles, Volume2,
  VolumeX, ToggleLeft, ToggleRight, ArrowRight, RefreshCw, X,
  ExternalLink, ChevronDown, CheckSquare, Square, Smartphone, Trash
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface UserNotification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  link?: string;
  created_at: string;
}

const DashboardNotifications = () => {
  const { user } = useAuth();
  const { isDark } = useAppTheme();
  const navigate = useNavigate();
  const { supported, permissionState, subscribeUser, loading: subLoading } = usePushNotifications();

  // Notifications State
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread' | 'read' | 'urgent'>('all');
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // iOS Detection for Push Notifications
  const [isIosNotStandalone, setIsIosNotStandalone] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const isIos = /ipad|iphone|ipod/.test(navigator.userAgent.toLowerCase()) && !(window as any).MSStream;
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
      if (isIos && !isStandalone) {
        setIsIosNotStandalone(true);
      }
    }
  }, []);

  // Preference Settings (Local Storage backed)
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem("swift_sound_alerts") !== "false";
  });
  const [vibeEnabled, setVibeEnabled] = useState(() => {
    return localStorage.getItem("swift_vibe_alerts") !== "false";
  });

  useEffect(() => {
    localStorage.setItem("swift_sound_alerts", String(soundEnabled));
  }, [soundEnabled]);

  useEffect(() => {
    localStorage.setItem("swift_vibe_alerts", String(vibeEnabled));
  }, [vibeEnabled]);

  const fetchNotifications = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (data) setNotifications(data as UserNotification[]);
    } catch (err: any) {
      toast.error("Failed to load notifications: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();

    // Subscribe to real-time notification inserts for this active user
    const channelId = `dashboard-inbox-${user?.id}-${Math.random().toString(36).substring(7)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${user?.id}`,
        },
        (payload) => {
          const newNotif = payload.new as UserNotification;
          setNotifications((prev) => [newNotif, ...prev]);

          if (soundEnabled) {
            try {
              const audio = new Audio("/sounds/notification_system.mp3");
              audio.volume = 0.4;
              audio.play().catch(() => {});
            } catch (e) {
              // Ignore audio autoplay restrictions
            }
          }
          if (vibeEnabled) safeVibrate(150);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, soundEnabled, vibeEnabled]);

  // Bulk Actions
  const handleToggleSelectAll = () => {
    const displayed = getFilteredNotifications();
    if (selectedIds.length === displayed.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(displayed.map(n => n.id));
    }
  };

  const handleMarkSelectedAsRead = async () => {
    if (selectedIds.length === 0) return;
    const { error } = await supabase
      .from("user_notifications")
      .update({ read: true })
      .in("id", selectedIds);

    if (!error) {
      setNotifications(prev =>
        prev.map(n => selectedIds.includes(n.id) ? { ...n, read: true } : n)
      );
      setSelectedIds([]);
      toast.success("Marked selected notifications as read");
    } else {
      toast.error("Failed to update status");
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    const { error } = await supabase
      .from("user_notifications")
      .delete()
      .in("id", selectedIds);

    if (!error) {
      setNotifications(prev => prev.filter(n => !selectedIds.includes(n.id)));
      setSelectedIds([]);
      toast.success("Successfully deleted selected notifications");
    } else {
      toast.error("Failed to delete notifications");
    }
  };

  const handleMarkAllRead = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("user_notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);

    if (!error) {
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      toast.success("Marked all notifications as read");
    } else {
      toast.error("Operation failed");
    }
  };

  const handleToggleRead = async (id: string, currentRead: boolean) => {
    const { error } = await supabase
      .from("user_notifications")
      .update({ read: !currentRead })
      .eq("id", id);

    if (!error) {
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, read: !currentRead } : n)
      );
    }
  };

  const handleDeleteItem = async (id: string) => {
    const { error } = await supabase
      .from("user_notifications")
      .delete()
      .eq("id", id);

    if (!error) {
      setNotifications(prev => prev.filter(n => n.id !== id));
      if (expandedId === id) setExpandedId(null);
      toast.success("Notification deleted");
    }
  };

  const handleSelectToggle = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Helper filters
  const getFilteredNotifications = () => {
    return notifications.filter(n => {
      const matchesSearch =
        n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.message.toLowerCase().includes(searchQuery.toLowerCase());
      
      if (!matchesSearch) return false;

      if (filter === 'unread') return !n.read;
      if (filter === 'read') return n.read;
      if (filter === 'urgent') return n.type === 'error' || n.type === 'warning';
      return true;
    });
  };

  const getTypeStyle = (type: string) => {
    switch (type) {
      case "warning":
        return {
          icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
          bg: "bg-amber-500/10 border-amber-500/20",
          text: "text-amber-400",
          badge: "bg-amber-500/20 text-amber-400"
        };
      case "error":
        return {
          icon: <ShieldAlert className="w-4 h-4 text-rose-400 animate-pulse" />,
          bg: "bg-rose-500/10 border-rose-500/20",
          text: "text-rose-400",
          badge: "bg-rose-500/20 text-rose-400"
        };
      case "success":
        return {
          icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
          bg: "bg-emerald-500/10 border-emerald-500/20",
          text: "text-emerald-400",
          badge: "bg-emerald-500/20 text-emerald-400"
        };
      default:
        return {
          icon: <Info className="w-4 h-4 text-sky-400" />,
          bg: "bg-sky-500/10 border-sky-500/20",
          text: "text-sky-400",
          badge: "bg-sky-500/20 text-sky-400"
        };
    }
  };

  const filteredNotifs = getFilteredNotifications();
  const totalUnreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8 max-w-6xl mx-auto">
      {/* HEADER SECTION */}
      <div className={`relative p-6 sm:p-8 rounded-3xl border transition-all duration-300 overflow-hidden shadow-2xl backdrop-blur-md ${
        isDark 
          ? "border-white/5 bg-gradient-to-r from-sky-950/20 via-black/40 to-indigo-950/20" 
          : "border-sky-100 bg-gradient-to-r from-sky-50 via-white to-indigo-50/50"
      }`}>
        <div className="absolute inset-0 bg-sky-500/5 blur-[80px] -z-10 animate-pulse" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-colors ${
              isDark 
                ? "bg-sky-500/10 border border-sky-500/20 shadow-sky-500/5" 
                : "bg-sky-50 border border-sky-200/60 shadow-sky-200/10"
            }`}>
              <Bell className="w-7 h-7 text-sky-500" />
            </div>
            <div>
              <h1 className={`text-2xl sm:text-3xl font-black tracking-tight uppercase italic flex items-center gap-2 ${
                isDark ? "text-white" : "text-slate-900"
              }`}>
                Inbox Hub <span className="text-sky-500 text-xs not-italic font-bold">V1.5</span>
              </h1>
              <p className={`text-xs mt-0.5 font-medium ${
                isDark ? "text-white/40" : "text-slate-500"
              }`}>
                Manage, review, and organize platform updates and transaction alerts.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              onClick={fetchNotifications}
              variant="outline"
              size="sm"
              disabled={loading}
              className={`rounded-xl text-xs font-black uppercase h-9 border transition-all ${
                isDark 
                  ? "border-white/10 bg-white/5 text-white/70 hover:bg-white/10" 
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm"
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {totalUnreadCount > 0 && (
              <Button
                onClick={handleMarkAllRead}
                size="sm"
                className="rounded-xl bg-sky-500 hover:bg-sky-400 text-black font-black text-xs uppercase h-9 shadow-lg shadow-sky-500/10"
              >
                <Check className="w-3.5 h-3.5 mr-2" />
                Mark all read
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* SUB-GRID LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* LEFT COLUMN: PWA BANNER & FILTER PREFERENCES */}
        <div className="space-y-6 lg:col-span-1">
          {/* PWA PUSH OPT-IN */}
          {supported && permissionState !== "granted" && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className={`p-6 rounded-3xl border relative overflow-hidden group shadow-xl transition-all ${
                isDark 
                  ? "border-indigo-500/20 bg-indigo-500/5 text-indigo-400/10 group-hover:text-indigo-400/20" 
                  : "border-indigo-100 bg-indigo-50/50 text-indigo-500/5 group-hover:text-indigo-500/10"
              }`}
            >
              <div className="absolute top-0 right-0 p-4 transition-all">
                <Smartphone className="w-16 h-16 text-indigo-500/20" />
              </div>
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2.5 rounded-xl border ${
                  isDark ? "bg-indigo-500/10 border-indigo-500/20" : "bg-indigo-100/50 border-indigo-200"
                }`}>
                  <Smartphone className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <h3 className={`text-sm font-black uppercase tracking-wider ${
                  isDark ? "text-white" : "text-slate-900"
                }`}>Lock-screen Alerts</h3>
              </div>
              <p className={`text-xs leading-relaxed mb-4 ${
                isDark ? "text-white/50" : "text-slate-600"
              }`}>
                Enable native push notifications to receive real-time deposits and store checkout notifications even when the browser is closed.
              </p>
              <Button
                onClick={subscribeUser}
                disabled={subLoading}
                className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-[10px] uppercase tracking-widest h-9"
              >
                {subLoading ? "Subscribing..." : "Enable Push Alerts"}
              </Button>
            </motion.div>
          )}

          {/* iOS Specific Push Opt-In Guidance */}
          {(!supported || permissionState === "unsupported") && isIosNotStandalone && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className={`p-6 rounded-3xl border relative overflow-hidden group shadow-xl transition-all ${
                isDark 
                  ? "border-amber-500/20 bg-amber-500/5 text-amber-400" 
                  : "border-amber-200 bg-amber-50/50 text-amber-600"
              }`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2.5 rounded-xl border ${
                  isDark ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-100 border-amber-200"
                }`}>
                  <Smartphone className="w-5 h-5 text-amber-500" />
                </div>
                <h3 className={`text-sm font-black uppercase tracking-wider ${
                  isDark ? "text-white" : "text-slate-900"
                }`}>Enable iOS Push Alerts</h3>
              </div>
              <p className={`text-xs leading-relaxed mb-4 ${
                isDark ? "text-white/70" : "text-slate-700"
              }`}>
                Apple restricts Push Notifications in standard Safari tabs. To receive notifications on your iPhone or iPad, you must first add this app to your Home Screen:
              </p>
              <ul className="text-[11px] font-bold space-y-2 mb-4">
                <li className="flex items-center gap-2">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">1</span>
                  Tap the <strong>Share</strong> icon at the bottom of Safari.
                </li>
                <li className="flex items-center gap-2">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">2</span>
                  Scroll down and tap <strong>Add to Home Screen</strong>.
                </li>
                <li className="flex items-center gap-2">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">3</span>
                  Open the new app from your home screen and return here to enable alerts.
                </li>
              </ul>
            </motion.div>
          )}

          {/* PREFERENCES PANEL */}
          <div className={`p-6 rounded-3xl border backdrop-blur-md space-y-6 transition-all ${
            isDark 
              ? "border-white/5 bg-[#0a0a0e]/60 shadow-2xl" 
              : "border-slate-200 bg-white shadow-sm shadow-slate-100/50"
          }`}>
            <div className={`flex items-center gap-3 border-b pb-4 ${
              isDark ? "border-white/5" : "border-slate-100"
            }`}>
              <div className={`p-2 rounded-xl border ${
                isDark ? "bg-white/5 border-white/5 text-sky-400" : "bg-sky-50 border-sky-100 text-sky-600"
              }`}>
                <Settings2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className={`text-sm font-black uppercase tracking-wider ${
                  isDark ? "text-white" : "text-slate-900"
                }`}>Inbox Settings</h3>
                <p className={`text-[10px] font-medium ${
                  isDark ? "text-white/30" : "text-slate-400"
                }`}>Device-level alerts behavior</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className={`text-xs font-bold block ${
                    isDark ? "text-white/80" : "text-slate-800"
                  }`}>Sound Chimes</span>
                  <span className={`text-[9px] block leading-none ${
                    isDark ? "text-white/35" : "text-slate-500"
                  }`}>Play chime on incoming alerts</span>
                </div>
                <button
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className="focus:outline-none transition-colors"
                >
                  {soundEnabled ? (
                    <ToggleRight className="w-9 h-9 text-sky-400" />
                  ) : (
                    <ToggleLeft className={`w-9 h-9 ${isDark ? "text-white/20" : "text-slate-300"}`} />
                  )}
                </button>
              </div>

              <div className={`flex items-center justify-between border-t pt-4 ${
                isDark ? "border-white/5" : "border-slate-100"
              }`}>
                <div className="space-y-0.5">
                  <span className={`text-xs font-bold block ${
                    isDark ? "text-white/80" : "text-slate-800"
                  }`}>Tactile Haptics</span>
                  <span className={`text-[9px] block leading-none ${
                    isDark ? "text-white/35" : "text-slate-500"
                  }`}>Vibrate mobile physical devices</span>
                </div>
                <button
                  onClick={() => setVibeEnabled(!vibeEnabled)}
                  className="focus:outline-none transition-colors"
                >
                  {vibeEnabled ? (
                    <ToggleRight className="w-9 h-9 text-sky-400" />
                  ) : (
                    <ToggleLeft className={`w-9 h-9 ${isDark ? "text-white/20" : "text-slate-300"}`} />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: MAIN NOTIFICATION STREAM */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* SEARCH & FILTER CONTROLS */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            {/* Filter Tabs */}
            <div className={`flex p-1 rounded-2xl border w-full sm:w-auto overflow-x-auto scrollbar-none shrink-0 ${
              isDark ? "bg-white/[0.03] border-white/5" : "bg-slate-100/80 border-slate-200/60"
            }`}>
              {[
                { id: 'all', label: 'All' },
                { id: 'unread', label: 'Unread', badge: totalUnreadCount > 0 ? totalUnreadCount : null },
                { id: 'read', label: 'Read' },
                { id: 'urgent', label: 'Urgent' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => { setFilter(tab.id as any); setSelectedIds([]); }}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                    filter === tab.id
                      ? "text-black bg-sky-500 font-black shadow-lg shadow-sky-500/10"
                      : isDark
                      ? "text-white/40 hover:text-white/80"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {tab.label}
                  {tab.badge !== null && (
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                      filter === tab.id 
                        ? "bg-black text-sky-500" 
                        : isDark 
                        ? "bg-sky-500/20 text-sky-400" 
                        : "bg-sky-100 text-sky-700"
                    }`}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:max-w-xs">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                isDark ? "text-white/30" : "text-slate-400"
              }`} />
              <Input
                placeholder="Search alerts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`pl-9 rounded-2xl focus-visible:ring-sky-500/40 text-xs w-full h-9 transition-all ${
                  isDark 
                    ? "bg-white/[0.03] border-white/5 text-white placeholder:text-white/20" 
                    : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-450 shadow-sm"
                }`}
              />
            </div>
          </div>

          {/* BATCH BARS & CHECKBOX GENERAL SELECTOR */}
          {filteredNotifs.length > 0 && (
            <div className={`flex items-center justify-between p-3 px-4 rounded-2xl border animate-in fade-in duration-300 ${
              isDark ? "bg-white/[0.02] border-white/5" : "bg-slate-50 border-slate-200/60 shadow-sm"
            }`}>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleToggleSelectAll}
                  className={`p-1 transition-colors ${
                    isDark ? "text-white/40 hover:text-white/85" : "text-slate-400 hover:text-slate-700"
                  }`}
                  title={selectedIds.length === filteredNotifs.length ? "Deselect All" : "Select All"}
                >
                  {selectedIds.length === filteredNotifs.length && selectedIds.length > 0 ? (
                    <CheckSquare className="w-4 h-4 text-sky-400" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                </button>
                <span className={`text-[10px] font-black uppercase tracking-wider ${
                  isDark ? "text-white/40" : "text-slate-500"
                }`}>
                  {selectedIds.length > 0
                    ? `${selectedIds.length} Selected`
                    : "Multi-Select"
                  }
                </span>
              </div>

              {selectedIds.length > 0 && (
                <div className="flex items-center gap-2 animate-in slide-in-from-right-3 duration-300">
                  <Button
                    onClick={handleMarkSelectedAsRead}
                    variant="ghost"
                    size="sm"
                    className={`h-8 rounded-lg font-bold text-[10px] uppercase tracking-wider ${
                      isDark 
                        ? "text-sky-400 hover:text-sky-300 hover:bg-sky-500/10" 
                        : "text-sky-600 hover:text-sky-700 hover:bg-sky-50"
                    }`}
                  >
                    Mark Read
                  </Button>
                  <Button
                    onClick={handleDeleteSelected}
                    variant="ghost"
                    size="sm"
                    className={`h-8 rounded-lg font-bold text-[10px] uppercase tracking-wider ${
                      isDark 
                        ? "text-rose-400 hover:text-rose-300 hover:bg-rose-500/10" 
                        : "text-rose-600 hover:text-rose-750 hover:bg-rose-50"
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    Delete
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* LIST OF NOTIFICATIONS */}
          <div className="space-y-4">
            {loading ? (
              <div className="p-20 flex flex-col items-center justify-center gap-4 text-center opacity-40">
                <RefreshCw className="w-8 h-8 text-sky-400 animate-spin" />
                <p className={`text-xs font-bold uppercase tracking-widest ${
                  isDark ? "text-white/50" : "text-slate-500"
                }`}>Loading Inbox Stream...</p>
              </div>
            ) : filteredNotifs.length === 0 ? (
              <div className={`p-16 text-center border border-dashed rounded-3xl flex flex-col items-center justify-center gap-6 ${
                isDark 
                  ? "border-white/5 bg-[#0a0a0e]/30 text-white/20" 
                  : "border-slate-200 bg-slate-50/50 text-slate-400/60"
              }`}>
                {/* SVG Illustration */}
                <div className="relative w-40 h-40">
                  <div className="absolute inset-0 bg-sky-500 rounded-full blur-3xl opacity-10 animate-pulse" />
                  <svg className="w-full h-full drop-shadow-[0_8px_24px_rgba(14,165,233,0.2)] animate-bounce-subtle relative z-10" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {/* Glowing Ripple Waves */}
                    <circle cx="100" cy="100" r="70" stroke="url(#rippleGrad1)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" />
                    <circle cx="100" cy="100" r="50" stroke="url(#rippleGrad2)" strokeWidth="1.5" opacity="0.4" />
                    
                    {/* Sparkles / Diamonds */}
                    <path d="M 50 60 L 53 63 L 56 60 L 53 57 Z" fill="#ffd43b" opacity="0.85" />
                    <path d="M 145 130 L 147 132 L 149 130 L 147 128 Z" fill="#38bdf8" opacity="0.9" />
                    <path d="M 155 70 L 158 73 L 161 70 L 158 67 Z" fill="#a78bfa" opacity="0.8" />
                    
                    {/* Floating Bell Body */}
                    <path d="M 100 45 C 85 45 75 55 75 70 L 70 115 L 130 115 L 125 70 C 125 55 115 45 100 45 Z" fill="url(#bellBodyGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
                    
                    {/* Bell Clapper */}
                    <circle cx="100" cy="125" r="10" fill="url(#bellClapperGrad)" />
                    
                    {/* Bell Ring Attachment */}
                    <circle cx="100" cy="38" r="8" stroke="rgba(255,255,255,0.2)" strokeWidth="2" fill="none" />
                    
                    {/* Glow and Gradients */}
                    <defs>
                      <linearGradient id="rippleGrad1" x1="30" y1="30" x2="170" y2="170" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#0ea5e9" stopOpacity="0"/>
                        <stop offset="0.5" stopColor="#38bdf8" stopOpacity="0.4"/>
                        <stop offset="1" stopColor="#818cf8" stopOpacity="0"/>
                      </linearGradient>
                      <linearGradient id="rippleGrad2" x1="50" y1="50" x2="150" y2="150" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#38bdf8" stopOpacity="0.5"/>
                        <stop offset="1" stopColor="#0ea5e9" stopOpacity="0.1"/>
                      </linearGradient>
                      <linearGradient id="bellBodyGrad" x1="70" y1="45" x2="130" y2="115" gradientUnits="userSpaceOnUse">
                        <stop stopColor="rgba(56, 189, 248, 0.25)"/>
                        <stop offset="1" stopColor="rgba(14, 165, 233, 0.05)"/>
                      </linearGradient>
                      <linearGradient id="bellClapperGrad" x1="90" y1="115" x2="110" y2="135" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#38bdf8"/>
                        <stop offset="1" stopColor="#0284c7"/>
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
                <div className="space-y-1 max-w-sm">
                  <p className={`font-black text-sm uppercase tracking-wider ${
                    isDark ? "text-white/70" : "text-slate-800"
                  }`}>No matching notifications</p>
                  <p className={`text-xs leading-relaxed ${
                    isDark ? "text-white/35" : "text-slate-500"
                  }`}>
                    Try clearing filters, searching for another keyword, or check back later for live sale reports.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence mode="popLayout">
                  {filteredNotifs.map((notif) => {
                    const isExpanded = expandedId === notif.id;
                    const isSelected = selectedIds.includes(notif.id);
                    const style = getTypeStyle(notif.type);

                    return (
                      <motion.div
                        key={notif.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        layout="position"
                        className={`rounded-2xl border transition-all duration-300 group overflow-hidden ${
                          isSelected 
                            ? isDark 
                              ? "border-sky-500/40 bg-sky-500/[0.03]" 
                              : "border-sky-300 bg-sky-50/40 shadow-sm"
                            : !notif.read
                            ? isDark
                              ? "border-white/10 bg-white/[0.03] hover:bg-white/[0.04]"
                              : "border-slate-200 bg-white hover:bg-slate-50/40 shadow-sm"
                            : isDark
                            ? "border-white/5 bg-white/[0.01] hover:bg-white/[0.02]"
                            : "border-slate-100 bg-slate-50/50 hover:bg-slate-100/50"
                        }`}
                      >
                        {/* Summary Header */}
                        <div 
                          onClick={() => setExpandedId(isExpanded ? null : notif.id)}
                          className="p-4 sm:p-5 flex items-start gap-4 cursor-pointer select-none"
                        >
                          {/* Checkbox Selector */}
                          <div 
                            onClick={(e) => { e.stopPropagation(); handleSelectToggle(notif.id); }}
                            className={`p-1 mt-0.5 transition-colors ${
                              isSelected 
                                ? "text-sky-500" 
                                : isDark 
                                ? "text-white/25 hover:text-white/60" 
                                : "text-slate-350 hover:text-slate-600"
                            }`}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-sky-400" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </div>

                          {/* Dynamic Icon */}
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border relative ${style.bg}`}>
                            {style.icon}
                            {!notif.read && (
                              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-sky-400 shadow-md animate-pulse" />
                            )}
                          </div>

                          {/* Content summary */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-3 mb-1">
                              <h3 className={`text-xs sm:text-sm leading-tight truncate uppercase tracking-tight ${
                                !notif.read 
                                  ? isDark ? "text-white font-black" : "text-slate-900 font-extrabold"
                                  : isDark ? "text-white/60 font-bold" : "text-slate-500 font-bold"
                              }`}>
                                {notif.title}
                              </h3>
                              <span className={`text-[9px] font-bold whitespace-nowrap mt-0.5 ${
                                isDark ? "text-white/30" : "text-slate-400"
                              }`}>
                                {new Date(notif.created_at).toLocaleDateString()}
                              </span>
                            </div>
                            <p className={`text-xs leading-normal truncate pr-6 ${
                              isExpanded 
                                ? "hidden" 
                                : isDark ? "text-white/40" : "text-slate-500"
                            }`}>
                              {notif.message}
                            </p>
                          </div>

                          {/* Dropdown Chevron */}
                          <div className={`p-1 transition-colors shrink-0 ${
                            isDark ? "text-white/20 group-hover:text-white/60" : "text-slate-400 group-hover:text-slate-600"
                          }`}>
                            <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isExpanded ? "rotate-180 text-sky-400" : ""}`} />
                          </div>
                        </div>

                        {/* Collapsible Details Drawer */}
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: "auto" }}
                            exit={{ height: 0 }}
                            className={`border-t overflow-hidden ${
                              isDark ? "border-white/5 bg-black/25" : "border-slate-100 bg-slate-50/50"
                            }`}
                          >
                            <div className="p-5 sm:px-14 space-y-4">
                              <p className={`text-xs leading-relaxed whitespace-pre-wrap font-medium ${
                                isDark ? "text-white/70" : "text-slate-700"
                              }`}>
                                {notif.message}
                              </p>

                              {/* Interactive Actions footer */}
                              <div className={`flex flex-wrap items-center justify-between gap-3 pt-3 border-t ${
                                isDark ? "border-white/5" : "border-slate-100"
                              }`}>
                                <div className="flex items-center gap-2">
                                  <Badge className={`text-[8px] font-black uppercase tracking-widest border-none ${style.badge}`}>
                                    {notif.type} alert
                                  </Badge>
                                  <Badge className={`text-[8px] font-black uppercase tracking-widest border-none ${
                                    isDark ? "bg-white/5 text-white/40" : "bg-slate-150 text-slate-500"
                                  }`}>
                                    ID: {notif.id.slice(0, 8)}
                                  </Badge>
                                </div>

                                <div className="flex items-center gap-2">
                                  <Button
                                    onClick={() => handleToggleRead(notif.id, notif.read)}
                                    variant="ghost"
                                    size="sm"
                                    className={`h-8 px-3 rounded-lg font-bold text-[10px] uppercase tracking-wider ${
                                      isDark ? "text-white/40 hover:text-white hover:bg-white/5" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100/50"
                                    }`}
                                  >
                                    Mark {notif.read ? "Unread" : "Read"}
                                  </Button>
                                  
                                  {notif.link && (
                                    <Button
                                      onClick={() => navigate(notif.link!)}
                                      size="sm"
                                      className="h-8 px-4 rounded-lg bg-sky-500 hover:bg-sky-400 text-black font-black text-[10px] uppercase tracking-widest shadow-lg shadow-sky-500/10"
                                    >
                                      Go to Link
                                      <ExternalLink className="w-3 h-3 ml-1.5" />
                                    </Button>
                                  )}

                                  <Button
                                    onClick={() => handleDeleteItem(notif.id)}
                                    variant="ghost"
                                    size="sm"
                                    className={`h-8 w-8 p-0 rounded-lg shrink-0 ${
                                      isDark ? "text-rose-500 hover:text-rose-450 hover:bg-rose-500/10" : "text-rose-650 hover:text-rose-700 hover:bg-rose-50"
                                    }`}
                                    title="Delete notification"
                                  >
                                    <Trash className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes bounce-subtle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        .animate-bounce-subtle {
          animation: bounce-subtle 3s infinite ease-in-out;
        }
      `}</style>
    </div>
  );
};

export default DashboardNotifications;
