import { useState, useEffect } from "react";
import { CheckCircle2, ShoppingBag, Zap } from "lucide-react";

const NAMES = ["K. Amponsah", "E. Osei", "M. Mensah", "A. Boateng", "D. Appiah", "S. Owusu", "C. Darko", "J. Asare", "F. Addo", "P. Baah"];
const PACKAGES = ["5GB MTN", "10GB MTN", "1GB MTN", "2GB Telecel", "5GB AirtelTigo", "15GB MTN", "30GB Telecel", "20GB MTN"];
const TIMES = ["Just now", "2 mins ago", "5 mins ago", "1 min ago", "Just now"];

export const LiveActivityToast = () => {
  const [visible, setVisible] = useState(false);
  const [currentData, setCurrentData] = useState({ name: "", pkg: "", time: "" });

  useEffect(() => {
    const triggerPopup = () => {
      const randName = NAMES[Math.floor(Math.random() * NAMES.length)];
      const randPkg = PACKAGES[Math.floor(Math.random() * PACKAGES.length)];
      const randTime = TIMES[Math.floor(Math.random() * TIMES.length)];
      
      setCurrentData({ name: randName, pkg: randPkg, time: randTime });
      setVisible(true);
      
      // Hide after 6 seconds
      setTimeout(() => {
        setVisible(false);
      }, 6000);
    };

    // Delay on mobile to avoid covering action buttons early
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    const initialDelay = setTimeout(triggerPopup, isMobile ? 35000 : 10000);

    // Repeat less frequently on mobile
    const interval = setInterval(() => {
      triggerPopup();
    }, isMobile ? 60000 : Math.random() * 15000 + 25000);

    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
    };
  }, []);

  if (!visible) return null;

  return (
    <aside 
      aria-label="Live activity notification"
      className="fixed bottom-3 left-3 right-3 sm:right-auto sm:left-6 sm:bottom-6 z-[80] pointer-events-none animate-in slide-in-from-bottom-4 fade-in duration-300 ease-out fill-mode-both"
    >
      <div className="bg-[#0d140d]/95 backdrop-blur-xl border border-white/10 rounded-2xl p-3 sm:p-3.5 flex items-center gap-3 shadow-2xl max-w-xs sm:max-w-sm pointer-events-auto">
        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0 relative">
          <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center border-2 border-[#0d140d]">
            <CheckCircle2 className="w-2.5 h-2.5 text-white" />
          </div>
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Live Delivery</span>
            <span className="text-[9px] text-emerald-400 font-bold">{currentData.time}</span>
          </div>
          <p className="text-xs text-white font-medium leading-snug truncate">
            <span className="text-white font-bold">{currentData.name}</span> received <span className="text-amber-400 font-black">{currentData.pkg}</span>
          </p>
        </div>
      </div>
    </aside>
  );
};
