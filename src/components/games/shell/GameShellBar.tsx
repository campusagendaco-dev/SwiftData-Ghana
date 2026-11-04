import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Gamepad2,
  HelpCircle,
  Maximize2,
  MessageCircle,
  MoreHorizontal,
  Music,
  RotateCcw,
  Trophy,
  Vibrate,
  Volume2,
  VolumeX,
  XCircle,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  getAudioSettings,
  subscribeAudioSettings,
  ui as arenaUi,
  updateAudioSettings,
  type ArenaAudioSettings,
} from "@/lib/audio/arenaAudio";
import { getGameMeta } from "@/components/games/hub/gameCatalog";

export function useArenaAudioSettings(): ArenaAudioSettings {
  const [s, setS] = useState(getAudioSettings());
  useEffect(() => subscribeAudioSettings(setS), []);
  return s;
}

/* ───────────────────────────── Sound settings ───────────────────────────── */

export function SoundSettingsButton({ className = "" }: { className?: string }) {
  const s = useArenaAudioSettings();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Sound settings"
          className={`h-9 w-9 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors ${className}`}
        >
          {s.enabled ? <Volume2 className="w-[18px] h-[18px]" /> : <VolumeX className="w-[18px] h-[18px] text-rose-300" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 rounded-2xl bg-[#0d1424] border-white/10 text-white p-4 space-y-4 z-[200]"
        // Arena amber for switches and sliders inside this panel
        style={{ ["--primary" as any]: "38 92% 50%", ["--input" as any]: "222 25% 22%" }}
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Sound</p>
        <Row icon={<Volume2 className="w-4 h-4" />} label="Game sound">
          <Switch
            checked={s.enabled}
            onCheckedChange={(v) => {
              updateAudioSettings({ enabled: v });
              if (v) arenaUi.toggle(true);
            }}
          />
        </Row>
        <div className={s.enabled ? "" : "opacity-40 pointer-events-none"}>
          <p className="text-xs text-slate-400 mb-2">Effects volume</p>
          <Slider
            value={[Math.round(s.sfxVolume * 100)]}
            max={100}
            step={5}
            onValueChange={([v]) => updateAudioSettings({ sfxVolume: v / 100 })}
            onValueCommit={() => arenaUi.tap()}
          />
        </div>
        <Row icon={<Music className="w-4 h-4" />} label="Background music">
          <Switch checked={s.musicEnabled} disabled={!s.enabled} onCheckedChange={(v) => updateAudioSettings({ musicEnabled: v })} />
        </Row>
        {s.musicEnabled && s.enabled && (
          <div>
            <p className="text-xs text-slate-400 mb-2">Music volume</p>
            <Slider value={[Math.round(s.musicVolume * 100)]} max={100} step={5} onValueChange={([v]) => updateAudioSettings({ musicVolume: v / 100 })} />
          </div>
        )}
        <Row icon={<Vibrate className="w-4 h-4" />} label="Vibration">
          <Switch checked={s.vibration} onCheckedChange={(v) => updateAudioSettings({ vibration: v })} />
        </Row>
      </PopoverContent>
    </Popover>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
        <span className="text-slate-400">{icon}</span>
        {label}
      </span>
      {children}
    </div>
  );
}

/* ───────────────────────────── Shell bar ───────────────────────────── */

export interface GameShellBarProps {
  gameType: string;
  roomCode?: string | null;
  status: string;
  myName: string;
  opponentName: string;
  prizeLabel: string;
  pointsPopup?: number | null;
  copied?: boolean;
  voice?: ReactNode;
  canShowWinnerCard?: boolean;
  onLeave: () => void;
  onRematch: () => void;
  onPlayAnother: () => void;
  onOpenChat: () => void;
  onOpenHelp: () => void;
  onLockBoard: () => void;
  onShowWinnerCard?: () => void;
  onCopyInvite?: () => void;
  onCancelRoom?: () => void;
  rematchDisabled?: boolean;
}

export function GameShellBar(p: GameShellBarProps) {
  const meta = getGameMeta(p.gameType);
  const accent = meta?.accent || "#f59e0b";
  const live = p.status === "in_progress";
  return (
    <header
      className="relative z-[105] shrink-0 border-b border-white/[0.07] bg-[#0a0f1b]/95"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="h-12 sm:h-14 px-2 sm:px-4 flex items-center gap-2">
        <button
          type="button"
          onClick={p.onLeave}
          aria-label="Back to arena"
          className="h-9 w-9 shrink-0 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <span
          className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-lg"
          style={{ background: `${accent}22`, boxShadow: `inset 0 0 0 1px ${accent}55` }}
          aria-hidden
        >
          {meta?.emoji || "🎮"}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="text-[13px] sm:text-sm font-extrabold text-white truncate">{meta?.shortTitle || p.gameType}</p>
          <p className="text-[10px] sm:text-[11px] text-slate-500 flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-400" : p.status === "open" ? "bg-amber-400 animate-pulse" : "bg-slate-500"}`} />
            {live ? "Live" : p.status === "open" ? "Waiting" : "Finished"}
            {p.roomCode ? <span className="font-mono">#{p.roomCode}</span> : null}
          </p>
        </div>

        {/* versus */}
        <div className="hidden md:flex mx-auto items-center gap-2 text-[13px] font-bold min-w-0">
          <span className="text-white truncate max-w-[160px]">{p.myName}</span>
          <span className="text-slate-600 font-black">VS</span>
          <span className="text-slate-300 truncate max-w-[160px]">{p.opponentName}</span>
        </div>

        <div className="ml-auto md:ml-0 flex items-center gap-1 shrink-0">
          {p.pointsPopup ? (
            <span className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[11px] font-black animate-in zoom-in-50">+{p.pointsPopup}</span>
          ) : null}
          <span className="hidden sm:inline-flex px-2.5 h-7 items-center rounded-lg bg-emerald-400/10 border border-emerald-400/25 text-[12px] font-bold text-emerald-300 tabular-nums">
            {p.prizeLabel}
          </span>
          {p.voice}
          <SoundSettingsButton />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Game menu"
                className="h-9 w-9 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl bg-[#0d1424] border-white/10 text-slate-200 z-[200]">
              <DropdownMenuItem disabled={p.rematchDisabled} onSelect={p.onRematch} className="gap-2 focus:bg-white/10 focus:text-white">
                <RotateCcw className="w-4 h-4" /> Rematch
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={p.onPlayAnother} className="gap-2 focus:bg-white/10 focus:text-white">
                <Gamepad2 className="w-4 h-4" /> Play another game
              </DropdownMenuItem>
              {p.canShowWinnerCard && p.onShowWinnerCard && (
                <DropdownMenuItem onSelect={p.onShowWinnerCard} className="gap-2 focus:bg-white/10 focus:text-white">
                  <Trophy className="w-4 h-4" /> Result card
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={p.onOpenChat} className="gap-2 focus:bg-white/10 focus:text-white">
                <MessageCircle className="w-4 h-4" /> Room chat
              </DropdownMenuItem>
              {p.onCopyInvite && (
                <DropdownMenuItem onSelect={p.onCopyInvite} className="gap-2 focus:bg-white/10 focus:text-white">
                  {p.copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} Copy invite link
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem onSelect={p.onOpenHelp} className="gap-2 focus:bg-white/10 focus:text-white">
                <HelpCircle className="w-4 h-4" /> How to play
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={p.onLockBoard} className="gap-2 focus:bg-white/10 focus:text-white">
                <Maximize2 className="w-4 h-4" /> Full-screen board
              </DropdownMenuItem>
              {p.onCancelRoom && (
                <>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem onSelect={p.onCancelRoom} className="gap-2 text-rose-300 focus:bg-rose-500/15 focus:text-rose-200">
                    <XCircle className="w-4 h-4" /> Cancel room
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

/** Minimal pill shown when the board is locked full-screen. */
export function GameShellPill({ onLeave, onExpand, voice }: { onLeave: () => void; onExpand: () => void; voice?: ReactNode }) {
  return (
    <div
      className="fixed left-2 z-[115] flex items-center gap-1 p-1 rounded-2xl bg-[#0a0f1b]/90 border border-white/10 shadow-xl"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 6px)" }}
    >
      <button type="button" onClick={onLeave} aria-label="Back to arena" className="h-8 w-8 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10">
        <ArrowLeft className="w-4 h-4" />
      </button>
      {voice}
      <SoundSettingsButton className="h-8 w-8" />
      <button type="button" onClick={onExpand} aria-label="Show game bar" className="h-8 px-2.5 rounded-xl text-[12px] font-bold text-slate-300 hover:text-white hover:bg-white/10">
        Show bar
      </button>
    </div>
  );
}
