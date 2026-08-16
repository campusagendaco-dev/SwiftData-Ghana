import { useState, useEffect } from "react";
import { Download, X, Share } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const InstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const hasDismissed = localStorage.getItem("pwa-prompt-dismissed");
    
    const handleBeforeInstallPrompt = (e: Event) => {
      if (hasDismissed) return;
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // iOS Detection
    const _isIos = /ipad|iphone|ipod/.test(navigator.userAgent.toLowerCase()) && !(window as any).MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

    if (_isIos) {
      setIsIos(true);
    }

    if (_isIos && !isStandalone && !hasDismissed) {
      // Show iOS prompt after a short delay
      const timer = setTimeout(() => setIsVisible(true), 2500);
      return () => {
        clearTimeout(timer);
        window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      };
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setIsVisible(false);
      }
      setDeferredPrompt(null);
    } else if (isIos) {
      alert("To install: Tap the Share icon at the bottom of Safari, then scroll down and tap 'Add to Home Screen'.");
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem("pwa-prompt-dismissed", "true");
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-6 left-4 right-4 md:left-auto md:right-6 md:w-[380px] z-[100] bg-card text-card-foreground rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.3)] p-5 border border-border flex items-start gap-4 animate-in slide-in-from-bottom-8 duration-500 fade-in">
      <div className="w-14 h-14 bg-gradient-to-br from-amber-300 to-amber-500 rounded-2xl flex items-center justify-center shrink-0 shadow-inner">
        <img src="/logo.png" alt="App Logo" className="w-8 h-8 object-contain drop-shadow-md" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-start mb-1">
          <h3 className="font-display font-bold text-base tracking-tight leading-tight">Install SwiftData App</h3>
          <button 
            onClick={handleDismiss} 
            aria-label="Dismiss install prompt"
            title="Dismiss"
            className="text-muted-foreground hover:text-foreground transition-colors -mt-1 -mr-1 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
          Add SwiftData GH to your home screen for faster access, one-tap orders, and a seamless native experience.
        </p>
        
        {isIos && !deferredPrompt ? (
          <div className="text-[11px] font-medium text-amber-500 bg-amber-500/10 px-3 py-2 rounded-lg flex flex-col gap-1.5 border border-amber-500/20">
            <span className="flex items-center gap-1.5"><Share className="w-3.5 h-3.5 shrink-0" /> 1. Tap the Share icon below</span>
            <span className="flex items-center gap-1.5"><Download className="w-3.5 h-3.5 shrink-0" /> 2. Select "Add to Home Screen"</span>
          </div>
        ) : (
          <Button onClick={handleInstall} className="w-full bg-amber-400 text-black hover:bg-amber-500 font-bold shadow-md h-10 rounded-xl gap-2">
            <Download className="w-4 h-4" />
            Install Now
          </Button>
        )}
      </div>
    </div>
  );
};

export default InstallPrompt;
