import { useState, useRef, useEffect } from "react";
import { ChevronDown, Tag, Zap, Clock, Smartphone, MessageSquare, Globe, Sparkles, Video } from "lucide-react";

interface Option {
  value: string;
  label: string;
}

interface BundleSelectorDropdownProps {
  options: Option[];
  value: string;
  onChange: (val: string) => void;
  accentColor?: string;
  isDark?: boolean;
}

export default function BundleSelectorDropdown({
  options,
  value,
  onChange,
  accentColor = "#FFCC00",
  isDark = false
}: BundleSelectorDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const selectedOption = options.find((opt) => opt.value === value) || options[0];

  const getOptionMeta = (val: string, label: string) => {
    const l = label.toLowerCase();
    if (val === "affordable") {
      return {
        icon: Tag,
        bg: "bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-400",
        desc: "Cheaper bulk packages. Delivered in 1-5 mins.",
        colorClass: "text-emerald-500"
      };
    }
    if (val === "mashup") {
      return {
        icon: Sparkles,
        bg: "bg-amber-500/10 text-amber-500 dark:bg-amber-500/20 dark:text-amber-400",
        desc: "Popular hybrid voice & data packages.",
        colorClass: "text-amber-500"
      };
    }

    let Icon = Zap;
    let bg = "bg-blue-500/10 text-blue-500 dark:bg-blue-500/20 dark:text-blue-400";
    let desc = "Official retail bundle. Delivered instantly.";
    let colorClass = "text-blue-500";

    if (l.includes("midnight") || l.includes("night")) {
      Icon = Clock;
      bg = "bg-indigo-500/10 text-indigo-500 dark:bg-indigo-500/20 dark:text-indigo-400";
      desc = "Midnight usage offers. Super high value.";
      colorClass = "text-indigo-500";
    } else if (l.includes("social")) {
      Icon = MessageSquare;
      bg = "bg-pink-500/10 text-pink-500 dark:bg-pink-500/20 dark:text-pink-400";
      desc = "Dedicated social media data.";
      colorClass = "text-pink-500";
    } else if (l.includes("video") || l.includes("youtube")) {
      Icon = Video;
      bg = "bg-rose-500/10 text-rose-500 dark:bg-rose-500/20 dark:text-rose-400";
      desc = "Dedicated streaming bundles.";
      colorClass = "text-rose-500";
    } else if (l.includes("idd")) {
      Icon = Globe;
      bg = "bg-teal-500/10 text-teal-500 dark:bg-teal-500/20 dark:text-teal-400";
      desc = "International calling rates.";
      colorClass = "text-teal-500";
    } else if (l.includes("voice") || l.includes("fuse")) {
      Icon = Smartphone;
      bg = "bg-cyan-500/10 text-cyan-500 dark:bg-cyan-500/20 dark:text-cyan-400";
      desc = "Combined voice and data package.";
      colorClass = "text-cyan-500";
    }

    return { icon: Icon, bg, desc, colorClass };
  };

  const selectedMeta = getOptionMeta(selectedOption.value, selectedOption.label);
  const SelectedIcon = selectedMeta.icon;

  return (
    <div ref={containerRef} className="relative w-full max-w-sm z-50">
      <label className={`block text-[11px] font-black uppercase tracking-wider mb-2 ${isDark ? "text-white/40" : "text-muted-foreground"}`}>
        Select Bundle Type / Category
      </label>
      
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between rounded-2xl px-4 py-3.5 border transition-all text-left shadow-sm ${
          isDark 
            ? "bg-[#111116] border-white/10 text-white hover:bg-white/5 hover:border-white/20" 
            : "bg-card border-border text-foreground hover:bg-muted/10"
        }`}
        style={isOpen ? { borderColor: accentColor } : {}}
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${selectedMeta.bg}`}>
            <SelectedIcon className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs font-bold leading-none">{selectedOption.label}</p>
            <p className="text-[10px] font-medium leading-none mt-1 opacity-60">
              {selectedMeta.desc}
            </p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 transition-transform duration-200 shrink-0 opacity-60 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div 
          className={`absolute top-full left-0 right-0 mt-2 rounded-2xl border shadow-2xl p-2.5 space-y-1 animate-in fade-in zoom-in-95 duration-150 z-50 ${
            isDark 
              ? "bg-[#16161c] border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.6)]" 
              : "bg-card border-border shadow-[0_20px_50px_rgba(0,0,0,0.1)]"
          }`}
        >
          {options.map((opt) => {
            const isItemActive = opt.value === value;
            const meta = getOptionMeta(opt.value, opt.label);
            const OptIcon = meta.icon;

            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-start gap-3 p-2.5 rounded-xl text-left transition-all ${
                  isItemActive
                    ? isDark 
                      ? "bg-white/5 text-white" 
                      : "bg-primary/5 text-primary"
                    : isDark 
                      ? "hover:bg-white/5 text-white/80 hover:text-white" 
                      : "hover:bg-muted/50 text-foreground/80 hover:text-foreground"
                }`}
                style={isItemActive ? { borderLeft: `3px solid ${accentColor}` } : {}}
              >
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${meta.bg}`}>
                  <OptIcon className="w-4 h-4" />
                </div>
                <div className="leading-tight min-w-0">
                  <p className="text-xs font-bold">{opt.label}</p>
                  <p className="text-[10px] font-medium mt-0.5 opacity-65">
                    {meta.desc}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
