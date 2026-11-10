import { memo, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ChevronLeft,
  Clock,
  Gamepad2,
  Hash,
  HelpCircle,
  Loader2,
  Lock,
  Play,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trophy,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { GAME_CATALOG, GAME_GENRES, getGameMeta, type GameGenre, type GameType } from "./gameCatalog";
import { GameArt } from "./GameArt";

type ChallengeMode = "p2p" | "ai" | "free_data";
type Privacy = "public" | "private";
type Side = "creator" | "opponent";
export type LobbyDrawerTab = "profile" | "settings" | "rooms" | "help";
export type LobbyCommunityTab = "chat" | "dms" | "gamers" | "room";

export interface ArenaLobbyProps {
  isSignedIn: boolean;
  playerName: string;
  level: number;
  levelTitle: string;
  levelProgressPercent: number;
  arenaPoints: number;
  walletBalance: number;
  dataGoalSize: string;
  dataGoalPercent: number;
  remainingFreeDataToday: number;

  openChallenges: any[];
  inProgressChallenges: any[];
  invitedChallenge: any | null;
  recentWinners: any[];
  loading: boolean;
  joiningChallengeId: string | null;
  roomCodeInput: string;

  resolveMySide: (challenge: any) => Side | null | undefined;
  isInvitedForMe: (challenge: any) => boolean;

  onLaunchGame: (game: GameType, mode?: ChallengeMode, privacy?: Privacy) => void;
  onOpenDrawer: (tab: LobbyDrawerTab, game?: GameType) => void;
  onOpenCommunity: (tab: LobbyCommunityTab) => void;
  onGoHome: () => void;
  onRefresh: () => void;
  onJoinChallenge: (challenge: any, source: "wallet" | "momo", fromInvite?: boolean) => void;
  onCancelChallenge: (challengeId: string) => void;
  onResumeChallenge: (challenge: any, side: Side) => void;
  onRoomCodeChange: (value: string) => void;
  onJoinByRoomCode: () => void;

  /** Existing components passed in so this file stays presentation-only. */
  avatarSlot: ReactNode;
  voiceSlot?: ReactNode;
  storiesSlot?: ReactNode;
  communitySlot?: ReactNode;
}

const cedi = (n: number) => `GH₵ ${Number(n || 0).toFixed(2)}`;
const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);

/** Below-the-fold sections skip layout/paint until scrolled near (big win on low-end phones). */
const deferPaint = { contentVisibility: "auto", containIntrinsicSize: "auto 640px" } as const;

