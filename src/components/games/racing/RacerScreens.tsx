import type { ReactNode } from "react";
import {
  ArrowLeft,
  Flame,
  Gauge,
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
  Shield,
  Trophy,
  Volume2,
  VolumeX,
  Wrench,
  Zap,
} from "lucide-react";

/* Presentation-only screens for the racer. All game state stays in BeachBuggyTrack. */

export interface RacerVehicle {
  id: string;
  name: string;
  tagline: string;
  color: string;
  accent: string;
  speedBonus: number;
  steerBonus: number;
  armorBonus: number;
}

export interface RacerTrack {
  id: string;
  name: string;
  subtitle: string;
  badge: string;
  skyTop: string;
  skyMid: string;
  skyBot: string;
  roadDark: string;
}

export type SteeringMode = "wheel" | "tilt" | "arrows";
type UpgradeKey = "eng" | "nit" | "arm";

const cedi = (n: number) => `GH₵ ${Math.round(n).toLocaleString()}`;

/* ─────────────────────────────── Car art ─────────────────────────────── */

/** Rear view of each car, matching how it's drawn on the track. */
export function CarPreview({ vehicleId, color, className = "" }: { vehicleId: string; color: string; className?: string }) {
  const id = `cp-${vehicleId}`;
  const body = (
    <defs>
      <linearGradient id={`${id}-b`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.16" stopColor={color} />
        <stop offset="0.8" stopColor={color} />
        <stop offset="1" stopColor="#0b0b10" />
      </linearGradient>
      <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#334155" />
        <stop offset="1" stopColor="#020617" />
      </linearGradient>
    </defs>
  );
  const shadow = <ellipse cx="50" cy="61" rx="48" ry="4" fill="rgba(0,0,0,0.45)" />;

  if (vehicleId === "roadster") {
    return (
      <svg viewBox="0 0 100 64" className={className} aria-hidden>
        {body}
        {shadow}
        <rect x="4" y="38" width="16" height="22" rx="4" fill="#0b0b0e" />
        <rect x="80" y="38" width="16" height="22" rx="4" fill="#0b0b0e" />
        <path d="M23 23 C26 9 36 3 50 3 C64 3 74 9 77 23 Z" fill={`url(#${id}-g)`} />
        <path d="M33 21 L42 6 L47 6 L38 21 Z" fill="rgba(186,230,253,0.25)" />
        <path d="M0 52 L0 38 C0 28 6 24 18 23 L82 23 C94 24 100 28 100 38 L100 52 Q50 58 0 52 Z" fill={`url(#${id}-b)`} />
        <rect x="6" y="31" width="88" height="3.5" rx="1.75" fill="#ff2d4a" />
        <rect x="41" y="38" width="18" height="6" rx="1" fill="#f8fafc" />
        <path d="M16 47 L84 47 L78 55 L22 55 Z" fill="#0a0a0c" />
      </svg>
    );
  }
  if (vehicleId === "trotro") {
    return (
      <svg viewBox="0 0 100 64" className={className} aria-hidden>
        {body}
        {shadow}
        <rect x="8" y="46" width="16" height="15" rx="3" fill="#0b0b0e" />
        <rect x="76" y="46" width="16" height="15" rx="3" fill="#0b0b0e" />
        <rect x="10" y="4" width="80" height="50" rx="6" fill={`url(#${id}-b)`} />
        <rect x="16" y="10" width="68" height="20" rx="3" fill={`url(#${id}-g)`} />
        <rect x="14" y="38" width="12" height="4" rx="1" fill="#ff2d4a" />
        <rect x="74" y="38" width="12" height="4" rx="1" fill="#ff2d4a" />
        <rect x="41" y="40" width="18" height="6" rx="1" fill="#f8fafc" />
      </svg>
    );
  }
  if (vehicleId === "pragya") {
    return (
      <svg viewBox="0 0 100 64" className={className} aria-hidden>
        {body}
        {shadow}
        <rect x="14" y="44" width="14" height="17" rx="4" fill="#0b0b0e" />
        <rect x="72" y="44" width="14" height="17" rx="4" fill="#0b0b0e" />
        <path d="M22 18 Q50 2 78 18 L80 22 L20 22 Z" fill={color} />
        <line x1="24" y1="22" x2="26" y2="40" stroke="#cbd5e1" strokeWidth="2.5" />
        <line x1="76" y1="22" x2="74" y2="40" stroke="#cbd5e1" strokeWidth="2.5" />
        <rect x="18" y="36" width="64" height="16" rx="5" fill={`url(#${id}-b)`} />
        <rect x="22" y="40" width="10" height="3.5" rx="1" fill="#ff2d4a" />
        <rect x="68" y="40" width="10" height="3.5" rx="1" fill="#ff2d4a" />
      </svg>
    );
  }
  if (vehicleId === "kantanka") {
    return (
      <svg viewBox="0 0 100 64" className={className} aria-hidden>
        {body}
        {shadow}
        <rect x="4" y="40" width="18" height="21" rx="5" fill="#0b0b0e" />
        <rect x="78" y="40" width="18" height="21" rx="5" fill="#0b0b0e" />
        <rect x="16" y="4" width="68" height="3" rx="1.5" fill="#1f2937" />
        <path d="M14 26 L20 8 L80 8 L86 26 Z" fill={`url(#${id}-g)`} />
        <rect x="6" y="24" width="88" height="28" rx="6" fill={`url(#${id}-b)`} />
        <rect x="10" y="30" width="14" height="5" rx="1.5" fill="#ff2d4a" />
        <rect x="76" y="30" width="14" height="5" rx="1.5" fill="#ff2d4a" />
        <rect x="41" y="38" width="18" height="6" rx="1" fill="#f8fafc" />
      </svg>
    );
  }
  // Sand buggy: open roll cage, big slicks, rear wing.
  return (
    <svg viewBox="0 0 100 64" className={className} aria-hidden>
      {body}
      {shadow}
      <rect x="2" y="34" width="20" height="27" rx="5" fill="#0b0b0e" />
      <rect x="78" y="34" width="20" height="27" rx="5" fill="#0b0b0e" />
      <rect x="14" y="3" width="72" height="5" rx="2" fill="#0f172a" />
      <path d="M22 40 L30 10 L70 10 L78 40" fill="none" stroke="#e2e8f0" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="50" cy="20" r="7" fill="#f8fafc" />
      <rect x="16" y="34" width="68" height="18" rx="6" fill={`url(#${id}-b)`} />
      <rect x="20" y="38" width="12" height="4" rx="1" fill="#ff2d4a" />
      <rect x="68" y="38" width="12" height="4" rx="1" fill="#ff2d4a" />
    </svg>
  );
}

/* ─────────────────────────────── Shared bits ─────────────────────────────── */

function Stat({ label, value }: { label: string; value: number }) {
  // Bonuses sit around 0.94–1.22; map to a 0–100 bar.
  const pct = Math.round(Math.min(100, Math.max(8, ((value - 0.9) / 0.32) * 100)));
  return (
    <div className="flex items-center gap-2">
      <span className="w-[62px] text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-orange-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex p-0.5 rounded-xl bg-white/[0.06] border border-white/10">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`h-8 px-3 rounded-[10px] text-[12px] font-bold transition-colors ${value === o.id ? "bg-white text-slate-950" : "text-slate-300 hover:text-white"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="h-9 w-9 rounded-xl bg-black/45 border border-white/15 text-white flex items-center justify-center hover:bg-black/60 active:scale-95 transition"
    >
      {children}
    </button>
  );
}

/* ─────────────────────────────── Start menu ─────────────────────────────── */

export function RacerMenu(props: {
  title: string;
  tracks: RacerTrack[];
  vehicles: RacerVehicle[];
  trackId: string;
  vehicleId: string;
  bank: number;
  best: number;
  steeringMode: SteeringMode;
  autoGas: boolean;
  muted: boolean;
  isFullscreen: boolean;
  onSelectTrack: (id: string) => void;
  onSelectVehicle: (id: string) => void;
  onSteeringMode: (m: SteeringMode) => void;
  onToggleAutoGas: () => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onStart: () => void;
  onGarage: () => void;
  onBack?: () => void;
}) {
  const track = props.tracks.find((t) => t.id === props.trackId) || props.tracks[0];
  const vehicle = props.vehicles.find((v) => v.id === props.vehicleId) || props.vehicles[0];
  const vIndex = props.vehicles.findIndex((v) => v.id === vehicle.id);
  const cycle = (dir: number) => {
    const next = props.vehicles[(vIndex + dir + props.vehicles.length) % props.vehicles.length];
    props.onSelectVehicle(next.id);
  };

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto" style={{ background: `radial-gradient(120% 90% at 80% 0%, ${track.skyBot}55 0%, transparent 55%), linear-gradient(180deg, #070b14 0%, #0a1020 100%)` }}>
      <div className="min-h-full grid grid-cols-[1.15fr_1fr] gap-4 lg:gap-8 p-3 sm:p-5 lg:p-8">
        {/* Left: title, circuit, controls, actions */}
        <div className="flex flex-col gap-3 min-w-0">
          <div className="flex items-center gap-2">
            {props.onBack && (
              <IconButton label="Back to lobby" onClick={props.onBack}>
                <ArrowLeft className="w-4 h-4" />
              </IconButton>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">3 laps · 6 racers · 95s limit</p>
              <h1 className="text-2xl sm:text-3xl lg:text-5xl font-black tracking-tight text-white leading-none truncate">{props.title}</h1>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <IconButton label={props.muted ? "Unmute" : "Mute"} onClick={props.onToggleMute}>
                {props.muted ? <VolumeX className="w-4 h-4 text-rose-300" /> : <Volume2 className="w-4 h-4" />}
              </IconButton>
              <IconButton label="Fullscreen" onClick={props.onToggleFullscreen}>
                {props.isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </IconButton>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-1.5">Circuit</p>
            <div className="grid grid-cols-3 gap-2">
              {props.tracks.map((t) => {
                const active = t.id === track.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => props.onSelectTrack(t.id)}
                    className={`relative overflow-hidden rounded-2xl text-left border transition ${active ? "border-amber-300 ring-2 ring-amber-300/40" : "border-white/10 hover:border-white/25"}`}
                  >
                    <div className="h-10 sm:h-14 relative" style={{ background: `linear-gradient(180deg, ${t.skyTop}, ${t.skyMid} 60%, ${t.skyBot})` }}>
                      <div className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: t.roadDark, clipPath: "polygon(42% 0, 58% 0, 100% 100%, 0 100%)" }} />
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1/2 w-[3px]" style={{ background: "repeating-linear-gradient(180deg, #facc15 0 4px, transparent 4px 8px)" }} />
                    </div>
                    <div className="px-2 py-1.5 bg-[#0d1424]">
                      <p className="text-[11px] sm:text-[12px] font-extrabold text-white truncate">{t.name.split("&")[0].trim()}</p>
                      <p className="text-[9px] sm:text-[10px] text-slate-400 truncate">{t.badge.replace(/[^\w\s]/g, "").trim() || t.subtitle}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Segmented<SteeringMode>
              value={props.steeringMode}
              onChange={props.onSteeringMode}
              options={[
                { id: "wheel", label: "Wheel" },
                { id: "tilt", label: "Tilt" },
                { id: "arrows", label: "Arrows" },
              ]}
            />
            <button
              type="button"
              onClick={props.onToggleAutoGas}
              className={`h-9 px-3 rounded-xl text-[12px] font-bold border transition-colors ${props.autoGas ? "bg-emerald-400/15 border-emerald-400/40 text-emerald-300" : "bg-white/[0.06] border-white/10 text-slate-300"}`}
            >
              Auto gas {props.autoGas ? "on" : "off"}
            </button>
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={props.onStart}
              className="inline-flex items-center gap-2 h-12 px-6 rounded-2xl bg-gradient-to-b from-amber-300 to-amber-500 text-slate-950 font-extrabold text-[15px] shadow-[0_10px_30px_-8px_rgba(245,158,11,0.8)] hover:from-amber-200 hover:to-amber-400 active:scale-[0.98] transition"
            >
              <Play className="w-4 h-4 fill-current" /> Start race
            </button>
            <button
              type="button"
              onClick={props.onGarage}
              className="inline-flex items-center gap-2 h-12 px-5 rounded-2xl border border-white/15 bg-white/[0.05] text-white font-bold text-[14px] hover:bg-white/[0.1] transition"
            >
              <Wrench className="w-4 h-4" /> Garage <span className="text-amber-300 tabular-nums">{cedi(props.bank)}</span>
            </button>
            {props.best > 0 && <span className="text-[11px] text-slate-400">Best: <strong className="text-white">{props.best.toFixed(1)}s</strong></span>}
          </div>
        </div>

        {/* Right: car showcase */}
        <div className="flex flex-col rounded-[24px] border border-white/10 bg-white/[0.03] overflow-hidden min-w-0">
          <div className="relative flex-1 min-h-[120px] flex items-end justify-center px-4 pt-3" style={{ background: `linear-gradient(180deg, ${track.skyTop} 0%, ${track.skyBot} 70%, #0b1220 100%)` }}>
            <div className="absolute inset-x-0 bottom-0 h-[38%]" style={{ background: "linear-gradient(180deg, #1f2937, #0b1220)" }} />
            <button type="button" aria-label="Previous car" onClick={() => cycle(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/45 text-white font-black">‹</button>
            <button type="button" aria-label="Next car" onClick={() => cycle(1)} className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/45 text-white font-black">›</button>
            <CarPreview vehicleId={vehicle.id} color={vehicle.color} className="relative w-[62%] max-w-[260px] drop-shadow-[0_14px_18px_rgba(0,0,0,0.6)] mb-2" />
          </div>
          <div className="p-3 sm:p-4 space-y-2 bg-[#0d1424]">
            <div>
              <p className="text-base sm:text-lg font-black text-white leading-tight">{vehicle.name}</p>
              <p className="text-[11px] text-slate-400 truncate">{vehicle.tagline}</p>
            </div>
            <div className="space-y-1">
              <Stat label="Speed" value={vehicle.speedBonus} />
              <Stat label="Handling" value={vehicle.steerBonus} />
              <Stat label="Armor" value={vehicle.armorBonus} />
            </div>
            <div className="flex items-center gap-1.5 pt-0.5">
              {props.vehicles.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-label={v.name}
                  title={v.name}
                  onClick={() => props.onSelectVehicle(v.id)}
                  className={`h-6 w-6 rounded-full border-2 transition ${v.id === vehicle.id ? "border-white scale-110" : "border-white/20 hover:border-white/50"}`}
                  style={{ background: v.color }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Garage ─────────────────────────────── */

export function RacerGarage(props: {
  bank: number;
  best: number;
  levels: Record<UpgradeKey, number>;
  meta: Record<UpgradeKey, { title: string; subtitle: string }>;
  cost: (level: number) => number;
  onBuy: (k: UpgradeKey) => void;
  onBack: () => void;
  onRace: () => void;
}) {
  const icons: Record<UpgradeKey, ReactNode> = {
    eng: <Gauge className="w-5 h-5" />,
    nit: <Zap className="w-5 h-5" />,
    arm: <Shield className="w-5 h-5" />,
  };
  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-[linear-gradient(180deg,#070b14,#0a1020)]">
      <div className="min-h-full flex flex-col gap-4 p-3 sm:p-5 lg:p-8">
        <div className="flex items-center gap-2">
          <IconButton label="Back" onClick={props.onBack}>
            <ArrowLeft className="w-4 h-4" />
          </IconButton>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-400">Suame Magazine</p>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white leading-none">Garage</h2>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Balance</p>
            <p className="text-lg font-black text-amber-300 tabular-nums">{cedi(props.bank)}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {(["eng", "nit", "arm"] as const).map((k) => {
            const lvl = props.levels[k];
            const c = props.cost(lvl);
            const maxed = lvl >= 5;
            return (
              <div key={k} className="rounded-[22px] border border-white/10 bg-white/[0.03] p-3 sm:p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-10 w-10 rounded-xl bg-amber-400/15 text-amber-300 flex items-center justify-center">{icons[k]}</span>
                  <p className="text-sm font-black text-white leading-tight">{props.meta[k].title}</p>
                </div>
                <div className="flex gap-1" aria-label={`Level ${lvl} of 5`}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span key={i} className={`h-1.5 flex-1 rounded-full ${i < lvl ? "bg-gradient-to-r from-amber-300 to-orange-500" : "bg-white/10"}`} />
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 line-clamp-2 flex-1">{props.meta[k].subtitle}</p>
                {maxed ? (
                  <span className="h-10 rounded-xl bg-emerald-400/15 text-emerald-300 text-sm font-black flex items-center justify-center">Maxed</span>
                ) : (
                  <button
                    type="button"
                    disabled={props.bank < c}
                    onClick={() => props.onBuy(k)}
                    className="h-10 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-35 disabled:cursor-not-allowed text-slate-950 text-sm font-black tabular-nums transition"
                  >
                    Upgrade · {cedi(c)}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500">{props.best > 0 ? `Best 3-lap time: ${props.best.toFixed(1)}s` : "Win races and collect coins to fund upgrades."}</p>
          <button
            type="button"
            onClick={props.onRace}
            className="inline-flex items-center gap-2 h-11 px-6 rounded-2xl bg-gradient-to-b from-amber-300 to-amber-500 text-slate-950 font-extrabold text-sm hover:from-amber-200 hover:to-amber-400 transition"
          >
            <Play className="w-4 h-4 fill-current" /> Race now
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Results ─────────────────────────────── */

export function RacerResults(props: {
  rank: number;
  raceTime: number;
  lap: number;
  wrecked: boolean;
  timedOut: boolean;
  newBest: boolean;
  prizeCoins: number;
  collectedCoins: number;
  trackName: string;
  onRematch: () => void;
  onGarage: () => void;
  onPlayAnother?: () => void;
  onMenu: () => void;
}) {
  const failed = props.wrecked || props.timedOut;
  const headline = props.timedOut ? "Out of time" : props.wrecked ? "Wrecked" : props.rank === 1 ? "Victory" : `Finished P${props.rank}`;
  const sub = props.timedOut
    ? `You reached lap ${props.lap} of 3 before the 95-second limit.`
    : props.wrecked
    ? `Your car broke down on lap ${props.lap}. Upgrade armor or avoid rocks and palms.`
    : `${props.trackName.split("&")[0].trim()} · 3 laps in ${props.raceTime.toFixed(2)}s`;
  const total = props.prizeCoins + props.collectedCoins;

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-[radial-gradient(120%_90%_at_50%_0%,rgba(245,158,11,0.18),transparent_60%),linear-gradient(180deg,#070b14,#0a1020)]">
      <div className="min-h-full grid grid-cols-[auto_1fr] items-center gap-5 sm:gap-8 p-4 sm:p-8 max-w-3xl mx-auto">
        <div className={`h-28 w-28 sm:h-36 sm:w-36 rounded-[28px] flex flex-col items-center justify-center border ${failed ? "border-rose-400/40 bg-rose-500/10" : props.rank === 1 ? "border-amber-300/60 bg-amber-400/15" : "border-white/15 bg-white/[0.04]"}`}>
          {failed ? <Flame className="w-9 h-9 text-rose-300" /> : props.rank === 1 ? <Trophy className="w-10 h-10 text-amber-300" /> : null}
          {!failed && <span className={`font-black tabular-nums leading-none ${props.rank === 1 ? "text-3xl text-amber-200 mt-1" : "text-5xl text-white"}`}>P{props.rank}</span>}
          {!failed && <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">of 6</span>}
        </div>
        <div className="space-y-3 min-w-0">
          <div>
            <h2 className="text-3xl sm:text-5xl font-black tracking-tight text-white leading-none">{headline}</h2>
            <p className="text-sm text-slate-400 mt-1.5">{sub}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 max-w-md">
            <div className="rounded-2xl bg-white/[0.04] border border-white/10 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Prize</p>
              <p className="text-base font-black text-white tabular-nums">{cedi(props.prizeCoins)}</p>
            </div>
            <div className="rounded-2xl bg-white/[0.04] border border-white/10 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Coins</p>
              <p className="text-base font-black text-white tabular-nums">{cedi(props.collectedCoins)}</p>
            </div>
            <div className="rounded-2xl bg-emerald-400/10 border border-emerald-400/30 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">Earned</p>
              <p className="text-base font-black text-emerald-300 tabular-nums">+{cedi(total)}</p>
            </div>
          </div>
          {props.newBest && <p className="text-sm font-bold text-amber-300">New best time: {props.raceTime.toFixed(2)}s</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={props.onRematch} className="inline-flex items-center gap-2 h-11 px-5 rounded-2xl bg-gradient-to-b from-amber-300 to-amber-500 text-slate-950 font-extrabold text-sm hover:from-amber-200 hover:to-amber-400 transition">
              <RotateCcw className="w-4 h-4" /> Race again
            </button>
            <button type="button" onClick={props.onGarage} className="inline-flex items-center gap-2 h-11 px-4 rounded-2xl border border-white/15 bg-white/[0.05] text-white font-bold text-sm hover:bg-white/[0.1] transition">
              <Wrench className="w-4 h-4" /> Garage
            </button>
            <button type="button" onClick={props.onMenu} className="inline-flex items-center h-11 px-4 rounded-2xl text-slate-300 hover:text-white font-bold text-sm transition">
              Change car or track
            </button>
            {props.onPlayAnother && (
              <button type="button" onClick={props.onPlayAnother} className="inline-flex items-center h-11 px-4 rounded-2xl text-slate-300 hover:text-white font-bold text-sm transition">
                Play another game
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── In-race rail ─────────────────────────────── */

/** Small icon column on the right edge during a race (keeps the HUD clear). */
export function RacerRail(props: {
  muted: boolean;
  isFullscreen: boolean;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onLeave?: () => void;
  voice?: ReactNode;
}) {
  return (
    <div className="absolute right-2 top-[26%] z-30 flex flex-col items-center gap-2 pointer-events-auto">
      {props.onLeave && (
        <IconButton label="Leave race" onClick={props.onLeave}>
          <ArrowLeft className="w-4 h-4" />
        </IconButton>
      )}
      <IconButton label={props.muted ? "Unmute" : "Mute"} onClick={props.onToggleMute}>
        {props.muted ? <VolumeX className="w-4 h-4 text-rose-300" /> : <Volume2 className="w-4 h-4" />}
      </IconButton>
      <IconButton label="Fullscreen" onClick={props.onToggleFullscreen}>
        {props.isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
      </IconButton>
      {props.voice}
    </div>
  );
}
