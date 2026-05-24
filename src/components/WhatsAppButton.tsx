import { useEffect, useRef, useState, useCallback } from "react";
import { MessageCircle, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const DEFAULT_LINK = "https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40";
const POS_KEY = "wa-btn-pos-v3"; // Changed key to reset for new design

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
  } catch { /* ignore error */ }
  return null;
}

const WhatsAppButton = () => {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(loadSavedPos);
  const [isHovered, setIsHovered] = useState(false);
  
  const buttonRef = useRef<HTMLAnchorElement>(null);
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
    const onResize = () => {
      setPos((currentPos) => {
        if (!currentPos || !buttonRef.current) return currentPos;
        const rect = buttonRef.current.getBoundingClientRect();
        const newPos = clamp(currentPos.x, currentPos.y, rect.width, rect.height);
        posRef.current = newPos;
        return newPos;
      });
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", endDrag);
    window.addEventListener("resize", onResize);
    
    // Initial clamp just in case loaded pos is out of bounds
    onResize();

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", endDrag);
      window.removeEventListener("resize", onResize);
    };
  }, [moveDrag, endDrag]);

  const posStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { bottom: 96, right: 24 }; // Raised from 32 to 96 to avoid mobile bottom navs

  return (
    <div 
      className="fixed z-[60] select-none group" 
      style={posStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Tooltip-style Badge */}
      <div className={cn(
        "absolute -top-10 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-black/80 backdrop-blur-md text-white text-[10px] font-black rounded-xl border border-white/10 shadow-2xl transition-all duration-300 whitespace-nowrap pointer-events-none",
        isHovered ? "opacity-100 -top-12 scale-100" : "opacity-0 -top-8 scale-90"
      )}>
        Join 50,000+ Followers
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-black/80 border-r border-b border-white/10 rotate-45" />
      </div>

      {/* Main Button */}
      <a
        ref={buttonRef}
        href={DEFAULT_LINK}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Join our WhatsApp Channel"
        onMouseDown={(e) => {
          startDrag(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
          e.preventDefault();
        }}
        onTouchStart={(e) => {
          startDrag(e.touches[0].clientX, e.touches[0].clientY, e.currentTarget.getBoundingClientRect());
        }}
        onClick={(e) => { if (didDrag.current) e.preventDefault(); }}
        className={cn(
          "relative flex items-center justify-center transition-all duration-500 ease-in-out shadow-2xl",
          isHovered ? "w-44 h-12 rounded-2xl px-4" : "w-14 h-14 rounded-full"
        )}
        style={{
          background: "linear-gradient(135deg, #25D366 0%, #128C7E 100%)",
          cursor: "grab",
          boxShadow: "0 10px 40px rgba(37,211,102,0.4), inset 0 0 0 1px rgba(255,255,255,0.2)",
        }}
      >
        {/* Glow Ring */}
        <div className="absolute inset-0 rounded-inherit bg-white/20 animate-ping opacity-20 pointer-events-none" style={{ animationDuration: '3s' }} />
        
        <div className="flex items-center gap-3 relative z-10">
          <div className="relative">
            <svg viewBox="0 0 32 32" className={cn("transition-all duration-300", isHovered ? "w-6 h-6" : "w-8 h-8")} fill="white" xmlns="http://www.w3.org/2000/svg">
              <path d="M16.004 2.667C8.64 2.667 2.667 8.64 2.667 16c0 2.347.614 4.56 1.693 6.48L2.667 29.333l7.04-1.653A13.28 13.28 0 0016.004 29.333C23.36 29.333 29.333 23.36 29.333 16S23.36 2.667 16.004 2.667zm0 24c-2.133 0-4.133-.587-5.84-1.6l-.413-.24-4.187.987.987-4.08-.267-.427A10.597 10.597 0 015.333 16c0-5.893 4.773-10.667 10.667-10.667S26.667 10.107 26.667 16 21.893 26.667 16 26.667h.004zm5.84-7.973c-.32-.16-1.893-.933-2.187-1.04-.293-.107-.507-.16-.72.16-.213.32-.827 1.04-.987 1.253-.16.213-.347.24-.667.08-.32-.16-1.36-.507-2.587-1.6-.96-.853-1.6-1.907-1.787-2.227-.187-.32 0-.48.147-.627.133-.133.32-.347.48-.52.16-.173.213-.32.32-.533.107-.213.053-.4-.027-.56-.08-.16-.72-1.733-.987-2.373-.253-.613-.52-.533-.72-.547h-.613c-.213 0-.56.08-.853.4-.293.32-1.12 1.093-1.12 2.667 0 1.573 1.147 3.093 1.307 3.307.16.213 2.267 3.467 5.493 4.853.773.333 1.373.533 1.84.68.773.24 1.48.213 2.027.133.627-.093 1.893-.773 2.16-1.52.267-.747.267-1.387.187-1.52-.08-.133-.293-.213-.613-.373z" />
            </svg>
            {!isHovered && (
              <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center border-2 border-[#128C7E] shadow-lg animate-bounce">
                50K
              </div>
            )}
          </div>
          
          <div className={cn(
            "flex flex-col leading-none transition-all duration-500 overflow-hidden",
            isHovered ? "w-28 opacity-100" : "w-0 opacity-0"
          )}>
            <span className="text-[10px] font-black uppercase tracking-widest text-white/70 mb-1">WhatsApp</span>
            <span className="text-sm font-black text-white whitespace-nowrap">Join Channel</span>
          </div>
        </div>
      </a>
    </div>
  );
};

export default WhatsAppButton;

