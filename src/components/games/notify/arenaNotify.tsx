import { useCallback } from "react";
import { toast as sonner } from "sonner";
import { AlertTriangle, Bell, Gift, MessageCircle, Swords, Trophy, X, Zap } from "lucide-react";
import { stingers, ui } from "@/lib/audio/arenaAudio";

export type ArenaNotifyKind = "turn" | "win" | "lose" | "draw" | "invite" | "message" | "reward" | "info" | "error";

export interface ArenaNotifyOptions {
  kind?: ArenaNotifyKind;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  /** ms; invites stay longer by default */
  duration?: number;
  silent?: boolean;
}

const KIND_STYLE: Record<ArenaNotifyKind, { icon: JSX.Element; accent: string; ring: string }> = {
  turn: { icon: <Zap className="w-4 h-4" />, accent: "#34d399", ring: "rgba(52,211,153,0.35)" },
  win: { icon: <Trophy className="w-4 h-4" />, accent: "#fbbf24", ring: "rgba(251,191,36,0.4)" },
  lose: { icon: <Trophy className="w-4 h-4" />, accent: "#94a3b8", ring: "rgba(148,163,184,0.3)" },
  draw: { icon: <Swords className="w-4 h-4" />, accent: "#a5b4fc", ring: "rgba(165,180,252,0.3)" },
  invite: { icon: <Swords className="w-4 h-4" />, accent: "#f59e0b", ring: "rgba(245,158,11,0.4)" },
  message: { icon: <MessageCircle className="w-4 h-4" />, accent: "#f472b6", ring: "rgba(244,114,182,0.35)" },
  reward: { icon: <Gift className="w-4 h-4" />, accent: "#fbbf24", ring: "rgba(251,191,36,0.4)" },
  info: { icon: <Bell className="w-4 h-4" />, accent: "#38bdf8", ring: "rgba(56,189,248,0.3)" },
  error: { icon: <AlertTriangle className="w-4 h-4" />, accent: "#f87171", ring: "rgba(248,113,113,0.35)" },
};

function ArenaToastCard({ id, opts }: { id: string | number; opts: ArenaNotifyOptions }) {
  const kind = opts.kind || "info";
  const style = KIND_STYLE[kind];
  return (
    <div
      role="status"
      className="pointer-events-auto w-[min(92vw,380px)] flex items-start gap-3 rounded-2xl bg-[#0b1220]/95 border border-white/10 p-3 pr-2 text-left shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)]"
      style={{ boxShadow: `0 0 0 1px ${style.ring}, 0 18px 50px -12px rgba(0,0,0,0.8)` }}
    >
      <span
        className="mt-0.5 h-8 w-8 shrink-0 rounded-xl flex items-center justify-center"
        style={{ background: `${style.accent}22`, color: style.accent }}
        aria-hidden
      >
        {style.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-extrabold text-white leading-snug">{opts.title}</p>
        {opts.description && <p className="text-[12px] text-slate-400 leading-snug mt-0.5 line-clamp-3">{opts.description}</p>}
        {opts.action && (
          <button
            type="button"
            onClick={() => {
              opts.action?.onClick();
              sonner.dismiss(id);
            }}
            className="mt-2 h-8 px-3 rounded-lg text-[12px] font-extrabold text-slate-950 transition hover:brightness-110"
            style={{ background: style.accent }}
          >
            {opts.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => sonner.dismiss(id)}
        className="h-7 w-7 shrink-0 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 flex items-center justify-center"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

const isNarrow = () => typeof window !== "undefined" && window.innerWidth < 640;

function playKindSound(kind: ArenaNotifyKind) {
  if (kind === "turn") ui.turn(true);
  else if (kind === "invite") ui.invite();
  else if (kind === "message") ui.notify();
  else if (kind === "reward") ui.reward();
  else if (kind === "error") ui.error();
  else if (kind === "win") stingers.win();
  else if (kind === "lose") stingers.lose();
  else if (kind === "draw") stingers.draw();
}

/** Show a SwiftArena notification card. */
export function arenaNotify(opts: ArenaNotifyOptions) {
  const kind = opts.kind || "info";
  if (!opts.silent && kind !== "info" && kind !== "win" && kind !== "lose" && kind !== "draw") playKindSound(kind);
  return sonner.custom((id) => <ArenaToastCard id={id} opts={{ ...opts, kind }} />, {
    duration: opts.duration ?? (kind === "invite" ? 12000 : kind === "error" ? 6000 : 4200),
    position: isNarrow() ? "top-center" : "bottom-right",
    unstyled: true,
  });
}

/** Strip decorative leading emoji ("🏆 VICTORY!" → "VICTORY!") so cards read cleanly. */
function cleanTitle(raw: string): string {
  return String(raw || "")
    .replace(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍\s]+/u, "")
    .trim();
}

function inferKind(title: string, variant?: string): ArenaNotifyKind {
  if (variant === "destructive") return "error";
  const t = title.toLowerCase();
  if (/victory|you win|won|champion/.test(t) && !/lost/.test(t)) return "win";
  if (/draw/.test(t)) return "draw";
  if (/your turn|turn alert|it's your/.test(t)) return "turn";
  if (/invite|challenge|accepted|joined/.test(t)) return "invite";
  if (/message|dm|chat/.test(t)) return "message";
  if (/points|reward|data|bundle|credited|pts/.test(t)) return "reward";
  return "info";
}

/**
 * Drop-in replacement for the shadcn `toast({ title, description, variant })`
 * used across the arena, rendering the SwiftArena card instead.
 */
export function useArenaToast() {
  const toast = useCallback((o: { title?: unknown; description?: unknown; variant?: string; duration?: number }) => {
    const title = cleanTitle(String(o.title ?? ""));
    const description = o.description == null ? undefined : String(o.description);
    return arenaNotify({ title, description, kind: inferKind(title, o.variant), duration: o.duration });
  }, []);
  return { toast };
}
