import React, { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Clock, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getActiveStoreDomain } from "@/lib/app-base-url";

// Constants for the Ghost Idle Timer
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 Minutes of complete inactivity
const COUNTDOWN_SECONDS = 30; // Final warning duration before ejection
const INITIAL_REVEAL_DURATION_MS = 300; // Cinematic 0.3s auto-reveal requested by user

export function SecurityGuard({ children }: { children: React.ReactNode }) {
  const { user, signOut, profile } = useAuth();
  
  // Security Blocker States
  const [isEnabled, setIsEnabled] = useState(true);
  const [isInitialReveal, setIsInitialReveal] = useState(true);
  
  // Idle Management State
  const [isWarning, setIsWarning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(COUNTDOWN_SECONDS);
  const idleTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);

  const [cachedStore, setCachedStore] = useState<{ name: string; logo: string | null; color: string | null } | null>(null);

  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const activeDomain = getActiveStoreDomain();
  const isStoreRoute = pathname.startsWith("/store/") || !!activeDomain;
  const slug = pathname.startsWith("/store/") ? pathname.split("/store/")[1]?.split("/")[0] : null;

  useEffect(() => {
    const cacheKey = slug ? `store_loading_${slug}` : activeDomain ? `store_loading_${activeDomain}` : null;
    if (cacheKey) {
      try {
        const stored = localStorage.getItem(cacheKey);
        if (stored) {
          setCachedStore(JSON.parse(stored));
        }
      } catch (err) {
        console.error("Failed to parse cached store loading metadata in SecurityGuard:", err);
      }
    }
  }, [slug, activeDomain]);

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
  }, []);

  const handleLogout = useCallback(async () => {
    clearTimers();
    setIsWarning(false);
    if (user) {
      await signOut();
    }
  }, [signOut, user, clearTimers]);

  const startCountdown = useCallback(() => {
    setIsWarning(true);
    setTimeLeft(COUNTDOWN_SECONDS);
    
    if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
    
    countdownTimerRef.current = window.setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          handleLogout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [handleLogout]);

  const resetIdleTimer = useCallback(() => {
    // Don't reset timer if already showing warning or if user isn't logged in
    if (!user || isWarning) return;

    clearTimers();
    idleTimerRef.current = window.setTimeout(() => {
      startCountdown();
    }, IDLE_TIMEOUT_MS);
  }, [user, isWarning, clearTimers, startCountdown]);

  // 🎬 1. Automatic 0.3s Intro Reveal on Refresh
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsInitialReveal(false);
    }, INITIAL_REVEAL_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  // Check config from DB view (super fast and zero auth latency)
  useEffect(() => {
    const checkConfig = async () => {
      try {
        const { data } = await supabase
          .from("public_system_settings")
          .select("enable_privacy_shield")
          .maybeSingle();
          
        if (data) {
          const val = data.enable_privacy_shield !== false;
          setIsEnabled(val);
          if (val) document.body.classList.add("shield-active");
          else document.body.classList.remove("shield-active");
        }
      } catch (e) {
        // Fallback to enabled on network failure
        setIsEnabled(true);
        document.body.classList.add("shield-active");
      }
    };
    checkConfig();
  }, []);

  // Set up Global Listeners for Shield & Idle Detection
  useEffect(() => {
    // 1. Global Activity Listeners for Idle Timer
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    activityEvents.forEach(event => {
      window.addEventListener(event, resetIdleTimer, { passive: true });
    });
    
    // Set initial timer
    resetIdleTimer();

    if (!isEnabled) {
      document.body.classList.remove("shield-active");
      return () => {
        activityEvents.forEach(event => window.removeEventListener(event, resetIdleTimer));
        clearTimers();
      };
    }
    document.body.classList.add("shield-active");

    // 🚫 2. Block Right Click Context Menu
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();

    // 🚫 3. Intercept Critical Keyboard Combinations (Optional but kept developer interceptor if present earlier, removing PrintScreen)
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 's' || e.key === 'u')) {
        e.preventDefault();
      }
    };

    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      activityEvents.forEach(event => window.removeEventListener(event, resetIdleTimer));
      clearTimers();
      
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isEnabled, resetIdleTimer, clearTimers]);

  // Consolidated Visual State (Removed passive blurred state, keeping cinematic reveal)
  const isCurrentlyShielded = isInitialReveal && isEnabled;

  const brandLogoUrl = isStoreRoute ? cachedStore?.logo : "/logo.png";
  const brandName = isStoreRoute ? (cachedStore?.name || "Online Store") : "SwiftData";
  const brandColor = isStoreRoute ? (cachedStore?.color || "#f59e0b") : "#f59e0b";

  const isSuspended = profile?.is_suspended === true;

  if (user && isSuspended) {
    return (
      <div className="fixed inset-0 z-[100001] flex flex-col items-center justify-center bg-[#06060c] text-white p-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(239,68,68,0.08)_0%,transparent_70%)] pointer-events-none" />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="bg-card/30 backdrop-blur-xl border border-red-500/20 rounded-3xl p-8 max-w-md w-full text-center shadow-2xl relative overflow-hidden"
        >
          <div className="absolute -top-10 -left-10 w-40 h-40 bg-red-500/10 rounded-full blur-3xl pointer-events-none" />
          
          <div className="w-20 h-20 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6 relative group">
            <div className="absolute inset-0 rounded-2xl bg-red-500/20 blur-md animate-pulse" />
            <Lock className="w-10 h-10 text-red-500 relative z-10" />
          </div>

          <h2 className="text-2xl font-black mb-3 tracking-tight bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
            Account Suspended
          </h2>
          
          <p className="text-red-400/90 text-xs font-bold uppercase tracking-widest mb-4">
            Access Restricted
          </p>

          <p className="text-muted-foreground text-sm leading-relaxed mb-8">
            Your account has been suspended by the platform administrator. You are currently restricted from accessing your wallet, dashboard, and making purchases.
          </p>

          <div className="flex flex-col gap-3">
            {profile?.support_number && (
              <a
                href={`https://wa.me/${profile.support_number.replace(/\D+/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 px-4 bg-red-600 hover:bg-red-700 text-white font-black rounded-2xl transition-all shadow-lg shadow-red-600/10 text-center text-sm"
              >
                Contact Customer Support
              </a>
            )}
            <button
              onClick={handleLogout}
              className="w-full py-3.5 px-4 bg-white/5 hover:bg-white/10 text-muted-foreground font-bold rounded-2xl flex items-center justify-center gap-2 transition-all border border-white/5 text-sm"
            >
              <LogOut className="w-4 h-4" /> Log Out
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden selection:bg-primary selection:text-black">
      {/* Main Application Layer */}
      <div className={`transition-all duration-300 ${isCurrentlyShielded ? "md:blur-xl blur-lg grayscale scale-[0.99] md:scale-[0.98]" : "blur-0"}`}>
        {children}
      </div>

      {/* 🛡️ Layer 1: Identity Brand Shield Overlay */}
      <AnimatePresence>
        {isCurrentlyShielded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-background/98 md:bg-background/95 backdrop-blur-lg md:backdrop-blur-2xl"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              className="flex flex-col items-center text-center px-6 max-w-md"
            >
              {/* 💎 Brand Logo integration with pulsing glow */}
              <div className="relative w-24 h-24 mb-8 flex items-center justify-center group">
                <div 
                  className="absolute inset-0 rounded-full animate-ping opacity-40 blur-md" 
                  style={{ backgroundColor: `${brandColor}4d` }}
                />
                <div 
                  className="absolute inset-0 rounded-3xl border bg-black/5 animate-pulse" 
                  style={{ borderColor: `${brandColor}33` }}
                />
                {brandLogoUrl ? (
                  <img 
                    src={brandLogoUrl} 
                    alt={brandName} 
                    className="w-16 h-16 object-contain drop-shadow-2xl relative z-10 transition-transform group-hover:scale-110 duration-500" 
                  />
                ) : (
                  <Lock className="w-8 h-8 relative z-10 animate-pulse" style={{ color: brandColor }} />
                )}
              </div>

              <h2 className="text-2xl font-black mb-2 text-foreground tracking-tight flex items-center gap-2">
                <Lock className="w-5 h-5" style={{ color: brandColor }} /> 
                Secure Protection
              </h2>
              <p className="text-muted-foreground text-sm font-medium leading-relaxed max-w-[280px]">
                {isInitialReveal ? "Authenticating secure runtime environment..." : "Your wallet and account privacy are actively enforced."}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ⏳ Layer 2: Auto-Logout Idle Warning Modal */}
      <AnimatePresence>
        {isWarning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-card border border-white/10 rounded-3xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl"
            >
              <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-6">
                <Clock className="w-8 h-8 text-amber-500 animate-pulse" />
              </div>
              <h3 className="text-xl font-black text-foreground mb-2">Session Expiring?</h3>
              <p className="text-muted-foreground text-sm mb-6">
                You've been inactive for a while. We'll log you out for your wallet's safety in <span className="text-amber-500 font-black">{timeLeft}s</span>.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    setIsWarning(false);
                    resetIdleTimer(); // Restart the 15m window
                  }}
                  className="w-full py-3 px-4 bg-primary text-black font-black rounded-2xl hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-primary/20"
                >
                  I'm Still Here
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full py-3 px-4 bg-white/5 text-muted-foreground font-bold rounded-2xl hover:bg-white/10 flex items-center justify-center gap-2 transition-all"
                >
                  <LogOut className="w-4 h-4" /> Log Out Now
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
