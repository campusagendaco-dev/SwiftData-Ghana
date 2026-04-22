import { useEffect, useRef, useState, useCallback } from "react";

const DEFAULT_LINK = "https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40";
const POS_KEY = "wa-btn-pos";

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
  } catch { /* ignore error and return null */ }
  return null;
}

const WhatsAppButton = () => {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(loadSavedPos);
  
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
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", endDrag);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", endDrag);
    };
  }, [moveDrag, endDrag]);

  const posStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { bottom: 28, left: 20 };

  return (
    <div className="fixed z-50 select-none" style={posStyle}>
      {/* Button */}
      <a
        ref={buttonRef}
        href={DEFAULT_LINK}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Join our WhatsApp Channel — 50K+ followers"
        onMouseDown={(e) => {
          startDrag(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
          e.preventDefault();
        }}
        onTouchStart={(e) => {
          startDrag(e.touches[0].clientX, e.touches[0].clientY, e.currentTarget.getBoundingClientRect());
        }}
        onClick={(e) => { if (didDrag.current) e.preventDefault(); }}
        className="relative flex items-center gap-2.5 rounded-full pr-5 pl-2 py-2 shadow-2xl transition-transform hover:scale-105 active:scale-95 group"
        style={{
          background: "linear-gradient(135deg, #25D366 0%, #128C7E 100%)",
          cursor: "grab",
          boxShadow: "0 8px 32px rgba(37,211,102,0.4), 0 4px 12px rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.2)"
        }}
      >
        {/* Pulse ring around the icon area */}
        <span
          className="absolute left-2 top-2 bottom-2 w-10 rounded-full"
          style={{ background: "rgba(255,255,255,0.3)", animation: "wa-pulse 2.5s ease-out infinite", zIndex: 0 }}
        />

        {/* WA icon container */}
        <div className="relative z-10 flex items-center justify-center w-10 h-10 bg-white rounded-full shadow-inner shrink-0">
          <svg viewBox="0 0 32 32" width="24" height="24" fill="#128C7E" xmlns="http://www.w3.org/2000/svg">
            <path d="M16.004 2.667C8.64 2.667 2.667 8.64 2.667 16c0 2.347.614 4.56 1.693 6.48L2.667 29.333l7.04-1.653A13.28 13.28 0 0016.004 29.333C23.36 29.333 29.333 23.36 29.333 16S23.36 2.667 16.004 2.667zm0 24c-2.133 0-4.133-.587-5.84-1.6l-.413-.24-4.187.987.987-4.08-.267-.427A10.597 10.597 0 015.333 16c0-5.893 4.773-10.667 10.667-10.667S26.667 10.107 26.667 16 21.893 26.667 16 26.667h.004zm5.84-7.973c-.32-.16-1.893-.933-2.187-1.04-.293-.107-.507-.16-.72.16-.213.32-.827 1.04-.987 1.253-.16.213-.347.24-.667.08-.32-.16-1.36-.507-2.587-1.6-.96-.853-1.6-1.907-1.787-2.227-.187-.32 0-.48.147-.627.133-.133.32-.347.48-.52.16-.173.213-.32.32-.533.107-.213.053-.4-.027-.56-.08-.16-.72-1.733-.987-2.373-.253-.613-.52-.533-.72-.547h-.613c-.213 0-.56.08-.853.4-.293.32-1.12 1.093-1.12 2.667 0 1.573 1.147 3.093 1.307 3.307.16.213 2.267 3.467 5.493 4.853.773.333 1.373.533 1.84.68.773.24 1.48.213 2.027.133.627-.093 1.893-.773 2.16-1.52.267-.747.267-1.387.187-1.52-.08-.133-.293-.213-.613-.373z" />
          </svg>
        </div>

        {/* Text */}
        <div className="relative z-10 flex flex-col items-start justify-center text-white leading-none">
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-90 mb-0.5">Join Community</span>
          <span className="text-sm font-black tracking-tight drop-shadow-sm">50K Followers</span>
        </div>
      </a>

      <style>{`
        @keyframes wa-pulse {
          0% { transform: scale(1); opacity: 0.7; }
          70% { transform: scale(1.35); opacity: 0; }
          100% { transform: scale(1.35); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default WhatsAppButton;
