import { useState, useEffect } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Gift, Zap, Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const WelcomeAnnouncement = () => {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<{
    show: boolean;
    title: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    const fetchAnnouncement = async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("show_announcement, announcement_title, announcement_message")
        .eq("id", 1)
        .maybeSingle();

      if (!error && data?.show_announcement) {
        const storedDismissed = localStorage.getItem("swift_announcement_dismissed");
        const announcementId = btoa(data.announcement_title + data.announcement_message);
        
        // Only show if not dismissed OR if the content has changed
        if (storedDismissed !== announcementId) {
          setSettings({
            show: data.show_announcement,
            title: data.announcement_title,
            message: data.announcement_message
          });
          // Delay popup for better UX
          setTimeout(() => setOpen(true), 1500);
        }
      }
    };

    fetchAnnouncement();
  }, []);

  const handleDismiss = () => {
    if (settings) {
      const announcementId = btoa(settings.title + settings.message);
      localStorage.setItem("swift_announcement_dismissed", announcementId);
    }
    setOpen(false);
  };

  if (!settings) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[450px] p-0 overflow-hidden border-none bg-transparent shadow-2xl">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-[#0A0A0F] border border-white/10 shadow-2xl shadow-emerald-500/10">
          {/* Animated Background Elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2 animate-pulse" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-sky-500/5 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2" />

          {/* Content Wrapper */}
          <div className="relative z-10 p-8 md:p-10 flex flex-col items-center text-center">
            {/* Icon Header */}
            <div className="mb-6 relative">
              <div className="w-20 h-20 rounded-3xl bg-emerald-500/20 border border-emerald-500/20 flex items-center justify-center animate-bounce duration-[3000ms]">
                <Gift className="w-10 h-10 text-emerald-400" />
              </div>
              <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center shadow-lg border-2 border-[#0A0A0F]">
                <Sparkles className="w-4 h-4 text-black" />
              </div>
            </div>

            <DialogHeader className="space-y-3">
              <DialogTitle className="text-3xl font-black text-white tracking-tight leading-tight">
                {settings.title}
              </DialogTitle>
              <DialogDescription className="text-white/60 text-base leading-relaxed">
                {settings.message}
              </DialogDescription>
            </DialogHeader>

            {/* Feature Pills */}
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/5 text-[10px] font-black uppercase tracking-widest text-white/40 flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-sky-400" />
                Instant Rewards
              </div>
              <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/5 text-[10px] font-black uppercase tracking-widest text-white/40 flex items-center gap-1.5">
                <Gift className="w-3 h-3 text-emerald-400" />
                Loyalty Points
              </div>
            </div>

            {/* Actions */}
            <div className="mt-10 w-full flex flex-col gap-3">
              <Button 
                onClick={handleDismiss}
                className="w-full h-14 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-black font-black text-sm uppercase tracking-widest shadow-xl shadow-emerald-500/20 transition-all active:scale-95"
              >
                Start Earning Now
              </Button>
              <button 
                onClick={handleDismiss}
                className="text-[10px] font-bold text-white/25 uppercase tracking-widest hover:text-white/40 transition-colors py-2"
              >
                Dismiss for now
              </button>
            </div>
          </div>
          
          {/* Close Button Override */}
          <button 
            onClick={handleDismiss}
            className="absolute top-6 right-6 p-2 rounded-full bg-white/5 hover:bg-white/10 transition-all border border-white/5"
          >
            <X className="w-4 h-4 text-white/40" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WelcomeAnnouncement;