export const ArenaLobby = memo(function ArenaLobby(props: ArenaLobbyProps) {
  const {
    isSignedIn, playerName, level, levelTitle, levelProgressPercent, arenaPoints, walletBalance,
    dataGoalSize, dataGoalPercent, remainingFreeDataToday,
    openChallenges, inProgressChallenges, invitedChallenge, recentWinners, loading,
    onLaunchGame, onOpenDrawer, onOpenCommunity, onGoHome,
    avatarSlot, voiceSlot, storiesSlot, communitySlot,
  } = props;

  const [genre, setGenre] = useState<"all" | GameGenre>("all");
  const games = useMemo(
    () => (genre === "all" ? GAME_CATALOG : GAME_CATALOG.filter((g) => g.genre === genre)),
    [genre]
  );
  const [featured, ...rest] = games;

  return (
    <div className="relative">
      {/* Static aurora backdrop (no animation, no blur filter) */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px] overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full opacity-60" style={{ background: "radial-gradient(closest-side, rgba(245,158,11,0.22), transparent)" }} />
        <div className="absolute -top-24 -left-40 w-[520px] h-[520px] rounded-full opacity-50" style={{ background: "radial-gradient(closest-side, rgba(16,185,129,0.16), transparent)" }} />
        <div className="absolute top-10 -right-40 w-[520px] h-[520px] rounded-full opacity-50" style={{ background: "radial-gradient(closest-side, rgba(217,70,239,0.14), transparent)" }} />
      </div>

      <TopBar {...props} />

      <main className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-24 space-y-10 sm:space-y-14">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="grid lg:grid-cols-[1.25fr_1fr] gap-6 lg:gap-10 items-center pt-6 sm:pt-10">
          <div className="space-y-6">
            <button
              type="button"
              onClick={() => onOpenDrawer("rooms")}
              className="inline-flex items-center gap-2 pl-2 pr-3 py-1 rounded-full border border-white/10 bg-white/[0.04] text-[11px] font-semibold text-slate-300 hover:text-white hover:border-white/20 transition-colors"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70 animate-ping motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              {openChallenges.length > 0 ? `${openChallenges.length} live challenges open` : "Arena is live"}
              <span className="text-slate-500">·</span>
              <span>{GAME_CATALOG.length} skill games</span>
            </button>

            <h1 className="text-[42px] leading-[1.02] sm:text-6xl lg:text-7xl font-black tracking-[-0.03em]">
              <span className="text-white">Play smart.</span>
              <br />
              <span className="bg-gradient-to-r from-amber-300 via-amber-400 to-orange-500 bg-clip-text text-transparent">Win real data.</span>
            </h1>

            <p className="text-base sm:text-lg text-slate-400 max-w-xl leading-relaxed">
              Ghana&apos;s skill-gaming arena. Beat the AI or a friend in Oware, Dame, Pool and more, and earn Arena Points with every win.
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => onLaunchGame("oware", "free_data")}
                className="group inline-flex items-center justify-center gap-2 h-12 px-6 rounded-2xl bg-gradient-to-b from-amber-300 to-amber-500 text-slate-950 font-extrabold text-[15px] shadow-[0_10px_30px_-8px_rgba(245,158,11,0.7)] hover:from-amber-200 hover:to-amber-400 active:scale-[0.98] transition"
              >
                <Zap className="w-4 h-4" />
                Quick play
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              <button
                type="button"
                onClick={() => onLaunchGame("oware", "p2p", "private")}
                className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-2xl border border-white/15 bg-white/[0.04] text-white font-bold text-[15px] hover:bg-white/[0.08] active:scale-[0.98] transition"
              >
                <Users className="w-4 h-4" />
                Challenge a friend
              </button>
            </div>

            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-slate-400">
              <li className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-emerald-400" /> 100% skill, no luck</li>
              <li className="flex items-center gap-1.5"><Wallet className="w-4 h-4 text-amber-400" /> Instant wallet payouts</li>
              <li className="flex items-center gap-1.5"><Smartphone className="w-4 h-4 text-sky-400" /> Data in minutes</li>
            </ul>
          </div>

          <PlayerCard
            avatarSlot={avatarSlot}
            playerName={playerName}
            level={level}
            levelTitle={levelTitle}
            levelProgressPercent={levelProgressPercent}
            arenaPoints={arenaPoints}
            walletBalance={walletBalance}
            isSignedIn={isSignedIn}
            dataGoalSize={dataGoalSize}
            dataGoalPercent={dataGoalPercent}
            remainingFreeDataToday={remainingFreeDataToday}
            onOpenProfile={() => onOpenDrawer("profile")}
          />
        </section>

        {/* ── Live now: invites + matches to resume ────────────── */}
        {(invitedChallenge || inProgressChallenges.length > 0) && (
          <LiveNow {...props} />
        )}

        {/* ── Game library ─────────────────────────────────────── */}
        <section className="space-y-5" aria-labelledby="arena-library">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-400/90">Game library</p>
              <h2 id="arena-library" className="text-2xl sm:text-3xl font-black tracking-tight text-white mt-1">Pick your game</h2>
            </div>
            <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto no-scrollbar">
              <div className="flex gap-2 w-max" role="tablist" aria-label="Filter games">
                {GAME_GENRES.map((g) => {
                  const active = genre === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setGenre(g.id)}
                      className={`h-9 px-4 rounded-full text-[13px] font-bold whitespace-nowrap transition-colors ${
                        active ? "bg-white text-slate-950" : "bg-white/[0.05] text-slate-300 hover:bg-white/[0.1] border border-white/10"
                      }`}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {featured && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              <GameCard
                game={featured.id}
                featured
                spanClass={rest.length >= 2 ? "col-span-2 lg:row-span-2" : rest.length === 1 ? "col-span-2" : "col-span-2 lg:col-span-3"}
                onPlay={onLaunchGame}
                onHelp={(g) => onOpenDrawer("help", g)}
              />
              {rest.map((g, i) => {
                const span = lastCardSpan(i, rest.length);
                return (
                  <GameCard
                    key={g.id}
                    game={g.id}
                    spanClass={span.className}
                    wide={span.wide}
                    onPlay={onLaunchGame}
                    onHelp={(gid) => onOpenDrawer("help", gid)}
                  />
                );
              })}
            </div>
          )}
        </section>

        {/* ── Challenges board ─────────────────────────────────── */}
        <div style={deferPaint}>
          <ChallengesBoard {...props} />
        </div>

        {/* ── Recent winners ticker ────────────────────────────── */}
        {recentWinners.length > 0 && <WinnersTicker winners={recentWinners} />}

        {/* ── Community ─────────────────────────────────────────── */}
        {(storiesSlot || communitySlot) && (
          <section className="space-y-5" style={deferPaint} aria-labelledby="arena-community">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-fuchsia-400/90">Community</p>
                <h2 id="arena-community" className="text-2xl sm:text-3xl font-black tracking-tight text-white mt-1">Meet the players</h2>
              </div>
              <button
                type="button"
                onClick={() => onOpenCommunity("gamers")}
                className="text-sm font-bold text-slate-300 hover:text-white inline-flex items-center gap-1"
              >
                Find opponents <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            {storiesSlot}
            {communitySlot}
          </section>
        )}

        <footer className="pt-4 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <span>SwiftData Arena · Skill-based competitions. Play responsibly.</span>
          <button type="button" onClick={onGoHome} className="hover:text-slate-300">Back to SwiftData</button>
        </footer>
      </main>
    </div>
  );
});

