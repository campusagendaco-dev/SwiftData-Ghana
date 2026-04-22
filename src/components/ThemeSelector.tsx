import { useState, useRef, useEffect, useCallback } from "react";
import { Palette } from "lucide-react";
import { THEMES } from "@/lib/themes";
import { useAppTheme } from "@/contexts/ThemeContext";

const POS_KEY = "theme-btn-pos";

function clamp(x: number, y: number, w: number, h: number) {
  return {
    x: Math.max(8, Math.min(window.innerWidth - w - 8, x)),
    y: Math.max(8, Math.min(window.innerHeight - h - 8, y)),
  };
}

function loadSavedPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

const ThemeSelector = () => {
  const { theme, setThemeId } = useAppTheme();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(loadSavedPos);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);
  const didDrag = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const posRef = useRef(pos);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const startDrag = useCallback((clientX: number, clientY: number, rect: DOMRect) => {
    dragging.current = true;
    didDrag.current = false;
    dragOffset.current = { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const moveDrag = useCallback((clientX: number, clientY: number) => {
    if (!dragging.current || !buttonRef.current) return;
    didDrag.current = true;
    const rect = buttonRef.current.getBoundingClientRect();
    const clamped = clamp(
      clientX - dragOffset.current.x,
      clientY - dragOffset.current.y,
      rect.width,
      rect.height,
    );
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
    ? { left: pos.x, top: pos.y, bottom: "auto", right: "auto" }
    : { bottom: "5.5rem", right: "1.5rem" };

  // Popup position — flip above button when near bottom, left when near right edge
  const popupStyle: React.CSSProperties = pos
    ? {
        top: pos.y > window.innerHeight / 2 ? "auto" : "calc(100% + 8px)",
        bottom: pos.y > window.innerHeight / 2 ? "calc(100% + 8px)" : "auto",
        right: pos.x > window.innerWidth / 2 ? 0 : "auto",
        left: pos.x > window.innerWidth / 2 ? "auto" : 0,
      }
    : { bottom: "calc(100% + 8px)", right: 0 };

  return (
    <div ref={containerRef} className="fixed z-50 select-none" style={posStyle}>
      {open && (
        <div
          className="absolute rounded-2xl border border-white/10 shadow-2xl p-3 w-[230px]"
          style={{
            ...popupStyle,
            background: "rgba(var(--glass-rgb, 20,20,40), 0.95)",
            backdropFilter: "blur(24px)",
          }}
        >
          <p className="text-xs font-semibold text-white/60 mb-2.5 px-1">Choose Theme</p>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => { setThemeId(t.id); setOpen(false); }}
                className={`flex flex-col items-center gap-1.5 rounded-xl p-2 transition-all ${
                  theme.id === t.id ? "bg-white/15 ring-1 ring-white/30" : "hover:bg-white/10"
                }`}
              >
                <span className="w-7 h-7 rounded-full border-2 border-white/20" style={{ background: t.dot }} />
                <span className="text-[10px] text-white/80 font-medium leading-none">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        ref={buttonRef}
        onMouseDown={(e) => {
          startDrag(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
          e.preventDefault();
        }}
        onTouchStart={(e) => {
          startDrag(e.touches[0].clientX, e.touches[0].clientY, e.currentTarget.getBoundingClientRect());
        }}
        onClick={() => { if (!didDrag.current) setOpen((v) => !v); }}
        className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-105"
        style={{
          background: theme.dot,
          boxShadow: `0 4px 20px ${theme.dot}55`,
          cursor: "grab",
        }}
        aria-label="Change theme"
      >
        <Palette className="w-5 h-5 text-black/80" />
      </button>
    </div>
  );
};

export default ThemeSelector;
