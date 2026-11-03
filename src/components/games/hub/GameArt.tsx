import { memo } from "react";
import type { GameType } from "./gameCatalog";

/**
 * Lightweight, image-free cover art for each game. Pure CSS/SVG so it costs
 * nothing to download and stays crisp on any screen. No backdrop-blur or
 * heavy filters: those stutter on low-end Android GPUs.
 */

const seed = (light = "#f8fafc") =>
  `radial-gradient(circle at 35% 30%, ${light} 0%, #a8b3c4 55%, #3b4658 100%)`;

function OwareArt() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4" style={{ background: "radial-gradient(120% 90% at 50% 0%, #8a4a1f 0%, #3a1f0c 55%, #160c05 100%)" }}>
      <div
        className="w-full max-w-[340px] rounded-[22px] p-2.5 flex items-center gap-2"
        style={{
          background: "linear-gradient(180deg, #a5642f 0%, #7a4219 60%, #4b270c 100%)",
          boxShadow: "inset 0 2px 0 rgba(255,255,255,0.18), 0 14px 30px rgba(0,0,0,0.55)",
        }}
      >
        <Store count={7} />
        <div className="flex-1 grid grid-cols-6 gap-1.5">
          {[3, 4, 2, 5, 4, 3, 4, 2, 4, 3, 5, 4].map((n, i) => (
            <div
              key={i}
              className="aspect-square rounded-full flex flex-wrap items-center justify-center content-center gap-[2px] p-[3px]"
              style={{ background: "radial-gradient(circle at 50% 35%, #2a1407 0%, #4a260d 100%)", boxShadow: "inset 0 4px 8px rgba(0,0,0,0.8)" }}
            >
              {Array.from({ length: n }).map((_, s) => (
                <span key={s} className="w-[22%] aspect-square rounded-full" style={{ background: seed() }} />
              ))}
            </div>
          ))}
        </div>
        <Store count={9} />
      </div>
    </div>
  );
}

function Store({ count }: { count: number }) {
  return (
    <div
      className="w-[11%] self-stretch rounded-full flex flex-wrap items-center justify-center content-center gap-[2px] p-1"
      style={{ background: "linear-gradient(180deg, #2a1407, #46240c)", boxShadow: "inset 0 5px 10px rgba(0,0,0,0.85)" }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className="w-[42%] aspect-square rounded-full" style={{ background: seed() }} />
      ))}
    </div>
  );
}

function PoolArt() {
  const balls = [
    { n: 1, c: "#facc15" }, { n: 9, c: "#facc15", stripe: true }, { n: 3, c: "#ef4444" },
    { n: 8, c: "#0f172a" }, { n: 11, c: "#ef4444", stripe: true }, { n: 6, c: "#16a34a" },
  ];
  return (
    <div className="absolute inset-0 p-4 flex items-center justify-center" style={{ background: "radial-gradient(120% 90% at 50% 0%, #0c4a6e 0%, #082f49 60%, #04121f 100%)" }}>
      <div className="relative w-full max-w-[340px] aspect-[2/1] rounded-2xl p-2.5" style={{ background: "linear-gradient(180deg, #6b2f10, #3b1606)", boxShadow: "0 14px 30px rgba(0,0,0,0.55)" }}>
        <div className="relative w-full h-full rounded-xl overflow-hidden" style={{ background: "radial-gradient(ellipse at center, #1f8fd1 0%, #1468a3 70%, #0d4f80 100%)" }}>
          {["top-0 left-0", "top-0 left-1/2 -translate-x-1/2", "top-0 right-0", "bottom-0 left-0", "bottom-0 left-1/2 -translate-x-1/2", "bottom-0 right-0"].map((p) => (
            <span key={p} className={`absolute ${p} w-3 h-3 rounded-full bg-black/80`} />
          ))}
          <span className="absolute left-[18%] top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-md" />
          <span className="absolute left-[24%] right-[40%] top-1/2 h-px border-t border-dashed border-white/70" />
          <div className="absolute right-[14%] top-1/2 -translate-y-1/2 grid grid-cols-3 gap-[2px]">
            {balls.map((b) => (
              <span
                key={b.n}
                className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-black shadow"
                style={{
                  background: b.stripe ? `linear-gradient(180deg, #fff 0 28%, ${b.c} 28% 72%, #fff 72%)` : b.c,
                  color: b.c === "#facc15" ? "#000" : "#fff",
                }}
              >
                {b.n}
              </span>
            ))}
          </div>
          <span className="absolute left-[-30%] top-[62%] w-[46%] h-1.5 rounded-full rotate-[-8deg]" style={{ background: "linear-gradient(90deg, #3b1606, #d6a35c 80%, #f5f5f4)" }} />
        </div>
      </div>
    </div>
  );
}

