import { useState, useEffect } from "react";
import { WifiOff, AlertTriangle, Wifi, CheckCircle2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useConnectivity } from "@/hooks/useConnectivity";

export const OfflineAlert = () => {
  const { isOnline, quality } = useConnectivity();
  const [showRestored, setShowRestored] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Track when we come back online to show a "Back Online" message
  useEffect(() => {
    if (isOnline) {
      if (!isOnline) return; // Logic check
      setShowRestored(true);
      const timer = setTimeout(() => setShowRestored(false), 5000);
      return () => clearTimeout(timer);
    } else {
      setShowRestored(false);
      setDismissed(false);
    }
  }, [isOnline]);

  const showSlowWarning = isOnline && (quality === "poor" || quality === "fair") && !dismissed;
  const showOfflineWarning = !isOnline;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] pointer-events-none flex flex-col items-center p-4 gap-2">
      <AnimatePresence>
        {/* Offline Warning */}
        {showOfflineWarning && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="pointer-events-auto bg-red-600 text-white py-2.5 px-5 rounded-2xl flex items-center gap-3 shadow-2xl border border-red-500/50 backdrop-blur-md"
          >
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center animate-pulse">
              <WifiOff className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-black tracking-tight leading-none mb-0.5">Offline Mode</span>
              <span className="text-[10px] font-bold text-white/70 uppercase tracking-widest">Check your connection</span>
            </div>
          </motion.div>
        )}

        {/* Slow Connection Warning */}
        {showSlowWarning && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="pointer-events-auto bg-amber-500 text-black py-2.5 px-5 rounded-2xl flex items-center gap-3 shadow-2xl border border-amber-400/50 backdrop-blur-md"
          >
            <div className="w-8 h-8 rounded-full bg-black/10 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div className="flex flex-col flex-1">
              <span className="text-sm font-black tracking-tight leading-none mb-0.5">Weak Connection</span>
              <span className="text-[10px] font-bold text-black/60 uppercase tracking-widest">Actions may take longer</span>
            </div>
            <button 
              onClick={() => setDismissed(true)}
              className="p-1 hover:bg-black/5 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {/* Back Online Confirmation */}
        {showRestored && isOnline && !showSlowWarning && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="pointer-events-auto bg-emerald-600 text-white py-2.5 px-5 rounded-2xl flex items-center gap-3 shadow-2xl border border-emerald-500/50 backdrop-blur-md"
          >
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-black tracking-tight leading-none mb-0.5">Back Online</span>
              <span className="text-[10px] font-bold text-white/70 uppercase tracking-widest">Connection restored</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
