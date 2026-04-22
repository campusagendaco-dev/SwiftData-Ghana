import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Gift, X, Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const POS_KEY = "free-data-btn-pos";

function clamp(x: number, y: number, width: number, height: number) {
  return {
    x: Math.max(8, Math.min(window.innerWidth - width - 8, x)),
    y: Math.max(8, Math.min(window.innerHeight - height - 8, y)),
  };
}

function loadSavedPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

const NETWORK_COLORS: Record<string, string> = {
  MTN: "#FFC107",
  Telecel: "#E53935",
  AirtelTigo: "#6366f1",
};

const FreeDataButton = () => {
  const { toast } = useToast();
  const [campaign, setCampaign] = useState<{
    enabled: boolean;
    network: string;
    packageSize: string;
  } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);

  // Drag state
  const [pos, setPos] = useState<{ x: number; y: number } | null>(loadSavedPos);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);
  const didDrag = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const posRef = useRef(pos);

  const startDrag = useCallback((clientX: number, clientY: number, rect: DOMRect) => {
    dragging.current = true;
    didDrag.current = false;
    dragOffset.current = { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const moveDrag = useCallback((clientX: number, clientY: number) => {
    if (!dragging.current || !buttonRef.current) return;
    didDrag.current = true;
    const rect = buttonRef.current.getBoundingClientRect();
    const clamped = clamp(clientX - dragOffset.current.x, clientY - dragOffset.current.y, rect.width, rect.height);
    posRef.current = clamped;
    setPos(clamped);
  }, []);

  const endDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    if (didDrag.current && posRef.current) {
      localStorage.setItem(POS_KEY, JSON.stringify(posRef.current));
    }
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => moveDrag(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current) return;
      moveDrag(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", endDrag);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchmove", onTouchMove); // duplicate removal, harmless
    };
  }, [moveDrag, endDrag]);

  // Check if they already claimed locally
  useEffect(() => {
    if (localStorage.getItem("has_claimed_free_data")) {
      setClaimed(true);
    }
  }, []);

  useEffect(() => {
    const fetchCampaign = async () => {
      const { data } = await supabase
        .from("system_settings")
        .select("free_data_enabled, free_data_network, free_data_package_size")
        .eq("id", 1)
        .maybeSingle();

      if (data && data.free_data_enabled) {
        setCampaign({
          enabled: true,
          network: data.free_data_network || "MTN",
          packageSize: data.free_data_package_size || "1GB",
        });
      } else {
        setCampaign(null);
      }
    };
    fetchCampaign();
    const interval = setInterval(fetchCampaign, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!campaign || !campaign.enabled) return null;

  const handleClaim = async () => {
    const phoneDigits = phone.replace(/\D+/g, "");
    if (phoneDigits.length < 9 || phoneDigits.length > 12) {
      toast({ title: "Invalid phone number", variant: "destructive" });
      return;
    }

    setClaiming(true);

    const { error } = await supabase.from("orders").insert({
      order_type: "free_data_claim" as any,
      network: campaign.network,
      package_size: campaign.packageSize,
      customer_phone: phoneDigits,
      amount: 0,
      profit: 0,
      status: "pending",
    } as any);

    if (error) {
      toast({ title: "Claim failed", description: "Something went wrong. Try again.", variant: "destructive" });
    } else {
      setClaimed(true);
      localStorage.setItem("has_claimed_free_data", "true");
      toast({
        title: "Claimed successfully!",
        description: `Your free ${campaign.packageSize} data is being processed.`,
      });
      setTimeout(() => setIsOpen(false), 4000);
    }
    setClaiming(false);
  };

  const accentColor = NETWORK_COLORS[campaign.network] || "#22c55e";
  const posStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { bottom: 90, right: 20 }; // Moved up so it doesn't collide with lower elements

  return (
    <>
      {/* Floating Button */}
      {!isOpen && (
        <div className="fixed z-50 select-none" style={posStyle}>
          <button
            ref={buttonRef}
            onMouseDown={(e) => {
              startDrag(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
              e.preventDefault();
            }}
            onTouchStart={(e) => {
              startDrag(e.touches[0].clientX, e.touches[0].clientY, e.currentTarget.getBoundingClientRect());
            }}
            onClick={(e) => {
              if (didDrag.current) {
                e.preventDefault();
              } else {
                setIsOpen(true);
              }
            }}
            className="flex items-center gap-2 rounded-full pr-4 pl-1.5 py-1.5 shadow-2xl transition-transform hover:scale-105 active:scale-95 group"
            style={{
              background: `linear-gradient(135deg, ${accentColor} 0%, ${accentColor}dd 100%)`,
              boxShadow: `0 8px 32px ${accentColor}60, 0 4px 12px rgba(0,0,0,0.3)`,
              border: "1px solid rgba(255,255,255,0.2)",
              cursor: "grab",
            }}
          >
            <span
              className="absolute left-1.5 top-1.5 bottom-1.5 w-9 rounded-full pointer-events-none"
              style={{ background: "rgba(255,255,255,0.3)", animation: "pulse-ring 2s infinite" }}
            />
            <div className="relative z-10 flex items-center justify-center w-9 h-9 bg-white rounded-full shadow-inner shrink-0">
              <Gift className="w-5 h-5 gift-bounce" style={{ color: accentColor }} />
            </div>
            <div className="relative z-10 flex flex-col items-start justify-center text-black leading-none">
              <span className="text-[9px] font-bold uppercase tracking-wider opacity-90 mb-0.5">Claim Now</span>
              <span className="text-sm font-black tracking-tight drop-shadow-sm">FREE DATA</span>
            </div>
          </button>
        </div>
      )}

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl overflow-hidden border border-white/10 relative shadow-2xl animate-in zoom-in-95 duration-200" style={{ background: "#11111a" }}>
            <button onClick={() => setIsOpen(false)} className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
            
            <div className="p-6 text-center" style={{ background: `linear-gradient(180deg, ${accentColor}20 0%, transparent 100%)` }}>
              <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-lg border border-white/10" style={{ background: accentColor }}>
                <Gift className="w-8 h-8 text-black gift-bounce" />
              </div>
              <h2 className="text-2xl font-black text-white mb-1">Free {campaign.network} Data</h2>
              <p className="text-sm text-white/50 mb-6">Claim your free {campaign.packageSize} bundle instantly! No payment required.</p>

              {claimed ? (
                <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-5 flex flex-col items-center">
                  <CheckCircle2 className="w-10 h-10 text-green-400 mb-2" />
                  <p className="font-bold text-green-400 text-lg">Claim Received!</p>
                  <p className="text-xs text-white/60 mt-1">Your data is being processed and will arrive shortly.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-left">
                    <label className="text-xs font-semibold text-white/50 ml-1 mb-1 block">Phone Number</label>
                    <input
                      type="tel"
                      placeholder="0XXXXXXXXX"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      maxLength={12}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder-white/20 focus:outline-none focus:border-white/30 text-center font-bold tracking-widest transition-colors"
                    />
                  </div>
                  <button
                    onClick={handleClaim}
                    disabled={claiming || phone.length < 9}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-black text-black transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:scale-100 shadow-lg"
                    style={{ background: accentColor }}
                  >
                    {claiming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Gift className="w-5 h-5" />}
                    {claiming ? "Processing..." : `Claim ${campaign.packageSize} Now`}
                  </button>
                  <p className="text-[10px] text-white/30 pt-2">One claim per person. Admin approval required.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 0.8; }
          70% { transform: scale(1.4); opacity: 0; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        @keyframes subtle-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px) scale(1.05); }
        }
        .gift-bounce {
          animation: subtle-bounce 2s infinite ease-in-out;
        }
      `}</style>
    </>
  );
};

export default FreeDataButton;