function SlashArt() {
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: "radial-gradient(120% 90% at 50% 0%, #9a3412 0%, #4a1d0a 60%, #1c0a03 100%)" }}>
      <div className="relative flex items-end gap-2">
        <span className="text-5xl sm:text-6xl -rotate-12 drop-shadow-[0_10px_14px_rgba(0,0,0,0.55)]">🍉</span>
        <span className="text-4xl sm:text-5xl rotate-6 -translate-y-4 drop-shadow-[0_10px_14px_rgba(0,0,0,0.55)]">🍍</span>
        <span className="text-3xl sm:text-4xl rotate-12 drop-shadow-[0_10px_14px_rgba(0,0,0,0.55)]">🥭</span>
        <span className="absolute -inset-x-6 top-1/2 h-[3px] -rotate-[14deg] rounded-full" style={{ background: "linear-gradient(90deg, transparent, #fff 40%, #fde68a 70%, transparent)", boxShadow: "0 0 14px #fff" }} />
      </div>
    </div>
  );
}

function LudoArt() {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-4" style={{ background: "radial-gradient(120% 90% at 50% 0%, #4c1d95 0%, #1e1b4b 60%, #0b0a1f 100%)" }}>
      <div className="relative w-[96px] h-[96px] rounded-2xl bg-white p-1 grid grid-cols-2 grid-rows-2 gap-1 shadow-[0_14px_30px_rgba(0,0,0,0.55)]">
        {["#dc2626", "#16a34a", "#0284c7", "#f59e0b"].map((c) => (
          <div key={c} className="rounded-lg flex items-center justify-center" style={{ background: c }}>
            <span className="w-4 h-4 rounded-full bg-white/90 shadow-inner" />
          </div>
        ))}
        <span className="absolute inset-0 m-auto w-7 h-7 rotate-45 bg-white rounded-sm" />
      </div>
      <Die />
    </div>
  );
}

function Die() {
  const pips = [0, 2, 4, 6, 8];
  return (
    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-white to-slate-200 grid grid-cols-3 grid-rows-3 p-1.5 gap-0.5 rotate-12 shadow-[0_10px_20px_rgba(0,0,0,0.5)]">
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className={`rounded-full ${pips.includes(i) ? "bg-slate-900" : ""}`} />
      ))}
    </div>
  );
}

