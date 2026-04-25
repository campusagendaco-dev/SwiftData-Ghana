import { ShieldCheck, RefreshCw, WifiOff } from "lucide-react";
import { useState, useEffect } from "react";

const LoadingScreen = () => {
  const [showSlowMessage, setShowSlowMessage] = useState(false);
  const [showRetry, setShowRetry] = useState(false);

  useEffect(() => {
    const slowTimer = setTimeout(() => setShowSlowMessage(true), 6000);
    const retryTimer = setTimeout(() => setShowRetry(true), 12000);
    return () => {
      clearTimeout(slowTimer);
      clearTimeout(retryTimer);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#020402]">
      {/* ── Premium Evening Glow ── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] animate-pulse-gentle" />
      </div>

      {/* ── Signature Activation Animation ── */}
      <div className="relative flex items-center justify-center mb-10">
        {/* Outer Orbit - High Precision */}
        <div className="absolute w-[120px] h-[120px] rounded-full border border-white/5" />
        <div className="absolute w-[120px] h-[120px] rounded-full border-t border-primary/40 animate-spin" style={{ animationDuration: '3s' }} />
        
        {/* Inner Orbit - Faster */}
        <div className="absolute w-[100px] h-[100px] rounded-full border-r border-primary/60 animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }} />

        {/* Logo Container with Gold Pulse */}
        <div className="relative z-10 w-24 h-24 rounded-full bg-[#020402] border border-white/10 backdrop-blur-sm shadow-2xl overflow-hidden flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-primary/5 animate-ping opacity-20" />
          <img
            src="/logo.png"
            alt="SwiftData GH"
            className="w-full h-full object-cover rounded-full"
          />
          <div className="absolute bottom-2 right-2 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center border-2 border-[#020402] shadow-[0_0_15px_rgba(37,99,235,0.4)]">
            <ShieldCheck className="w-3 h-3 text-white" />
          </div>
        </div>
      </div>

      {/* ── Elite Brand Text ── */}
      <div className="text-center space-y-6 px-6 animate-in fade-in slide-in-from-bottom-4 duration-1000">
        <div className="flex flex-col items-center gap-1">
          <h2 className="text-white font-black text-2xl tracking-[0.2em] uppercase">
            SwiftData <span className="text-primary drop-shadow-[0_0_8px_rgba(245,158,11,0.4)]">GH</span>
          </h2>
          <div className="h-px w-12 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        </div>
        
        <div className="flex flex-col items-center gap-5">
          <p className="text-white/30 text-[11px] font-bold uppercase tracking-[0.4em] translate-x-[0.2em]">
            Secure Gateway
          </p>
          
          {/* Elite Progress Line */}
          <div className="w-40 h-[1.5px] bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-transparent via-primary to-transparent animate-progress-slide" />
          </div>
        </div>

        {/* ── Slow Connection / Retry UI ── */}
        <div className="h-20 flex flex-col items-center justify-center gap-4">
          {showSlowMessage && !showRetry && (
            <div className="flex items-center gap-2 text-amber-400/80 animate-in fade-in zoom-in duration-700">
              <WifiOff className="w-3.5 h-3.5" />
              <p className="text-[10px] font-black uppercase tracking-widest">Connection looks slow...</p>
            </div>
          )}

          {showRetry && (
            <div className="flex flex-col items-center gap-3 animate-in slide-in-from-bottom-2 duration-500">
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest text-center max-w-[200px]">
                Still loading? You may have a weak connection.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all group"
              >
                <RefreshCw className="w-3.5 h-3.5 group-hover:rotate-180 transition-transform duration-500" />
                <span className="text-xs font-black uppercase tracking-tight">Reload App</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes progress-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes pulse-gentle {
          0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 0.8; transform: translate(-50%, -50%) scale(1.1); }
        }
        .animate-progress-slide {
          width: 60%;
          animation: progress-slide 2.5s cubic-bezier(0.65, 0.05, 0.36, 1) infinite;
        }
        .animate-pulse-gentle {
          animation: pulse-gentle 4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};


export default LoadingScreen;


