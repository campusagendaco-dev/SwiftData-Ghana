import type { ReactNode } from "react";
import { ArrowLeft, HelpCircle, Volume2, VolumeX, WifiOff } from "lucide-react";
import type { ConnectionStatus } from "./useConnectionStatus";

export interface ShellPlayer {
  name: string;
  active?: boolean;
  score?: string | number;
}

const LOW_TIME_SECONDS = 5;

const formatTime = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
};

const iconButton =
  "h-10 w-10 shrink-0 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors";

export default function GameShell({
  title,
  players,
  secondsLeft,
  connection,
  soundOn,
  onToggleSound,
  onHelp,
  onExit,
  children,
}: {
  title: string;
  players: ShellPlayer[];
  secondsLeft?: number;
  connection: ConnectionStatus;
  soundOn: boolean;
  onToggleSound: () => void;
  onHelp: () => void;
  onExit: () => void;
  children: ReactNode;
}) {
  const lowTime = secondsLeft !== undefined && secondsLeft <= LOW_TIME_SECONDS;

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col gap-2 px-3 py-3">
      <header className="flex items-center gap-1 rounded-2xl border border-border/70 bg-card/85 p-1.5 backdrop-blur-sm">
        <button type="button" onClick={onExit} aria-label="Leave game" className={iconButton}>
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate px-1 text-base font-bold text-foreground">{title}</h1>
        {secondsLeft !== undefined && (
          <span
            role="timer"
            className={`rounded-lg px-2 py-1 text-sm font-bold tabular-nums ${
              lowTime ? "bg-destructive/15 text-destructive" : "bg-muted text-foreground"
            }`}
          >
            {formatTime(secondsLeft)}
          </span>
        )}
        <button
          type="button"
          onClick={onToggleSound}
          aria-label={soundOn ? "Turn sound off" : "Turn sound on"}
          className={iconButton}
        >
          {soundOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
        </button>
        <button type="button" onClick={onHelp} aria-label="How to play" className={iconButton}>
          <HelpCircle className="h-5 w-5" />
        </button>
      </header>

      <ul className="flex gap-2">
        {players.map((player) => (
          <li
            key={player.name}
            aria-current={player.active ? "true" : undefined}
            className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-2xl border bg-card/85 px-3 py-2 backdrop-blur-sm ${
              player.active ? "border-primary" : "border-border/70"
            }`}
          >
            <span className="truncate text-sm font-semibold text-foreground">{player.name}</span>
            {player.score !== undefined && (
              <span className="text-sm font-bold tabular-nums text-foreground">{player.score}</span>
            )}
          </li>
        ))}
      </ul>

      {connection === "offline" && (
        <div role="status" className="flex items-center gap-2 rounded-2xl bg-amber-500/15 px-3 py-2 text-sm font-medium text-foreground">
          <WifiOff className="h-4 w-4 shrink-0" />
          Connection lost. We'll pick up your game when you're back online.
        </div>
      )}

      <main className="flex flex-1 flex-col items-center justify-center">{children}</main>
    </div>
  );
}
