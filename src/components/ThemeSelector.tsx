import { useState, useRef, useEffect } from "react";
import { Palette } from "lucide-react";
import { THEMES } from "@/lib/themes";
import { useAppTheme } from "@/contexts/ThemeContext";

const ThemeSelector = () => {
  const { theme, setThemeId } = useAppTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="fixed bottom-[5.5rem] right-6 z-50">
      {open && (
        <div
          className="absolute bottom-14 right-0 mb-1 rounded-2xl border border-white/10 shadow-2xl p-3 w-[230px]"
          style={{ background: "rgba(var(--glass-rgb, 20,20,40), 0.92)", backdropFilter: "blur(24px)" }}
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
                <span
                  className="w-7 h-7 rounded-full border-2 border-white/20"
                  style={{ background: t.dot }}
                />
                <span className="text-[10px] text-white/80 font-medium leading-none">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-105"
        style={{ background: theme.dot, boxShadow: `0 4px 20px ${theme.dot}55` }}
        aria-label="Change theme"
      >
        <Palette className="w-5 h-5 text-black/80" />
      </button>
    </div>
  );
};

export default ThemeSelector;