/* ───────────────────────────────── Top bar ───────────────────────────────── */

function TopBar({ isSignedIn, walletBalance, arenaPoints, level, playerName, avatarSlot, voiceSlot, onOpenDrawer, onGoHome }: ArenaLobbyProps) {
  return (
    <header
      className="sticky z-30 border-b border-white/[0.06] bg-[#0a0f1b]/90 supports-[backdrop-filter]:bg-[#0a0f1b]/75 supports-[backdrop-filter]:backdrop-blur-md"
      style={{ top: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="max-w-6xl mx-auto h-14 sm:h-16 px-3 sm:px-6 lg:px-8 flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onGoHome}
          aria-label="Back to SwiftData"
          className="h-9 w-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mr-auto min-w-0">
          <span className="h-8 w-8 rounded-xl bg-gradient-to-br from-amber-300 to-orange-500 flex items-center justify-center shadow-[0_6px_18px_-6px_rgba(245,158,11,0.8)]">
            <Gamepad2 className="w-[18px] h-[18px] text-slate-950" strokeWidth={2.5} />
          </span>
          <span className="font-black tracking-tight text-white text-[17px]">
            Swift<span className="text-amber-400">Arena</span>
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 h-9 px-3 rounded-xl bg-white/[0.04] border border-white/10 text-[13px] font-bold text-amber-300" title="Arena points">
          <Sparkles className="w-4 h-4" />
          {compact(arenaPoints)}
        </div>

        {isSignedIn && (
          <button
            type="button"
            onClick={() => onOpenDrawer("profile")}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-emerald-500/10 border border-emerald-400/25 text-[13px] font-bold text-emerald-300 hover:bg-emerald-500/15 transition-colors"
            title="Wallet balance"
          >
            <Wallet className="w-4 h-4" />
            <span className="tabular-nums">{cedi(walletBalance)}</span>
          </button>
        )}

        {voiceSlot && <div className="hidden md:block">{voiceSlot}</div>}

        <button
          type="button"
          onClick={() => onOpenDrawer("help")}
          aria-label="How to play"
          className="h-9 w-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
        >
          <HelpCircle className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() => onOpenDrawer("profile")}
          className="flex items-center gap-2 rounded-full pl-0.5 pr-2.5 py-0.5 hover:bg-white/[0.06] transition-colors"
          aria-label="Open profile and settings"
        >
          {avatarSlot}
          <span className="hidden sm:flex flex-col items-start leading-tight">
            <span className="text-[13px] font-bold text-white max-w-[110px] truncate">{playerName}</span>
            <span className="text-[11px] font-semibold text-amber-400">Level {level}</span>
          </span>
        </button>
      </div>
    </header>
  );
}

/* ─────────────────────────────── Player card ─────────────────────────────── */

function PlayerCard(p: {
  avatarSlot: ReactNode;
  playerName: string;
  level: number;
  levelTitle: string;
  levelProgressPercent: number;
  arenaPoints: number;
  walletBalance: number;
  isSignedIn: boolean;
  dataGoalSize: string;
  dataGoalPercent: number;
  remainingFreeDataToday: number;
  onOpenProfile: () => void;
}) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const dash = c * (1 - Math.min(100, Math.max(0, p.levelProgressPercent)) / 100);
  return (
    <div className="relative rounded-[28px] p-[1px] bg-gradient-to-b from-white/20 via-white/5 to-white/0">
      <div className="rounded-[27px] bg-[#0d1424] p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-4">
          <div className="relative w-[84px] h-[84px] shrink-0">
            <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90" aria-hidden>
              <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
              <circle cx="40" cy="40" r={r} fill="none" stroke="url(#lvlGrad)" strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={dash} className="transition-[stroke-dashoffset] duration-700" />
              <defs>
                <linearGradient id="lvlGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#fde68a" />
                  <stop offset="100%" stopColor="#f97316" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-[10px] flex items-center justify-center">{p.avatarSlot}</div>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Your arena profile</p>
            <p className="text-xl font-black text-white truncate">{p.playerName}</p>
            <p className="text-sm font-semibold text-amber-400">Level {p.level} · {p.levelTitle}</p>
            <p className="text-xs text-slate-500 mt-0.5">{p.levelProgressPercent}% to level {Math.min(10, p.level + 1)}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Stat label="Points" value={compact(p.arenaPoints)} accent="text-amber-300" />
          <Stat label="Wallet" value={p.isSignedIn ? cedi(p.walletBalance).replace("GH₵ ", "₵") : "—"} accent="text-emerald-300" />
          <Stat label="Free data" value={`${p.remainingFreeDataToday} left`} accent="text-sky-300" />
        </div>

        <button type="button" onClick={p.onOpenProfile} className="w-full text-left group">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-bold text-white flex items-center gap-1.5"><Trophy className="w-4 h-4 text-amber-400" /> {p.dataGoalSize} data goal</span>
            <span className="font-bold tabular-nums text-slate-300">{p.dataGoalPercent}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-amber-400 to-orange-500 transition-[width] duration-700" style={{ width: `${p.dataGoalPercent}%` }} />
          </div>
          <p className="text-xs text-slate-500 mt-2 group-hover:text-slate-300 transition-colors">
            {p.dataGoalPercent >= 100 ? "Goal reached. Tap to redeem your bundle." : "Win matches to earn points. Tap to change your goal."}
          </p>
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`text-[15px] font-black tabular-nums truncate ${accent}`}>{value}</p>
    </div>
  );
}

