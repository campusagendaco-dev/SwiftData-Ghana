import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Check, X, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { generateLocalAvatarDataUri, getRealEmojiForSeed } from "@/lib/avatar";

interface AvatarPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
  currentAvatarUrl?: string;
}

const STYLES = [
  { id: "avataaars",        name: "Classic",       bg: "#eef2ff" },
  { id: "fun-emoji",        name: "Emoji",         bg: "#fefce8" },
  { id: "big-smile",        name: "Happy",         bg: "#fefce8" },
  { id: "adventurer",       name: "Adventure",     bg: "#f0fdf4" },
  { id: "bottts",           name: "Robots",        bg: "#ecfdf5" },
  { id: "thumbs",           name: "Thumbs",        bg: "#ecfdf5" },
  { id: "avataaars-neutral",name: "Neutral",       bg: "#f0fdf4" },
  { id: "bottts-neutral",   name: "Bots 2",        bg: "#f0f9ff" },
  { id: "pixel-art",        name: "Pixel Art",     bg: "#fff7ed" },
  { id: "pixel-art-neutral",name: "Pixel Neutral", bg: "#fefce8" },
  { id: "lorelei",          name: "Modern",        bg: "#fdf4ff" },
  { id: "lorelei-neutral",  name: "Modern 2",      bg: "#fff1f2" },
  { id: "notionists",       name: "Minimal",       bg: "#f0f9ff" },
  { id: "notionists-neutral",name: "Minimal 2",    bg: "#fafafa" },
  { id: "adventurer-neutral",name: "Adventurer 2", bg: "#f5f3ff" },
  { id: "open-peeps",       name: "Peeps",         bg: "#fff1f2" },
  { id: "micah",            name: "Illustrative",  bg: "#f5f3ff" },
  { id: "croodles",         name: "Doodles",       bg: "#eff6ff" },
  { id: "croodles-neutral", name: "Doodles 2",     bg: "#fdf4ff" },
  { id: "rings",            name: "Rings",         bg: "#f0f9ff" },
  { id: "shapes",           name: "Shapes",        bg: "#fff7ed" },
  { id: "identicon",        name: "Identity",      bg: "#eef2ff" },
  { id: "miniavs",          name: "Mini",          bg: "#fdf4ff" },
  { id: "personas",         name: "Personas",      bg: "#fff1f2" },
  { id: "glass",            name: "Glass",         bg: "#f0fdf4" },
];

const ALL_SEEDS = [
  "swift","ghana","data","ace","nova","bolt","zara","finn",
  "luna","koda","rex","mia","jade","sage","leo","ivy",
  "cole","tara","alex","sam","pat","riley","quinn","drew",
  "kai","eden","cruz","skye","juno","wren","noor","blaze",
  "dax","arlo","poet","fern","max","beau","cleo","rome",
];

