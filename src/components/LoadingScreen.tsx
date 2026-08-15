import { ShieldCheck, RefreshCw, WifiOff, Store, Sparkles, Activity, Lock } from "lucide-react";
import { useState, useEffect } from "react";
import { TraditionalBackground } from "./TraditionalBackground";
import { getActiveStoreDomain } from "@/lib/app-base-url";

const LOADING_MESSAGES = [
  "Establishing Encrypted Gateway...",
  "Synchronizing Telecom Providers...",
  "Loading Data & Airtime Packages...",
  "Verifying Agent Credentials...",
  "Connecting Live Orders Stream..."
];

const LoadingScreen = () => {
  const [showSlowMessage, setShowSlowMessage] = useState(false);
  const [showRetry, setShowRetry] = useState(false);
  const [cachedStore, setCachedStore] = useState<{ name: string; logo: string | null; color: string | null } | null>(null);
  const [msgIndex, setMsgIndex] = useState(0);

  const pathname = window.location.pathname;
  const activeDomain = getActiveStoreDomain();
  const isStoreRoute = pathname.startsWith("/store/") || !!activeDomain;
  const slug = pathname.startsWith("/store/") ? pathname.split("/store/")[1]?.split("/")[0] : null;

  useEffect(() => {
    const slowTimer = setTimeout(() => setShowSlowMessage(true), 10000);
    const retryTimer = setTimeout(() => setShowRetry(true), 18000);

    const msgInterval = setInterval(() => {
      setMsgIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2200);

    const cacheKey = slug ? `store_loading_${slug}` : activeDomain ? `store_loading_${activeDomain}` : null;
    if (cacheKey) {
      try {
        const stored = localStorage.getItem(cacheKey);
        if (stored) {
          setCachedStore(JSON.parse(stored));
        }
      } catch (err) {
        console.error("Failed to parse cached store loading metadata:", err);
      }
    }

    return () => {
      clearTimeout(slowTimer);
      clearTimeout(retryTimer);
      clearInterval(msgInterval);
    };
  }, [slug, activeDomain]);

  // Determine active brand attributes
  const isWhitelabeled = isStoreRoute;
  const brandName = isWhitelabeled
    ? (cachedStore?.name || "ONLINE STORE")
    : "SwiftData GH";
  const brandSubtitle = isWhitelabeled ? "SECURE AGENT PORTAL" : "Telecom Reseller Gateway";
  const brandColor = isWhitelabeled
    ? (cachedStore?.color || "#f59e0b")
    : "#f59e0b";
  const brandLogoUrl = isWhitelabeled ? cachedStore?.logo : "/logo.png";

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#030305] text-white overflow-hidden select-none">
      {/* ── Cultural Grounding Ambient Pattern ── */}
      <TraditionalBackground className="absolute inset-0 z-0 opacity-[0.15] dark:opacity-[0.25]" />

      {/* ── Ambient Background Glow Blobs ── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div 
          className="absolute top-[35%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-[140px] animate-pulse-gentle"
          style={{ background: `${brandColor}20` }} 
        />
        <div className="absolute bottom-[20%] right-[20%] w-[350px] h-[350px] rounded-full bg-blue-600/10 blur-[130px] animate-pulse-gentle" />
        <div className="absolute top-[20%] left-[20%] w-[350px] h-[350px] rounded-full bg-emerald-500/10 blur-[130px] animate-pulse-gentle" />
      </div>

      {/* ── Futuristic Holographic Ring & Logo Loader ── */}
      <div className="relative z-10 flex items-center justify-center mb-10">
        {/* Outer Laser Orbit Ring */}
        <div className="absolute w-[140px] h-[140px] rounded-full border border-white/10" />
        <div 
          className="absolute w-[140px] h-[140px] rounded-full border-t-2 border-r-2 animate-spin" 
          style={{ animationDuration: '2.5s', borderColor: `${brandColor} solid`, borderBottomColor: 'transparent', borderLeftColor: 'transparent' }} 
        />
        
        {/* Counter Orbit Ring */}
        <div 
          className="absolute w-[116px] h-[116px] rounded-full border-b-2 border-l-2 animate-spin" 
          style={{ animationDuration: '1.8s', animationDirection: 'reverse', borderColor: '#38bdf8 solid', borderTopColor: 'transparent', borderRightColor: 'transparent' }} 
        />

        {/* Center Logo Container */}
        <div className="relative z-20 w-24 h-24 rounded-3xl bg-[#030305]/90 border border-white/20 backdrop-blur-xl shadow-2xl flex items-center justify-center overflow-hidden">
          <div 
            className="absolute inset-0 rounded-3xl animate-ping opacity-25" 
            style={{ background: `${brandColor}30` }}
          />
          {brandLogoUrl ? (
            <img
              src={brandLogoUrl}
              alt={brandName}
              className="w-full h-full object-contain p-3.5 relative z-10"
            />
          ) : (
            <Store className="w-9 h-9 relative z-10 animate-pulse" style={{ color: brandColor }} />
          )}

          {/* Verified Security Badge Overlay */}
          <div className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center border-2 border-[#030305] shadow-[0_0_12px_rgba(16,185,129,0.5)] z-30">
            <ShieldCheck className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />
          </div>
        </div>
      </div>

      {/* ── Brand Typography & Dynamic Status ── */}
      <div className="relative z-10 text-center space-y-5 px-6 max-w-sm">
        <div className="flex flex-col items-center gap-1.5">
          {isWhitelabeled ? (
            <h1 className="text-white font-black text-2xl tracking-[0.15em] uppercase text-center font-display">
              {cachedStore ? (
                <>
                  {brandName.split(" ")[0]}{" "}
                  <span style={{ color: brandColor }}>
                    {brandName.split(" ").slice(1).join(" ")}
                  </span>
                </>
              ) : (
                <>
                  ONLINE <span style={{ color: brandColor }}>STORE</span>
                </>
              )}
            </h1>
          ) : (
            <h1 className="text-white font-black text-3xl tracking-[0.15em] uppercase font-display">
              SwiftData <span className="text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.5)]">GH</span>
            </h1>
          )}
          
          <p className="text-slate-400 text-[10px] font-extrabold uppercase tracking-[0.3em] font-mono">
            {brandSubtitle}
          </p>
        </div>

        {/* Dynamic Status Text Ticker */}
        <div className="min-h-[24px] flex items-center justify-center gap-2 text-xs font-mono text-slate-300 font-bold bg-white/5 px-4 py-1.5 rounded-full border border-white/10 backdrop-blur-md">
          <Activity className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
          <span className="animate-in fade-in duration-300">{LOADING_MESSAGES[msgIndex]}</span>
        </div>

        {/* Neon Progress Bar */}
        <div className="w-48 h-1.5 bg-white/10 rounded-full overflow-hidden mx-auto border border-white/10">
          <div 
            className="h-full rounded-full animate-progress-slide" 
            style={{ backgroundImage: `linear-gradient(to right, transparent, ${brandColor}, transparent)` }}
          />
        </div>

        {/* Security Badge Footer */}
        <div className="flex items-center justify-center gap-1.5 text-[10px] font-mono text-slate-500 pt-2">
          <Lock className="w-3 h-3 text-emerald-400" />
          <span>256-Bit SSL Encrypted Connection</span>
        </div>
      </div>

      {/* ── Slow Connection / Retry Controls ── */}
      <div className="absolute bottom-10 inset-x-0 flex flex-col items-center justify-center gap-3 z-20 px-4">
        {showSlowMessage && !showRetry && (
          <div className="flex items-center gap-2 text-amber-400/90 bg-amber-500/10 px-4 py-1.5 rounded-full border border-amber-500/20 text-xs font-bold font-mono animate-in fade-in zoom-in duration-500">
            <WifiOff className="w-3.5 h-3.5 animate-pulse" />
            <span>Connection looks slow, holding connection...</span>
          </div>
        )}

        {showRetry && (
          <div className="flex flex-col items-center gap-2.5 animate-in slide-in-from-bottom-2 duration-500">
            <p className="text-slate-400 text-xs font-bold uppercase tracking-wider text-center font-mono">
              Network Delay Detected
            </p>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400 font-black text-xs uppercase tracking-wide transition-all shadow-lg shadow-amber-950/40 active:scale-95 group"
            >
              <RefreshCw className="w-3.5 h-3.5 group-hover:rotate-180 transition-transform duration-500" />
              <span>Reload Gateway</span>
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes progress-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes pulse-gentle {
          0%, 100% { opacity: 0.4; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 0.75; transform: translate(-50%, -50%) scale(1.1); }
        }
        .animate-progress-slide {
          width: 70%;
          animation: progress-slide 2s cubic-bezier(0.65, 0.05, 0.36, 1) infinite;
        }
        .animate-pulse-gentle {
          animation: pulse-gentle 4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};

export default LoadingScreen;