/* ──────────────────────────────── Game card ──────────────────────────────── */

/**
 * The featured card fills 2×2 on desktop with two cards beside it, so a row
 * can end with a lone card. Stretch the last card across the gap (on phones
 * the grid is 2 columns, on desktop 3) so the grid never ends ragged.
 */
function lastCardSpan(index: number, count: number): { className: string; wide: boolean } {
  if (index !== count - 1) return { className: "", wide: false };
  const mobileOdd = count % 2 === 1;
  const lgRemainder = count > 2 ? (count - 2) % 3 : 0;
  const lg = lgRemainder === 1 ? "lg:col-span-3" : lgRemainder === 2 ? "lg:col-span-2" : mobileOdd ? "lg:col-span-1" : "";
  return { className: `${mobileOdd ? "col-span-2" : ""} ${lg}`.trim(), wide: mobileOdd || lgRemainder > 0 };
}

const GameCard = memo(function GameCard({
  game,
  featured,
  wide,
  spanClass = "",
  onPlay,
  onHelp,
}: {
  game: GameType;
  featured?: boolean;
  /** Spans several columns: lay art and text side by side on wider screens. */
  wide?: boolean;
  spanClass?: string;
  onPlay: (g: GameType, mode?: ChallengeMode) => void;
  onHelp: (g: GameType) => void;
}) {
  const meta = getGameMeta(game)!;
  const artSize = featured
    ? "h-48 sm:h-64 lg:h-auto lg:flex-1 lg:min-h-[300px]"
    : wide
      ? "h-32 sm:h-auto sm:min-h-[190px] sm:w-[58%] sm:shrink-0"
      : "h-32 sm:h-40";
  return (
    <article
      className={`group relative flex flex-col rounded-3xl overflow-hidden border border-white/[0.08] bg-[#0d1424] transition duration-300 hover:-translate-y-0.5 hover:border-white/20 ${spanClass}`}
      style={{ ["--accent" as any]: meta.accent }}
    >
      <button
        type="button"
        onClick={() => onPlay(game, "free_data")}
        className={`flex flex-1 w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded-3xl ${wide ? "flex-col sm:flex-row" : "flex-col"}`}
        aria-label={`Play ${meta.name}`}
      >
        <div className={`relative overflow-hidden ${artSize}`}>
          <GameArt game={game} />
          <div className={`absolute inset-0 bg-gradient-to-t from-[#0d1424] via-transparent to-transparent ${wide ? "sm:bg-gradient-to-l" : ""}`} />
          <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2">
            <span className="px-2.5 py-1 rounded-full bg-black/55 text-[10px] font-extrabold uppercase tracking-wider text-white/90">
              {meta.categoryTag}
            </span>
            {meta.isNew ? (
              <span className="px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-300 to-orange-400 text-[10px] font-black uppercase tracking-wider text-slate-950">New</span>
            ) : featured ? (
              <span className="px-2.5 py-1 rounded-full bg-emerald-400 text-[10px] font-black uppercase tracking-wider text-slate-950">{meta.badge}</span>
            ) : null}
          </div>
        </div>

        <div className={`relative ${featured ? "p-5 sm:p-6" : wide ? "p-3.5 sm:p-6 sm:flex-1 sm:self-center" : "p-3.5 sm:p-4"} space-y-1.5 min-w-0`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className={`${featured ? "text-2xl sm:text-3xl truncate" : "text-[15px] sm:text-lg leading-tight line-clamp-2"} font-black tracking-tight text-white`}>
              {meta.name}
            </h3>
            <span
              className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-slate-950 transition-transform group-hover:scale-110"
              style={{ background: meta.accent }}
              aria-hidden
            >
              <Play className="w-3.5 h-3.5 fill-current" />
            </span>
          </div>
          <p className={`${featured ? "text-sm sm:text-base" : "text-xs sm:text-[13px]"} text-slate-400 line-clamp-2`}>{meta.tagline}</p>
          <div className="flex items-center gap-3 pt-1 text-[11px] font-semibold text-slate-500">
            <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {meta.players}</span>
            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {meta.matchLength}</span>
          </div>
        </div>
      </button>

      {featured && (
        <div className="px-5 sm:px-6 pb-5 sm:pb-6 -mt-1 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onPlay(game, "free_data")}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 text-slate-950 font-extrabold text-sm hover:from-amber-200 hover:to-amber-400 transition"
          >
            Play now <ArrowRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onPlay(game, "p2p")}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border border-white/15 bg-white/[0.04] text-white font-bold text-sm hover:bg-white/[0.08] transition"
          >
            Challenge a friend
          </button>
          <button
            type="button"
            onClick={() => onHelp(game)}
            className="inline-flex items-center gap-2 h-11 px-4 rounded-xl text-slate-300 hover:text-white font-semibold text-sm transition"
          >
            <HelpCircle className="w-4 h-4" /> How to play
          </button>
        </div>
      )}
      {/* accent glow on hover */}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ boxShadow: "inset 0 0 0 1px var(--accent), 0 20px 50px -20px var(--accent)" }} />
    </article>
  );
});