function DameArt() {
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: "radial-gradient(120% 90% at 50% 0%, #115e59 0%, #0b3b38 60%, #04181a 100%)" }}>
      <div className="relative w-[120px] h-[120px] grid grid-cols-4 grid-rows-4 rounded-xl overflow-hidden rotate-[-8deg] shadow-[0_14px_30px_rgba(0,0,0,0.55)]">
        {Array.from({ length: 16 }).map((_, i) => {
          const row = Math.floor(i / 4);
          const dark = (row + (i % 4)) % 2 === 1;
          const hasPiece = [1, 3, 6, 9, 12, 14].includes(i);
          const isGold = i < 8;
          return (
            <div key={i} className="flex items-center justify-center" style={{ background: dark ? "#3f2a14" : "#e9d6b0" }}>
              {hasPiece && dark && (
                <span
                  className="w-[70%] aspect-square rounded-full border-2 flex items-center justify-center text-[10px]"
                  style={{
                    background: isGold ? "radial-gradient(circle at 35% 30%, #fde68a, #b45309)" : "radial-gradient(circle at 35% 30%, #fda4af, #9f1239)",
                    borderColor: "rgba(255,255,255,0.55)",
                  }}
                >
                  {i === 6 ? "♛" : ""}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CandyArt() {
  const sweets = [
    "linear-gradient(135deg, #fecdd3, #e11d48 60%, #881337)",
    "linear-gradient(135deg, #fef08a, #eab308 60%, #854d0e)",
    "linear-gradient(135deg, #bbf7d0, #16a34a 60%, #14532d)",
    "linear-gradient(135deg, #e9d5ff, #9333ea 60%, #4c1d95)",
    "linear-gradient(135deg, #bae6fd, #0284c7 60%, #0c4a6e)",
    "linear-gradient(135deg, #fed7aa, #ea580c 60%, #7c2d12)",
  ];
  const grid = [0, 1, 2, 3, 4, 1, 2, 2, 2, 5, 3, 4, 0, 5, 1, 3];
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: "radial-gradient(120% 90% at 50% 0%, #831843 0%, #3b0a24 60%, #16040d 100%)" }}>
      <div className="grid grid-cols-4 gap-1.5 p-2 rounded-2xl rotate-[6deg]" style={{ background: "linear-gradient(180deg, #7a4219, #4b270c)", boxShadow: "0 14px 30px rgba(0,0,0,0.55)" }}>
        {grid.map((s, i) => (
          <span
            key={i}
            className={`w-7 h-7 ${s % 2 ? "rounded-full" : "rounded-lg"} ${i >= 6 && i <= 8 ? "ring-2 ring-white/90" : ""}`}
            style={{ background: sweets[s], boxShadow: "inset 0 2px 0 rgba(255,255,255,0.45), 0 2px 4px rgba(0,0,0,0.4)" }}
          />
        ))}
      </div>
    </div>
  );
}

function BuggyArt() {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: "linear-gradient(180deg, #fb923c 0%, #f97316 22%, #0e7490 46%, #164e63 60%, #0b1f2a 100%)" }}>
      <span className="absolute left-[12%] top-[14%] w-10 h-10 rounded-full bg-amber-200/90" />
      {/* road in perspective */}
      <div className="absolute inset-x-0 bottom-0 h-[58%]" style={{ clipPath: "polygon(38% 0, 62% 0, 100% 100%, 0 100%)", background: "linear-gradient(180deg, #334155, #0f172a)" }} />
      <div className="absolute inset-x-0 bottom-0 h-[58%]" style={{ clipPath: "polygon(49.4% 0, 50.6% 0, 52% 100%, 48% 100%)", background: "repeating-linear-gradient(180deg, #facc15 0 10px, transparent 10px 22px)" }} />
      {/* kente boost pad */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-[30%] w-16 h-2 rounded" style={{ background: "repeating-linear-gradient(90deg, #ef4444 0 6px, #facc15 6px 12px, #22c55e 12px 18px)" }} />
      <span className="absolute left-[6%] bottom-[18%] text-3xl">🌴</span>
      <span className="absolute right-[6%] bottom-[24%] text-2xl">🌴</span>
      <RoadsterRear className="absolute left-1/2 -translate-x-1/2 bottom-[5%] w-[72px] drop-shadow-[0_8px_10px_rgba(0,0,0,0.6)]" />
    </div>
  );
}

/** Rear view of the Volt Roadster (the racer's electric hypercar). */
function RoadsterRear({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 62" className={className} aria-hidden>
      <defs>
        <linearGradient id="vr-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.16" stopColor="#c8102e" />
          <stop offset="0.75" stopColor="#9b0d1e" />
          <stop offset="1" stopColor="#2a0509" />
        </linearGradient>
        <linearGradient id="vr-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#334155" />
          <stop offset="1" stopColor="#020617" />
        </linearGradient>
      </defs>
      <rect x="4" y="38" width="16" height="22" rx="4" fill="#0b0b0e" />
      <rect x="80" y="38" width="16" height="22" rx="4" fill="#0b0b0e" />
      <path d="M23 23 C26 9 36 3 50 3 C64 3 74 9 77 23 Z" fill="url(#vr-glass)" />
      <path d="M33 21 L42 6 L47 6 L38 21 Z" fill="rgba(186,230,253,0.25)" />
      <path d="M0 52 L0 38 C0 28 6 24 18 23 L82 23 C94 24 100 28 100 38 L100 52 Q50 58 0 52 Z" fill="url(#vr-body)" />
      <rect x="6" y="31" width="88" height="3.5" rx="1.75" fill="#ff2d4a" />
      <rect x="41" y="38" width="18" height="6" rx="1" fill="#f8fafc" />
      <path d="M16 47 L84 47 L78 55 L22 55 Z" fill="#0a0a0c" />
    </svg>
  );
}

const ART: Record<GameType, () => JSX.Element> = {
  oware: OwareArt,
  pool: PoolArt,
  slash: SlashArt,
  ludo: LudoArt,
  dame: DameArt,
  candy: CandyArt,
  buggy: BuggyArt,
};

export const GameArt = memo(function GameArt({ game }: { game: GameType }) {
  const Art = ART[game] ?? OwareArt;
  return <Art />;
});