export const AvatarPicker = ({ isOpen, onClose, onSelect }: AvatarPickerProps) => {
  const [style, setStyle] = useState(STYLES[0]);
  const [seed, setSeed]   = useState(ALL_SEEDS[0]);
  const [saving, setSaving] = useState(false);

  const previewUrl = generateLocalAvatarDataUri(seed, style.id);
  const previewSpec = getRealEmojiForSeed(seed, style.id);

  // lock body scroll while open
  useEffect(() => {
    if (isOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  const shuffle = () => {
    const random = ALL_SEEDS[Math.floor(Math.random() * ALL_SEEDS.length)];
    setSeed(random);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSelect(previewUrl);
      onClose();
    } catch {
      toast.error("Failed to save avatar");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200]"
            style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            key="sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed bottom-0 left-0 right-0 z-[201] flex flex-col overflow-hidden"
            style={{
              background: "#0f0f17",
              borderRadius: "24px 24px 0 0",
              maxHeight: "88dvh",
              boxShadow: "0 -20px 60px rgba(0,0,0,0.6)",
            }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-9 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
            </div>

            {/* Header row */}
            <div className="flex items-center gap-3 px-4 pb-3 pt-1 shrink-0">
              {/* Live preview */}
              <div
                className="w-12 h-12 rounded-2xl shrink-0 overflow-hidden flex items-center justify-center p-1"
                style={{ background: style.bg }}
              >
                <div
                  className="w-full h-full rounded-full relative overflow-hidden flex items-center justify-center shadow-inner"
                  style={{
                    background: `linear-gradient(135deg, ${previewSpec.c1} 0%, ${previewSpec.c2} 100%)`,
                  }}
                >
                  <span
                    role="img"
                    aria-label={seed}
                    className="relative z-10 text-2xl leading-none select-none"
                    style={{
                      fontFamily:
                        "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif",
                      filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.38))",
                    }}
                  >
                    {previewSpec.emoji}
                  </span>
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-white">Choose Avatar</p>
                <p className="text-[11px] text-white/40">Pick a style and real emoji variation below</p>
              </div>

              <button
                type="button"
                onClick={shuffle}
                aria-label="Shuffle"
                className="w-9 h-9 rounded-xl flex items-center justify-center border border-amber-400/30 bg-amber-400/10 text-amber-400 hover:bg-amber-400/20 transition-all shrink-0"
              >
                <Shuffle className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="w-9 h-9 rounded-xl flex items-center justify-center border border-white/10 bg-white/6 text-white/50 hover:text-white hover:bg-white/10 transition-all shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Divider */}
            <div className="shrink-0 mx-4" style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />

            {/* Style pills */}
            <div className="shrink-0 pt-3 pb-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-white/30 mb-2 px-4">Style</p>
              <div className="relative">
                <div
                  className="flex gap-2 px-4 overflow-x-auto"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}
                >
                  {STYLES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStyle(s)}
                      className="shrink-0 flex items-center gap-1.5 px-3 h-8 rounded-full text-[11px] font-bold transition-all whitespace-nowrap border"
                      style={
                        style.id === s.id
                          ? { background: "#fbbf24", color: "#000", borderColor: "#fbbf24" }
                          : { background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.75)", borderColor: "rgba(255,255,255,0.12)" }
                      }
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: s.bg }}
                      />
                      {s.name}
                    </button>
                  ))}
                </div>
                {/* Fade hint — scroll right */}
                <div
                  className="absolute top-0 right-0 bottom-0 w-8 pointer-events-none"
                  style={{ background: "linear-gradient(to right, transparent, #0f0f17)" }}
                />
              </div>
            </div>

            {/* Divider */}
            <div className="shrink-0 mx-4" style={{ height: 1, background: "rgba(255,255,255,0.07)" }} />

            {/* Grid — scrollable */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-white/30 mb-2">Variation</p>
              <div className="grid grid-cols-4 gap-2.5">
                {ALL_SEEDS.map((s) => {
                  const spec = getRealEmojiForSeed(s, style.id);
                  const active = seed === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSeed(s)}
                      className="relative rounded-2xl overflow-hidden transition-all duration-150 active:scale-95 flex items-center justify-center p-2"
                      style={{
                        aspectRatio: "1",
                        background: style.bg,
                        border: active ? "2.5px solid #fbbf24" : "2.5px solid transparent",
                        boxShadow: active ? "0 0 0 3px rgba(251,191,36,0.25)" : "none",
                        transform: active ? "scale(1.06)" : "scale(1)",
                      }}
                    >
                      <div
                        className="w-full h-full rounded-full relative overflow-hidden flex items-center justify-center shadow-md"
                        style={{
                          background: `linear-gradient(135deg, ${spec.c1} 0%, ${spec.c2} 100%)`,
                        }}
                      >
                        <svg
                          viewBox="0 0 100 100"
                          className="w-full h-full block absolute inset-0 pointer-events-none"
                          aria-hidden="true"
                        >
                          <path
                            d="M 52 0 A 50 50 0 0 1 100 52 C 82 54 54 32 52 0 Z"
                            fill={spec.accent}
                            opacity="0.65"
                          />
                          <circle
                            cx="50"
                            cy="50"
                            r="40"
                            fill="none"
                            stroke={spec.accent}
                            strokeWidth="2.4"
                            opacity="0.45"
                          />
                        </svg>
                        <span
                          role="img"
                          aria-label={s}
                          className="relative z-10 text-3xl sm:text-4xl leading-none select-none"
                          style={{
                            fontFamily:
                              "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif",
                            filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.4))",
                          }}
                        >
                          {spec.emoji}
                        </span>
                      </div>
                      {active && (
                        <div
                          className="absolute top-1 right-1 z-20 w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ background: "#fbbf24" }}
                        >
                          <Check className="w-2.5 h-2.5 text-black" strokeWidth={3} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div
              className="shrink-0 flex gap-3 px-4 pt-3 pb-6"
              style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
            >
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-12 rounded-2xl font-bold text-sm transition-all"
                style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.6)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-[2] h-12 rounded-2xl font-black text-sm text-black transition-all disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)" }}
              >
                {saving ? "Saving…" : "Save Avatar"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
};