/* ──────────────────────────────── Live now ──────────────────────────────── */

function LiveNow({ invitedChallenge, inProgressChallenges, isSignedIn, resolveMySide, onJoinChallenge, onResumeChallenge, joiningChallengeId }: ArenaLobbyProps) {
  return (
    <section className="space-y-3" aria-label="Live now">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-400 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse motion-reduce:animate-none" /> Live now
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        {invitedChallenge && (
          <LiveRow
            challenge={invitedChallenge}
            label={invitedChallenge.metadata?.is_private ? "Private invite" : "Room invite"}
            title={`${invitedChallenge.creator_name} challenged you`}
            highlight
            cta={joiningChallengeId === invitedChallenge.id ? "Joining…" : "Accept & play"}
            onClick={() => onJoinChallenge(invitedChallenge, isSignedIn ? "wallet" : "momo", true)}
          />
        )}
        {inProgressChallenges.slice(0, 3).map((chal) => {
          const side = resolveMySide(chal) || "opponent";
          return (
            <LiveRow
              key={chal.id}
              challenge={chal}
              label={`In progress · #${chal.room_code}`}
              title={`${chal.creator_name} vs ${chal.opponent_name || "Challenger"}`}
              cta="Resume"
              onClick={() => onResumeChallenge(chal, side)}
            />
          );
        })}
      </div>
    </section>
  );
}

