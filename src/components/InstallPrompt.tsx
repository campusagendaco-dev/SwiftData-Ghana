import { useState, useEffect } from "react";
import { Download, X, Share, Smartphone } from "lucide-react";
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
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    // Check if dismissed previously or in the current session
    const hasDismissedPermanent = localStorage.getItem("pwa-prompt-dismissed");
    const hasDismissedSession = sessionStorage.getItem("pwa-prompt-dismissed");
    if (hasDismissedPermanent || hasDismissedSession) return;

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Non-obtrusive appearance after user has had time to browse (12 seconds)
      const timer = setTimeout(() => {
        const dismissedNow = localStorage.getItem("pwa-prompt-dismissed") || sessionStorage.getItem("pwa-prompt-dismissed");
        if (!dismissedNow) setIsVisible(true);
      }, 12000);
      return () => clearTimeout(timer);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // Listen for successful installation
    const handleAppInstalled = () => {
      setIsVisible(false);
      localStorage.setItem("pwa-prompt-dismissed", "true");
    };
    window.addEventListener("appinstalled", handleAppInstalled);

    // iOS Detection
    const _isIos = /ipad|iphone|ipod/.test(navigator.userAgent.toLowerCase()) && !(window as any).MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

    if (_isIos) {
      setIsIos(true);
    }

    if (_isIos && !isStandalone && !hasDismissedPermanent && !hasDismissedSession) {
      // Delay iOS prompt to avoid blocking initial viewing/purchasing flow (20 seconds)
      const timer = setTimeout(() => {
        const dismissedNow = localStorage.getItem("pwa-prompt-dismissed") || sessionStorage.getItem("pwa-prompt-dismissed");
        if (!dismissedNow) setIsVisible(true);
      }, 20000);
      return () => {
        clearTimeout(timer);
        window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
        window.removeEventListener("appinstalled", handleAppInstalled);
      };
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setIsVisible(false);
        localStorage.setItem("pwa-prompt-dismissed", "true");
      }
      setDeferredPrompt(null);
    } else if (isIos) {
      setShowIosGuide((prev) => !prev);
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem("pwa-prompt-dismissed", "true");
    sessionStorage.setItem("pwa-prompt-dismissed", "true");
  };

  if (!isVisible) return null;

  return (
    <aside 
      aria-label="Install App"
      className="fixed bottom-4 left-3 right-3 sm:left-auto sm:right-6 sm:bottom-6 sm:w-[390px] z-[95] bg-card/95 text-card-foreground backdrop-blur-xl rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.25)] border border-border/80 p-3 sm:p-3.5 animate-in slide-in-from-bottom-5 duration-300 fade-in"
    >
      <div className="flex items-center gap-3">
        {/* App Logo */}
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-300 to-amber-500 flex items-center justify-center shrink-0 shadow-sm">
          <img src="/logo.png" alt="SwiftData Ghana" className="w-6 h-6 object-contain" />
        </div>

        {/* Text info */}
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-xs sm:text-sm tracking-tight text-foreground truncate leading-tight">
            Install SwiftData App
          </p>
          <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
            Faster access &amp; instant 1-tap checkout
          </p>
        </div>

        {/* Action Button */}
        {isIos && !deferredPrompt ? (
          <Button 
            onClick={handleInstall} 
            size="sm"
            variant="outline"
            className="text-xs font-bold h-9 px-3 rounded-xl border-amber-500/30 text-amber-500 hover:bg-amber-500/10 shrink-0 gap-1"
          >
            <Share className="w-3.5 h-3.5" />
            Install
          </Button>
        ) : (
          <Button 
            onClick={handleInstall} 
            size="sm"
            className="bg-amber-400 text-black hover:bg-amber-500 font-bold text-xs h-9 px-3.5 rounded-xl shrink-0 gap-1.5 shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            Install
          </Button>
        )}

        {/* Dismiss Button with accessible 40px touch target */}
        <button 
          onClick={handleDismiss} 
          aria-label="Dismiss install prompt"
          title="Dismiss"
          className="w-10 h-10 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0 -mr-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* iOS Safari Guide Accordion */}
      {isIos && showIosGuide && (
        <div className="mt-2.5 pt-2.5 border-t border-border/60 text-[11px] text-amber-600 dark:text-amber-400 flex flex-col gap-1.5 animate-in fade-in duration-200">
          <span className="flex items-center gap-1.5">
            <Share className="w-3.5 h-3.5 shrink-0" /> 1. Tap the <strong>Share</strong> button at bottom of Safari
          </span>
          <span className="flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5 shrink-0" /> 2. Scroll and select <strong>"Add to Home Screen"</strong>
          </span>
        </div>
      )}
    </aside>
  );
};

export default InstallPrompt;

