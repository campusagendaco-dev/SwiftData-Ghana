import React, { useState, useEffect } from "react";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useAppTheme } from "@/contexts/ThemeContext";
import { 
  Bell, BellRing, CheckCircle2, X, Zap, ShieldCheck, 
  Smartphone, Share, AlertCircle, ChevronRight, Sparkles 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

interface PushNotificationPromptProps {
  variant?: "floating" | "inline" | "banner";
  onSubscribed?: () => void;
}

const STORAGE_KEY = "swift_push_prompt_dismissed_until";

export const PushNotificationPrompt: React.FC<PushNotificationPromptProps> = ({ 
  variant = "floating",
  onSubscribed 
}) => {
  const { supported, permissionState, subscribeUser, loading } = usePushNotifications();
  const { isDark } = useAppTheme();
  
  const [dismissed, setDismissed] = useState(true);
  const [isIosNotStandalone, setIsIosNotStandalone] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    // Check iOS PWA status
    if (typeof window !== "undefined") {
      const isIos = /ipad|iphone|ipod/.test(navigator.userAgent.toLowerCase()) && !(window as any).MSStream;
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
      if (isIos && !isStandalone) {
        setIsIosNotStandalone(true);
      }

      // Check snooze expiration
      const dismissedUntil = localStorage.getItem(STORAGE_KEY);
      if (dismissedUntil) {
        const time = parseInt(dismissedUntil, 10);
        if (Date.now() < time) {
          setDismissed(true);
          return;
        }
      }
      setDismissed(false);
    }
  }, []);

  const handleDismiss = (days = 3) => {
    setDismissed(true);
    const snoozeUntil = Date.now() + days * 24 * 60 * 60 * 1000;
    localStorage.setItem(STORAGE_KEY, snoozeUntil.toString());
  };

  const handleEnable = async () => {
    if (isIosNotStandalone) {
      setShowIosGuide(true);
      return;
    }

    const success = await subscribeUser();
    if (success) {
      setDismissed(true);
      localStorage.removeItem(STORAGE_KEY);
      if (onSubscribed) onSubscribed();
    }
  };

  // If push is not supported or already granted, don't show the opt-in prompt
  if (!supported || permissionState === "granted" || (dismissed && variant !== "inline")) {
    return null;
  }

  // User explicitly blocked notifications in browser settings
  if (permissionState === "denied") {
    if (variant === "inline") {
      return (
        <div className={`p-4 rounded-2xl border ${
          isDark ? "bg-rose-500/10 border-rose-500/20 text-rose-300" : "bg-rose-50 border-rose-200 text-rose-800"
        }`}>
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-bold">Push Notifications Blocked</p>
              <p className="text-xs opacity-90 leading-relaxed">
                To receive instant order delivery receipts, click the <strong>lock / tune icon (🔒)</strong> in your browser address bar and switch Notifications to <strong>Allow</strong>.
              </p>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  // Floating prompt modal / card
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={`fixed z-50 bottom-4 right-4 left-4 sm:left-auto sm:max-w-md w-auto rounded-3xl p-5 shadow-2xl backdrop-blur-xl border transition-all ${
          isDark 
            ? "bg-slate-900/95 border-amber-500/30 text-white shadow-amber-500/10" 
            : "bg-white/95 border-amber-500/30 text-slate-900 shadow-xl shadow-amber-500/10"
        }`}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-amber-500/20 shrink-0">
              <BellRing className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-black uppercase tracking-wider text-amber-500">Offline Alerts</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400">Instant</span>
              </div>
              <h4 className="text-sm font-extrabold leading-tight">Turn On Lock-Screen Notifications</h4>
            </div>
          </div>

          <button
            onClick={() => handleDismiss(3)}
            aria-label="Dismiss"
            className={`p-1.5 rounded-xl transition-colors ${
              isDark ? "text-white/40 hover:text-white hover:bg-white/10" : "text-slate-400 hover:text-slate-800 hover:bg-slate-100"
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className={`text-xs leading-relaxed mb-4 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
          Get instant receipts the second your bundle arrives or wallet is credited — even when your browser is closed or phone screen is locked.
        </p>

        {/* Value Prop Badges */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className={`flex items-center gap-2 p-2 rounded-xl text-[11px] font-semibold border ${
            isDark ? "bg-white/[0.03] border-white/5 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-700"
          }`}>
            <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Order Delivery Alerts</span>
          </div>
          <div className={`flex items-center gap-2 p-2 rounded-xl text-[11px] font-semibold border ${
            isDark ? "bg-white/[0.03] border-white/5 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-700"
          }`}>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Wallet Credit Receipts</span>
          </div>
        </div>

        {/* iOS Helper */}
        {isIosNotStandalone && showIosGuide && (
          <div className={`mb-4 p-3 rounded-2xl border text-xs leading-relaxed ${
            isDark ? "bg-amber-500/10 border-amber-500/30 text-amber-200" : "bg-amber-50 border-amber-200 text-amber-900"
          }`}>
            <div className="flex items-center gap-2 font-bold mb-1">
              <Smartphone className="w-4 h-4 text-amber-400" />
              <span>iPhone Setup (Required by Apple):</span>
            </div>
            <ol className="list-decimal pl-4 space-y-1 text-[11px]">
              <li>Tap the <strong>Share</strong> button (<Share className="inline w-3 h-3 mx-0.5" />) in Safari.</li>
              <li>Select <strong>Add to Home Screen</strong>.</li>
              <li>Open SwiftData from your home screen to enable notifications.</li>
            </ol>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            onClick={handleEnable}
            disabled={loading}
            className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-black text-xs h-9 rounded-xl shadow-lg shadow-amber-500/20"
          >
            {loading ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
                Enabling...
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Bell className="w-3.5 h-3.5" />
                Enable Offline Alerts
              </span>
            )}
          </Button>

          <Button
            variant="ghost"
            onClick={() => handleDismiss(7)}
            className={`text-xs font-bold h-9 px-3 rounded-xl ${
              isDark ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Later
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