function LiveRow({ challenge, label, title, cta, onClick, highlight }: { challenge: any; label: string; title: string; cta: string; onClick: () => void; highlight?: boolean }) {
  const meta = getGameMeta(challenge.game_type);
  return (
    <div className={`flex items-center gap-3 p-3 rounded-2xl border ${highlight ? "border-amber-400/40 bg-amber-400/[0.07]" : "border-emerald-400/25 bg-emerald-400/[0.05]"}`}>
      <GameBadge game={challenge.game_type} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 truncate">{meta?.shortTitle || challenge.game_type} · {label}</p>
        <p className="text-sm font-bold text-white truncate">{title}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        className={`shrink-0 h-10 px-4 rounded-xl font-extrabold text-sm text-slate-950 ${highlight ? "bg-amber-400 hover:bg-amber-300" : "bg-emerald-400 hover:bg-emerald-300"} transition-colors`}
      >
        {cta}
      </button>
    </div>
  );
}

function GameBadge({ game }: { game: string }) {
  const meta = getGameMeta(game);
  return (
    <span
      className="shrink-0 h-11 w-11 rounded-xl flex items-center justify-center text-xl"
      style={{ background: `color-mix(in srgb, ${meta?.accent || "#64748b"} 22%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${meta?.accent || "#64748b"} 45%, transparent)` }}
      aria-hidden
    >
      {meta?.emoji || "⚔️"}
    </span>
  );
}

/* ───────────────────────────── Challenges board ───────────────────────────── */

function ChallengesBoard(props: ArenaLobbyProps) {
  const { openChallenges, loading, roomCodeInput, onRoomCodeChange, onJoinByRoomCode, onRefresh, onLaunchGame, resolveMySide, isInvitedForMe } = props;
  const [tab, setTab] = useState<"open" | "mine">("open");
  const mine = openChallenges.filter((c) => resolveMySide(c) === "creator");
  const others = openChallenges.filter((c) => resolveMySide(c) !== "creator");
  const list = tab === "open" ? others : mine;

  return (
    <section className="rounded-[28px] border border-white/[0.08] bg-[#0b1220] overflow-hidden" aria-labelledby="arena-challenges">
      <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-white/[0.06]">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-sky-400/90">Head-to-head</p>
          <h2 id="arena-challenges" className="text-2xl font-black tracking-tight text-white mt-1">Open challenges</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onLaunchGame("oware", "p2p", "public")} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white text-slate-950 font-extrabold text-sm hover:bg-slate-200 transition-colors">
            <PlusCircle className="w-4 h-4" /> Post a challenge
          </button>
          <button type="button" onClick={() => onLaunchGame("oware", "p2p", "private")} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-white/15 text-white font-bold text-sm hover:bg-white/[0.06] transition-colors">
            <Lock className="w-4 h-4" /> Private room
          </button>
          <button type="button" onClick={onRefresh} aria-label="Refresh challenges" className="h-10 w-10 rounded-xl border border-white/10 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onJoinByRoomCode();
          }}
        >
          <label className="relative flex-1">
            <span className="sr-only">Room code</span>
            <Hash className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={roomCodeInput}
              onChange={(e) => onRoomCodeChange(e.target.value.toUpperCase())}
              placeholder="Have a room code? e.g. 8F2K9A"
              maxLength={12}
              autoCapitalize="characters"
              className="w-full h-11 pl-10 pr-3 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder:text-slate-500 font-mono font-bold text-sm tracking-widest uppercase placeholder:normal-case placeholder:tracking-normal placeholder:font-sans placeholder:font-medium focus:outline-none focus:border-amber-400/60"
            />
          </label>
          <button type="submit" disabled={!roomCodeInput.trim()} className="h-11 px-5 rounded-xl bg-amber-400 text-slate-950 font-extrabold text-sm hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition">
            Join
          </button>
        </form>

        <div className="inline-flex p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]" role="tablist">
          {(["open", "mine"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`h-8 px-3.5 rounded-lg text-[13px] font-bold transition-colors ${tab === t ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}
            >
              {t === "open" ? `Join a match (${others.length})` : `My rooms (${mine.length})`}
            </button>
          ))}
        </div>

        {list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center">
            <p className="text-sm font-bold text-slate-200">{tab === "open" ? "No open challenges right now." : "You have no open rooms."}</p>
            <p className="text-sm text-slate-500 mt-1">Post one and online players get notified instantly.</p>
          </div>
        ) : (
          <ul className="grid md:grid-cols-2 gap-2.5">
            {list.slice(0, 10).map((chal) => (
              <ChallengeRow key={chal.id} chal={chal} invited={isInvitedForMe(chal)} mine={tab === "mine"} {...props} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ChallengeRow({ chal, invited, mine, isSignedIn, joiningChallengeId, onJoinChallenge, onCancelChallenge, onResumeChallenge }: ArenaLobbyProps & { chal: any; invited: boolean; mine: boolean }) {
  const meta = getGameMeta(chal.game_type);
  const stake = Number(chal.stake_amount || 0);
  const isPrivate = Boolean(chal.metadata?.is_private);
  const joining = joiningChallengeId === chal.id;
  return (
    <li className={`flex items-center gap-3 p-3 rounded-2xl border ${invited ? "border-amber-400/40 bg-amber-400/[0.06]" : "border-white/[0.07] bg-white/[0.02]"}`}>
      <GameBadge game={chal.game_type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-bold text-white truncate">{meta?.shortTitle || chal.game_type}</p>
          {isPrivate && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
          <span className="text-[11px] font-mono text-slate-500">#{chal.room_code}</span>
        </div>
        <p className="text-xs text-slate-400 truncate">
          {chal.creator_name} ·{" "}
          {stake === 0 ? <span className="text-sky-300 font-semibold">Free match</span> : <span className="text-emerald-300 font-semibold">Win {cedi(chal.prize_pool)}</span>}
          {stake > 0 && <span className="text-slate-500"> · stake {cedi(stake)}</span>}
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        {mine ? (
          <>
            <button type="button" onClick={() => onResumeChallenge(chal, "creator")} className="h-9 px-3 rounded-xl bg-white/10 text-white font-bold text-xs hover:bg-white/15 transition-colors">Open</button>
            <button type="button" onClick={() => onCancelChallenge(chal.id)} className="h-9 px-2.5 rounded-xl text-rose-300 font-bold text-xs hover:bg-rose-500/10 transition-colors">Cancel</button>
          </>
        ) : stake === 0 || isSignedIn ? (
          <button type="button" disabled={joining} onClick={() => onJoinChallenge(chal, "wallet")} className="h-9 px-3.5 rounded-xl bg-emerald-400 text-slate-950 font-extrabold text-xs hover:bg-emerald-300 disabled:opacity-60 transition-colors inline-flex items-center gap-1">
            {joining && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {stake === 0 ? "Accept" : "Accept · Wallet"}
          </button>
        ) : null}
        {!mine && stake > 0 && (
          <button type="button" disabled={joining} onClick={() => onJoinChallenge(chal, "momo")} className="h-9 px-3 rounded-xl border border-amber-400/40 text-amber-300 font-bold text-xs hover:bg-amber-400/10 disabled:opacity-60 transition-colors">
            MoMo
          </button>
        )}
      </div>
    </li>
  );
}

/* ───────────────────────────── Winners ticker ───────────────────────────── */

function WinnersTicker({ winners }: { winners: any[] }) {
  const items = winners.slice(0, 10);
  const row = items.map((w, i) => (
    <span key={`${w.id || i}`} className="inline-flex items-center gap-2 px-4 text-sm">
      <Trophy className="w-4 h-4 text-amber-400" />
      <span className="font-bold text-white">{w.winner_name || "A player"}</span>
      <span className="text-slate-500">won</span>
      <span className="font-bold text-emerald-300">
        {w.reward_type === "wallet_cash" ? cedi(w.cash_amount) : `${w.network || ""} ${w.data_package_size || "1GB"}`}
      </span>
      <span className="text-slate-700">•</span>
    </span>
  ));
  return (
    <section aria-label="Recent winners" className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] py-3">
      <div className="arena-ticker flex w-max">
        <div className="flex shrink-0">{row}</div>
        <div className="flex shrink-0" aria-hidden>{row}</div>
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-[#090e1a] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-[#090e1a] to-transparent" />
    </section>
  );
}
