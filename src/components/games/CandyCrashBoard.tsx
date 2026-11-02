import React, { useState, useEffect, useRef, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Volume2,
  VolumeX,
  Smartphone,
  RotateCcw,
  Lightbulb,
  ChevronLeft,
  HelpCircle,
  Flame,
} from "lucide-react";
import { useDeviceScreenFit } from "@/hooks/use-device-screen-fit";
import {
  playCandyPopSound,
  playLevelUpFanfare,
  triggerHapticSensor,
  getGameSensoryPreferences,
  setGameSensoryPreferences,
  HUMAN_CHALLENGER_PERSONAS,
} from "@/lib/game-sensory-engine";

export interface CandyCrashState {
  creatorScore: number;
  opponentScore: number;
  creatorLevel: number;
  creatorBestCombo: number;
  creatorStars: number;
  creatorFinished: boolean;
  opponentFinished: boolean;
  turn: "creator" | "opponent";
  winner: "creator" | "opponent" | "draw" | null;
  moveCount: number;
}

export const INITIAL_CANDY_STATE: CandyCrashState = {
  creatorScore: 0,
  opponentScore: 0,
  creatorLevel: 1,
  creatorBestCombo: 1,
  creatorStars: 0,
  creatorFinished: false,
  opponentFinished: false,
  turn: "creator",
  winner: null,
  moveCount: 0,
};

type SpecialKind = "h" | "v" | "bomb" | null;

interface CandyTile {
  id: number;
  type: number; // 0..5, or -1 for Calabash Cocoa Bomb
  r: number;
  c: number;
  sp: SpecialKind;
  popping?: boolean;
  born?: boolean;
  hint?: boolean;
}

interface FloatingScorePopup {
  id: number;
  r: number;
  c: number;
  label: string;
  sublabel?: string;
  accent: "gold" | "kente" | "bomb";
}

interface BlastBeam {
  id: number;
  kind: "h" | "v";
  index: number;
}

const N = 8;
const TYPES = 6;

export const GHANA_SWEETS: {
  id: number;
  name: string;
  shortName: string;
  localNote: string;
  colors: [string, string, string];
}[] = [
  {
    id: 0,
    name: "Alewa Toffee",
    shortName: "Alewa",
    localNote: "Striped peppermint-ginger hard toffee",
    colors: ["#ff9fb0", "#e11d48", "#7f1d1d"],
  },
  {
    id: 1,
    name: "Kube Coconut",
    shortName: "Kube",
    localNote: "Caramelized roasted coconut sweet",
    colors: ["#fde68a", "#f97316", "#9a3412"],
  },
  {
    id: 2,
    name: "Golden Cocoa Pod",
    shortName: "Cocoa",
    localNote: "Royal Gold Coast ribbed cacao pod",
    colors: ["#fef9c3", "#eab308", "#854d0e"],
  },
  {
    id: 3,
    name: "Nkate Cake",
    shortName: "Nkate",
    localNote: "Crunchy roasted groundnut brittle",
    colors: ["#bbf7d0", "#16a34a", "#14532d"],
  },
  {
    id: 4,
    name: "Sobolo Crystal",
    shortName: "Sobolo",
    localNote: "Spiced hibiscus ruby-violet crystal",
    colors: ["#bae6fd", "#2563eb", "#1e3a8a"],
  },
  {
    id: 5,
    name: "Bofrot Puff",
    shortName: "Bofrot",
    localNote: "Warm cinnamon-glazed festival puff",
    colors: ["#f5d0fe", "#a855f7", "#581c87"],
  },
];

export const GHANA_SWEET_MARKETS: {
  level: number;
  market: string;
  city: string;
  tagline: string;
}[] = [
  { level: 1, market: "Makola Toffee Tray", city: "Accra", tagline: "Morning Alewa & Kube rush" },
  { level: 2, market: "Osu Oxford Street Stall", city: "Accra", tagline: "Night market sweet cascade" },
  { level: 3, market: "Kejetia Kube Corner", city: "Kumasi", tagline: "Ashanti golden coconut tray" },
  { level: 4, market: "Kotokuraba Sweet Hub", city: "Cape Coast", tagline: "Coastal Nkate & Sobolo breeze" },
  { level: 5, market: "Adum Cocoa Depot", city: "Kumasi", tagline: "Pure Gold Coast cacao harvest" },
  { level: 6, market: "Labadi Beach Fiesta", city: "Accra", tagline: "Highlife festival sweet combo" },
  { level: 7, market: "Takoradi Market Circle", city: "Western", tagline: "Harbour city Calabash bombs" },
  { level: 8, market: "Tamale Savanna Tray", city: "Northern", tagline: "Shea & groundnut brittle master" },
  { level: 9, market: "East Legon Starlight", city: "Accra", tagline: "Championship Kente cascades" },
  { level: 10, market: "Gold Coast Grand Finale", city: "Ghana", tagline: "Supreme Ghanaian Sweet Legend" },
];

function getMarketStage(lv: number) {
  return (
    GHANA_SWEET_MARKETS[(Math.max(1, lv) - 1) % GHANA_SWEET_MARKETS.length] ||
    GHANA_SWEET_MARKETS[0]
  );
}

const BOMB_SPRINKLES = [
  "#ef4444", // Ghana Red
  "#facc15", // Ghana Gold
  "#22c55e", // Ghana Green
  "#38bdf8",
  "#f97316",
  "#e879f9",
];

function renderCandyBaseShape(typeIndex: number) {
  switch (typeIndex) {
    case 0:
      // Alewa Toffee Capsule
      return (
        <rect
          x="12"
          y="26"
          width="76"
          height="48"
          rx="24"
          transform="rotate(-35 50 50)"
        />
      );
    case 1:
      // Kube Coconut Sphere
      return <circle cx="50" cy="50" r="38" />;
    case 2:
      // Golden Ghana Cocoa Pod
      return (
        <path d="M50 8C74 10 88 34 88 53C88 75 72 91 50 93C28 91 12 75 12 53C12 34 26 10 50 8Z" />
      );
    case 3:
      // Nkate Cake Cushion
      return <rect x="14" y="14" width="72" height="72" rx="18" />;
    case 4:
      // Sobolo Hex Crystal
      return (
        <path
          d="M50 10L86 31V69L50 90L14 69V31Z"
          strokeLinejoin="round"
          strokeWidth="8"
        />
      );
    default:
      // Bofrot Diamond Puff
      return (
        <rect
          x="22"
          y="22"
          width="56"
          height="56"
          rx="14"
          transform="rotate(45 50 50)"
        />
      );
  }
}

function renderGhanaianSweetDetails(typeIndex: number) {
  switch (typeIndex) {
    case 0:
      // Alewa Toffee iconic white & dark swirl bands
      return (
        <g clipPath="url(#candy-c0)" opacity="0.88">
          <path d="M18 10 L40 90" stroke="#fff7ed" strokeWidth="9" strokeLinecap="round" />
          <path d="M46 10 L68 90" stroke="#1c1917" strokeWidth="7" strokeLinecap="round" opacity="0.55" />
          <path d="M64 10 L86 90" stroke="#fff7ed" strokeWidth="9" strokeLinecap="round" />
        </g>
      );
    case 1:
      // Kube Coconut toasted coconut flake arcs
      return (
        <g stroke="#fffbeb" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.72">
          <path d="M32 38 Q42 32 48 40" />
          <path d="M54 34 Q64 38 62 48" />
          <path d="M30 58 Q40 66 50 60" />
          <path d="M56 58 Q66 54 68 64" />
          <circle cx="48" cy="50" r="3" fill="#fef3c7" stroke="none" />
        </g>
      );
    case 2:
      // Golden Ghana Cocoa Pod botanical ridges & stem
      return (
        <g opacity="0.8">
          <path
            d="M50 10 C39 32 39 68 50 91 M50 10 C61 32 61 68 50 91"
            stroke="#713f12"
            strokeWidth="2.5"
            fill="none"
          />
          <line x1="26" y1="40" x2="74" y2="40" stroke="#a16207" strokeWidth="2" opacity="0.55" />
          <line x1="24" y1="58" x2="76" y2="58" stroke="#a16207" strokeWidth="2" opacity="0.55" />
        </g>
      );
    case 3:
      // Nkate Cake roasted groundnut kernels inside the square brittle
      return (
        <g opacity="0.88">
          <ellipse cx="34" cy="36" rx="7" ry="4.5" fill="#fde68a" stroke="#92400e" strokeWidth="1.5" transform="rotate(-20 34 36)" />
          <ellipse cx="64" cy="35" rx="6.5" ry="4.5" fill="#fcd34d" stroke="#92400e" strokeWidth="1.5" transform="rotate(25 64 35)" />
          <ellipse cx="50" cy="52" rx="7.5" ry="5" fill="#fde68a" stroke="#92400e" strokeWidth="1.5" transform="rotate(10 50 52)" />
          <ellipse cx="35" cy="65" rx="6.5" ry="4.5" fill="#fcd34d" stroke="#92400e" strokeWidth="1.5" transform="rotate(30 35 65)" />
          <ellipse cx="64" cy="64" rx="7" ry="4.5" fill="#fde68a" stroke="#92400e" strokeWidth="1.5" transform="rotate(-15 64 64)" />
        </g>
      );
    case 4:
      // Sobolo Crystal inner hibiscus jewel facets
      return (
        <g fill="none" stroke="#e0f2fe" strokeWidth="2.2" opacity="0.7">
          <polygon points="50,24 72,37 72,63 50,76 28,63 28,37" />
          <line x1="50" y1="10" x2="50" y2="24" />
          <line x1="86" y1="31" x2="72" y2="37" />
          <line x1="86" y1="69" x2="72" y2="63" />
          <line x1="50" y1="90" x2="50" y2="76" />
          <line x1="14" y1="69" x2="28" y2="63" />
          <line x1="14" y1="31" x2="28" y2="37" />
        </g>
      );
    default:
      // Bofrot Puff cinnamon-sugar glaze ring & sparkles
      return (
        <g opacity="0.82">
          <circle cx="50" cy="50" r="14" fill="none" stroke="#fdf4ff" strokeWidth="3" strokeDasharray="5 4" />
          <circle cx="44" cy="44" r="2.2" fill="#fef08a" />
          <circle cx="57" cy="46" r="2" fill="#fef08a" />
          <circle cx="50" cy="57" r="2.2" fill="#fef08a" />
        </g>
      );
  }
}

export function CandyTileSvg({ type, sp }: { type: number; sp: SpecialKind }) {
  const gloss = (
    <>
      <ellipse
        cx="34"
        cy="26"
        rx="16"
        ry="8.5"
        fill="#fff"
        opacity=".58"
        transform="rotate(-28 34 26)"
      />
      <circle cx="65" cy="73" r="4" fill="#fff" opacity=".35" />
    </>
  );

  // 5-Match Special: Takoradi Calabash Cocoa Bomb with Ghana Star & Festival Sprinkles
  if (sp === "bomb" || type < 0) {
    return (
      <svg
        viewBox="0 0 100 100"
        className="w-full h-full block drop-shadow-[0_4px_3px_rgba(0,0,0,0.5)]"
      >
        {/* Outer Golden Calabash Ring */}
        <circle
          cx="50"
          cy="50"
          r="43"
          fill="none"
          stroke="#facc15"
          strokeWidth="3"
          strokeDasharray="6 3"
          opacity="0.9"
        />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="url(#candy-gb)"
          stroke="#f59e0b"
          strokeWidth="3.5"
        />
        {BOMB_SPRINKLES.map((c, i) => (
          <rect
            key={i}
            x={23 + ((i * 37) % 52)}
            y={21 + ((i * 29) % 50)}
            width="14"
            height="6"
            rx="3"
            fill={c}
            transform={`rotate(${i * 50} ${30 + i * 8} ${28 + i * 7})`}
          />
        ))}
        {/* Center Black Star of Ghana emblem on the Calabash Bomb */}
        <polygon
          points="50,33 54,44 66,44 56,51 60,62 50,55 40,62 44,51 34,44 46,44"
          fill="#facc15"
          stroke="#1f0f08"
          strokeWidth="1.8"
        />
        {gloss}
      </svg>
    );
  }

  const safeType = ((type % TYPES) + TYPES) % TYPES;
  const strokeColor = GHANA_SWEETS[safeType].colors[2];
  const kenteStripeColors = ["#ef4444", "#facc15", "#22c55e"];

  return (
    <svg
      viewBox="0 0 100 100"
      className="w-full h-full block drop-shadow-[0_3px_2px_rgba(0,0,0,0.45)]"
    >
      <g
        fill={`url(#candy-g${safeType})`}
        stroke={strokeColor}
        strokeWidth={safeType === 4 ? 8 : 4}
        strokeLinejoin="round"
      >
        {renderCandyBaseShape(safeType)}
      </g>

      {renderGhanaianSweetDetails(safeType)}

      {/* 4-Match Special: Glowing Kente Weave Row / Column Booster Stripes */}
      {(sp === "h" || sp === "v") && (
        <g clipPath={`url(#candy-c${safeType})`}>
          {[20, 44, 68].map((p, idx) =>
            sp === "h" ? (
              <g key={p}>
                <rect
                  x="0"
                  y={p}
                  width="100"
                  height="11"
                  fill={kenteStripeColors[idx % 3]}
                  opacity="0.92"
                />
                <rect x="0" y={p + 3.5} width="100" height="3.5" fill="#ffffff" opacity="0.85" />
              </g>
            ) : (
              <g key={p}>
                <rect
                  x={p}
                  y="0"
                  width="11"
                  height="100"
                  fill={kenteStripeColors[idx % 3]}
                  opacity="0.92"
                />
                <rect x={p + 3.5} y="0" width="3.5" height="100" fill="#ffffff" opacity="0.85" />
              </g>
            )
          )}
        </g>
      )}
      {gloss}
    </svg>
  );
}

interface CandyCrashBoardProps {
  mode: "p2p" | "ai" | "free_data";
  mySide: "creator" | "opponent";
  creatorName: string;
  opponentName: string;
  initialState?: CandyCrashState;
  onStateChange?: (state: CandyCrashState) => void;
  onMatchComplete?: (
    winner: "creator" | "opponent" | "draw",
    finalState: CandyCrashState
  ) => void;
  onPointsEarned?: (points: number, reason: string) => void;
  playerLevel?: number;
  onBackToLobby?: () => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function CandyCrashBoard({
  mode,
  mySide,
  creatorName,
  opponentName,
  initialState,
  onStateChange,
  onMatchComplete,
  onPointsEarned,
  playerLevel = 1,
  onBackToLobby,
}: CandyCrashBoardProps) {
  const screenFit = useDeviceScreenFit();
  const candyFit = screenFit.computeBoardStageMetrics("candy", { reservedTopPx: 38 });

  const persona = HUMAN_CHALLENGER_PERSONAS.candy;
  const effectiveOpponentName =
    opponentName && opponentName !== "Waiting..." ? opponentName : persona.name;

  const [level, setLevel] = useState<number>(initialState?.creatorLevel || 1);
  const [score, setScore] = useState<number>(0);
  const [challengerLiveScore, setChallengerLiveScore] = useState<number>(0);
  const [moves, setMoves] = useState<number>(18);
  const [goal, setGoal] = useState<number>(1100);
  const [bestScore, setBestScore] = useState<number>(() => {
    try {
      return Number(localStorage.getItem("candycrash-best") || 0);
    } catch {
      return 0;
    }
  });
  const [statusMsg, setStatusMsg] = useState<string>(
    "Match 3+ Ghanaian sweets! 4 = Kente Row/Col Blast • 5 = Calabash Cocoa Bomb."
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showRules, setShowRules] = useState<boolean>(false);
  const [tiles, setTiles] = useState<CandyTile[]>([]);
  const [floatingPopups, setFloatingPopups] = useState<FloatingScorePopup[]>([]);
  const [blastBeams, setBlastBeams] = useState<BlastBeam[]>([]);
  const [activeComboBanner, setActiveComboBanner] = useState<string | null>(null);
  const [timeRemainingSec, setTimeRemainingSec] = useState<number>(75);
  const [overModal, setOverModal] = useState<{
    win: boolean;
    timedOut?: boolean;
    stars: number;
    finalScore: number;
    challengerScore: number;
    goalNeeded: number;
    levelNum: number;
  } | null>(null);

  const prefs = getGameSensoryPreferences();
  const [muted, setMuted] = useState<boolean>(!prefs.soundEnabled);
  const [vibrationEnabled, setVibrationEnabled] = useState<boolean>(
    prefs.vibrationEnabled
  );

  // Mutable engine refs matching exact structure of the reference game (`g`, `busy`, `uid`, `score`, `moves`, `lv`, `goal`)
  const gridRef = useRef<(CandyTile | null)[][]>([]);
  const busyRef = useRef<boolean>(false);
  const uidRef = useRef<number>(1);
  const popupIdRef = useRef<number>(1);
  const scoreRef = useRef<number>(0);
  const challengerScoreRef = useRef<number>(0);
  const movesRef = useRef<number>(18);
  const levelRef = useRef<number>(level);
  const goalRef = useRef<number>(1100);
  const bestComboRef = useRef<number>(1);
  const selectedTileRef = useRef<CandyTile | null>(null);
  const pointerStartRef = useRef<{
    tile: CandyTile;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  const pushFloatingPopup = useCallback(
    (
      r: number,
      c: number,
      label: string,
      sublabel?: string,
      accent: "gold" | "kente" | "bomb" = "gold"
    ) => {
      const id = popupIdRef.current++;
      setFloatingPopups((prev) => [...prev.slice(-5), { id, r, c, label, sublabel, accent }]);
      window.setTimeout(() => {
        setFloatingPopups((prev) => prev.filter((p) => p.id !== id));
      }, 950);
    },
    []
  );

  const triggerBlastBeams = useCallback((beams: { kind: "h" | "v"; index: number }[]) => {
    if (!beams.length) return;
    const created = beams.map((b) => ({
      id: popupIdRef.current++,
      kind: b.kind,
      index: b.index,
    }));
    setBlastBeams((prev) => [...prev, ...created]);
    window.setTimeout(() => {
      const ids = new Set(created.map((c) => c.id));
      setBlastBeams((prev) => prev.filter((b) => !ids.has(b.id)));
    }, 420);
  }, []);

  const syncGridToReactState = useCallback(() => {
    const flat: CandyTile[] = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const t = gridRef.current[r]?.[c];
        if (t) flat.push({ ...t });
      }
    }
    setTiles(flat);
  }, []);

  const ok = (t: CandyTile | null | undefined): t is CandyTile =>
    Boolean(t && t.type >= 0);

  const findRuns = useCallback(() => {
    const g = gridRef.current;
    const runs: { d: "h" | "v"; t: CandyTile[] }[] = [];

    for (let r = 0; r < N; r++) {
      let s = 0;
      for (let c = 1; c <= N; c++) {
        if (
          !(
            c < N &&
            ok(g[r][c]) &&
            ok(g[r][s]) &&
            g[r][c]!.type === g[r][s]!.type
          )
        ) {
          if (c - s >= 3 && ok(g[r][s])) {
            runs.push({
              d: "h",
              t: g[r].slice(s, c).filter((x): x is CandyTile => Boolean(x)),
            });
          }
          s = c;
        }
      }
    }

    for (let c = 0; c < N; c++) {
      let s = 0;
      for (let r = 1; r <= N; r++) {
        if (
          !(
            r < N &&
            ok(g[r]?.[c]) &&
            ok(g[s]?.[c]) &&
            g[r]![c]!.type === g[s]![c]!.type
          )
        ) {
          if (r - s >= 3 && ok(g[s]?.[c])) {
            runs.push({
              d: "v",
              t: g
                .slice(s, r)
                .map((x) => x[c])
                .filter((x): x is CandyTile => Boolean(x)),
            });
          }
          s = r;
        }
      }
    }

    return runs;
  }, []);

  const rawMatch = useCallback(() => {
    const g = gridRef.current;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const cell = g[r]?.[c];
        if (!cell || cell.type < 0) continue;
        const t = cell.type;
        if (c < N - 2 && g[r][c + 1]?.type === t && g[r][c + 2]?.type === t)
          return true;
        if (
          r < N - 2 &&
          g[r + 1]?.[c]?.type === t &&
          g[r + 2]?.[c]?.type === t
        )
          return true;
      }
    }
    return false;
  }, []);

  const findMove = useCallback((): [CandyTile, CandyTile] | null => {
    const g = gridRef.current;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        for (const [dr, dc] of [
          [0, 1],
          [1, 0],
        ]) {
          const r2 = r + dr;
          const c2 = c + dc;
          if (r2 >= N || c2 >= N) continue;
          const a = g[r]?.[c];
          const b = g[r2]?.[c2];
          if (!a || !b) continue;
          g[r][c] = b;
          g[r2][c2] = a;
          const hit = rawMatch();
          g[r][c] = a;
          g[r2][c2] = b;
          if (hit || a.sp === "bomb" || b.sp === "bomb" || (a.sp && b.sp)) {
            return [a, b];
          }
        }
      }
    }
    return null;
  }, [rawMatch]);

  const reshuffle = useCallback(() => {
    const g = gridRef.current;
    const all = g.flat().filter((t): t is CandyTile => Boolean(t && t.type >= 0));
    if (all.length === 0) return;
    let safety = 0;
    do {
      const ty = all.map((t) => t.type);
      for (let i = ty.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ty[i], ty[j]] = [ty[j], ty[i]];
      }
      all.forEach((t, i) => {
        t.type = ty[i];
      });
      safety++;
    } while ((rawMatch() || !findMove()) && safety < 50);
    syncGridToReactState();
  }, [findMove, rawMatch, syncGridToReactState]);

  const initBoardForLevel = useCallback(
    (lv: number) => {
      const nextGoal = 700 + lv * 400;
      const nextMoves = Math.min(30, 17 + lv);
      const stage = getMarketStage(lv);
      levelRef.current = lv;
      goalRef.current = nextGoal;
      movesRef.current = nextMoves;
      scoreRef.current = 0;
      challengerScoreRef.current = 0;
      busyRef.current = false;
      selectedTileRef.current = null;

      setLevel(lv);
      setGoal(nextGoal);
      setMoves(nextMoves);
      setScore(0);
      setChallengerLiveScore(0);
      setSelectedId(null);
      setOverModal(null);
      setActiveComboBanner(null);
      setTimeRemainingSec(75);

      const newGrid: (CandyTile | null)[][] = [];
      for (let r = 0; r < N; r++) {
        newGrid[r] = [];
        for (let c = 0; c < N; c++) {
          let ty = 0;
          do {
            ty = Math.floor(Math.random() * TYPES);
          } while (
            (c > 1 &&
              newGrid[r][c - 1]?.type === ty &&
              newGrid[r][c - 2]?.type === ty) ||
            (r > 1 &&
              newGrid[r - 1][c]?.type === ty &&
              newGrid[r - 2][c]?.type === ty)
          );
          newGrid[r][c] = {
            id: uidRef.current++,
            type: ty,
            r,
            c,
            sp: null,
          };
        }
      }

      gridRef.current = newGrid;
      if (!findMove()) {
        reshuffle();
      } else {
        syncGridToReactState();
      }

      setStatusMsg(
        `${stage.market} (${stage.city}): Reach ${nextGoal.toLocaleString()} pts!`
      );
    },
    [findMove, reshuffle, syncGridToReactState]
  );

  useEffect(() => {
    initBoardForLevel(initialState?.creatorLevel || 1);
  }, [initBoardForLevel, initialState?.creatorLevel]);

  const clearSelectionAndHints = useCallback(() => {
    selectedTileRef.current = null;
    setSelectedId(null);
    let hadHint = false;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const t = gridRef.current[r]?.[c];
        if (t?.hint) {
          t.hint = false;
          hadHint = true;
        }
      }
    }
    if (hadHint) syncGridToReactState();
  }, [syncGridToReactState]);

  const swapCells = useCallback(
    (a: CandyTile, b: CandyTile) => {
      const g = gridRef.current;
      g[a.r][a.c] = b;
      g[b.r][b.c] = a;
      [a.r, b.r] = [b.r, a.r];
      [a.c, b.c] = [b.c, a.c];
      syncGridToReactState();
    },
    [syncGridToReactState]
  );

  const effect = useCallback((t: CandyTile, set: Set<CandyTile>) => {
    const g = gridRef.current;
    if (t.sp === "h") {
      for (let c = 0; c < N; c++) {
        const cell = g[t.r]?.[c];
        if (cell) set.add(cell);
      }
    }
    if (t.sp === "v") {
      for (let r = 0; r < N; r++) {
        const cell = g[r]?.[t.c];
        if (cell) set.add(cell);
      }
    }
  }, []);

  const resolve = useCallback(
    async (forced: Set<CandyTile>, pref: CandyTile[], usedBombSwap = false) => {
      const g = gridRef.current;
      let combo = 0;
      let first = true;
      let currentPref = [...pref];

      while (true) {
        const runs = findRuns();
        const set = new Set<CandyTile>(first ? forced : []);
        runs.forEach((x) => x.t.forEach((t) => set.add(t)));
        if (!set.size) break;

        combo++;
        if (combo > bestComboRef.current) {
          bestComboRef.current = combo;
        }

        const mk: [CandyTile, SpecialKind][] = [];
        runs.forEach((x) => {
          if (x.t.length >= 4) {
            const targetTile =
              x.t.find((q) => currentPref.includes(q)) || x.t[1];
            const specialKind: SpecialKind =
              x.t.length >= 5 ? "bomb" : x.d === "h" ? "v" : "h";
            mk.push([targetTile, specialKind]);
          }
        });

        mk.forEach((m) => set.delete(m[0]));

        // BFS propagate row/column blasts for any cleared Kente-striped sweets
        const seen = new Set<CandyTile>();
        const triggeredBeams: { kind: "h" | "v"; index: number }[] = [];
        const q = [...set];
        while (q.length) {
          const t = q.pop()!;
          if (seen.has(t)) continue;
          seen.add(t);
          if (t.sp === "h" || t.sp === "v") {
            triggeredBeams.push({
              kind: t.sp,
              index: t.sp === "h" ? t.r : t.c,
            });
            const e = new Set<CandyTile>();
            effect(t, e);
            e.forEach((x) => {
              if (!set.has(x)) {
                set.add(x);
                q.push(x);
              }
            });
          }
        }

        if (triggeredBeams.length > 0) {
          triggerBlastBeams(triggeredBeams);
        }

        const specialCountInSet = [...set].filter((t) => Boolean(t.sp)).length;
        const bonus = seen.size ? specialCountInSet * 60 : 0;
        const pts = set.size * 10 * combo + bonus + mk.length * 40;

        scoreRef.current += pts;
        setScore(scoreRef.current);
        playCandyPopSound(combo);

        // Pick center tile of match for floating score popup
        const sampleTiles = [...set];
        const anchor = sampleTiles[Math.floor(sampleTiles.length / 2)] || pref[0];
        if (anchor) {
          if (first && usedBombSwap) {
            pushFloatingPopup(anchor.r, anchor.c, `+${pts}`, "💥 COCOA BOMB!", "bomb");
          } else if (triggeredBeams.length > 0) {
            pushFloatingPopup(anchor.r, anchor.c, `+${pts}`, "🇬🇭 KENTE BLAST!", "kente");
          } else if (combo >= 2) {
            pushFloatingPopup(
              anchor.r,
              anchor.c,
              `+${pts}`,
              combo >= 3 ? `🔥 x${combo} CHALE!` : `⚡ x${combo} SWEET!`,
              "gold"
            );
          } else {
            pushFloatingPopup(anchor.r, anchor.c, `+${pts}`);
          }
        }

        if (first && usedBombSwap) {
          setStatusMsg(`💥 Takoradi Calabash Cocoa Bomb Detonated! +${pts} pts`);
          setActiveComboBanner("💥 CALABASH COCOA BOMB!");
        } else if (mk.some(([, sp]) => sp === "bomb")) {
          setStatusMsg(`🍫 5-Match! Forged a Calabash Cocoa Bomb (+${pts} pts)`);
          setActiveComboBanner("🍫 COCOA BOMB FORGED!");
        } else if (mk.length > 0) {
          setStatusMsg(`🇬🇭 4-Match! Forged a Kente-Striped Sweet (+${pts} pts)`);
          setActiveComboBanner("🇬🇭 KENTE BOOSTER!");
        } else if (combo >= 3) {
          setStatusMsg(`🔥 Eiii! Heavy Makola Cascade x${combo}! +${pts} pts`);
          setActiveComboBanner(`🔥 x${combo} MAKOLA CASCADE!`);
          onPointsEarned?.(4, `Alewa & Kube ${combo}x Cascade (+4 pts)!`);
        } else if (combo === 2) {
          setStatusMsg(`⚡ Chale! Double Sweet Combo x2! +${pts} pts`);
          setActiveComboBanner("⚡ x2 DOUBLE SWEET!");
        } else if (bonus > 0) {
          setStatusMsg(`🇬🇭 Kente Row/Column Blast! +${pts} pts`);
        } else {
          const matchedType = sampleTiles[0]?.type ?? 0;
          const sweetMeta = GHANA_SWEETS[((matchedType % TYPES) + TYPES) % TYPES];
          setStatusMsg(`✨ Sweet Pass! ${sweetMeta.name} match +${pts} pts`);
        }

        // Mark matched tiles as popping and transform newly created specials
        set.forEach((t) => {
          t.popping = true;
        });
        mk.forEach(([t, sp]) => {
          if (set.has(t)) return;
          t.sp = sp;
          if (sp === "bomb") t.type = -1;
          t.born = true;
        });
        syncGridToReactState();

        await sleep(250);

        // Remove popped tiles and drop surviving sweets down each column
        set.forEach((t) => {
          if (g[t.r]?.[t.c]?.id === t.id) {
            g[t.r][t.c] = null;
          }
        });
        mk.forEach(([t]) => {
          t.born = false;
        });

        for (let c = 0; c < N; c++) {
          let w = N - 1;
          for (let r = N - 1; r >= 0; r--) {
            if (g[r][c]) {
              const t = g[r][c]!;
              g[r][c] = null;
              g[w][c] = t;
              t.r = w;
              w--;
            }
          }
          for (let r = w; r >= 0; r--) {
            g[r][c] = {
              id: uidRef.current++,
              type: Math.floor(Math.random() * TYPES),
              r,
              c,
              sp: null,
              born: true,
            };
          }
        }

        syncGridToReactState();
        await sleep(350);

        // Clear born flags
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            if (g[r]?.[c]?.born) g[r]![c]!.born = false;
          }
        }

        first = false;
        currentPref = [];
      }

      window.setTimeout(() => setActiveComboBanner(null), 900);
    },
    [
      effect,
      findRuns,
      onPointsEarned,
      pushFloatingPopup,
      syncGridToReactState,
      triggerBlastBeams,
    ]
  );

  const finishLevel = useCallback(
    (win: boolean, timedOut = false) => {
      const currentScore = scoreRef.current;
      const currentGoal = goalRef.current;
      const currentMoves = movesRef.current;
      const currentLv = levelRef.current;

      if (currentScore > bestScore) {
        setBestScore(currentScore);
        try {
          localStorage.setItem("candycrash-best", String(currentScore));
        } catch {
          // ignore storage quota
        }
      }

      const stars = win ? (currentMoves >= 8 ? 3 : currentMoves >= 4 ? 2 : 1) : 0;
      if (win && !timedOut) {
        playLevelUpFanfare();
        triggerHapticSensor("victory");
        onPointsEarned?.(
          35,
          `Cleared ${getMarketStage(currentLv).market} Timed Rush (${stars}★)`
        );
      }

      const finalChallengerScore = win
        ? Math.min(currentScore - 20, Math.max(challengerScoreRef.current, Math.round(currentGoal * 0.91)))
        : Math.max(challengerScoreRef.current, Math.round(currentGoal * 0.96));

      const nextState: CandyCrashState = {
        creatorScore: currentScore,
        opponentScore: finalChallengerScore,
        creatorLevel: win ? currentLv + 1 : currentLv,
        creatorBestCombo: bestComboRef.current,
        creatorStars: stars,
        creatorFinished: true,
        opponentFinished: true,
        turn: "creator",
        winner: win ? mySide : "opponent",
        moveCount: (initialState?.moveCount || 0) + 1,
      };
      onStateChange?.(nextState);
      if (win) {
        onMatchComplete?.(mySide, nextState);
      } else if (timedOut) {
        const otherSide = mySide === "creator" ? "opponent" : "creator";
        onMatchComplete?.(otherSide, nextState);
      }

      busyRef.current = true;
      window.setTimeout(() => {
        setOverModal({
          win,
          timedOut,
          stars,
          finalScore: currentScore,
          challengerScore: finalChallengerScore,
          goalNeeded: currentGoal,
          levelNum: currentLv,
        });
      }, 420);
    },
    [
      bestScore,
      initialState?.moveCount,
      mySide,
      onMatchComplete,
      onPointsEarned,
      onStateChange,
    ]
  );

  // 75-Second Rush Countdown Timer per Level
  useEffect(() => {
    if (overModal) return;
    const timer = window.setInterval(() => {
      setTimeRemainingSec((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          setStatusMsg("⏱️ 75-Second Sweet Rush Clock Expired!");
          finishLevel(false, true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [overModal, level, finishLevel]);

  const trySwap = useCallback(
    async (a: CandyTile, b: CandyTile) => {
      if (busyRef.current || movesRef.current <= 0) return;
      busyRef.current = true;
      clearSelectionAndHints();

      swapCells(a, b);
      await sleep(210);

      let forced = new Set<CandyTile>();
      let usedBombSwap = false;
      const g = gridRef.current;

      if (a.sp === "bomb" || b.sp === "bomb") {
        usedBombSwap = true;
        const bm = a.sp === "bomb" ? a : b;
        const o = bm === a ? b : a;
        forced.add(bm);
        g.flat().forEach((t) => {
          if (t && (o.sp === "bomb" || t.type === o.type)) {
            forced.add(t);
          }
        });
      } else if (a.sp && b.sp) {
        a.sp = "h";
        b.sp = "v";
        forced = new Set<CandyTile>([a, b]);
      }

      if (!forced.size && !findRuns().length) {
        swapCells(a, b);
        await sleep(210);
        setStatusMsg("No sweet match there — try another swap!");
        busyRef.current = false;
        return;
      }

      movesRef.current -= 1;
      setMoves(movesRef.current);

      // Advance Auntie Efua / Challenger live score pace per turn
      const totalMovesForLv = Math.min(30, 17 + levelRef.current);
      const avgNeededPerMove = (goalRef.current * 0.9) / Math.max(1, totalMovesForLv);
      const challengerStep = Math.round(avgNeededPerMove * (0.78 + Math.random() * 0.38));
      challengerScoreRef.current = Math.min(
        Math.round(goalRef.current * 0.96),
        challengerScoreRef.current + challengerStep
      );
      setChallengerLiveScore(challengerScoreRef.current);

      await resolve(forced, [a, b], usedBombSwap);

      if (scoreRef.current >= goalRef.current) {
        finishLevel(true);
        return;
      }
      if (movesRef.current <= 0) {
        finishLevel(false);
        return;
      }
      if (!findMove()) {
        setStatusMsg("No moves left on the tray — reshuffling sweets…");
        await sleep(480);
        reshuffle();
      }
      busyRef.current = false;
    },
    [clearSelectionAndHints, findMove, findRuns, finishLevel, reshuffle, resolve, swapCells]
  );

  const handleTilePointerDown = (
    tile: CandyTile,
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    if (busyRef.current || overModal) return;
    pointerStartRef.current = {
      tile,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
  };

  const handleBoardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    if (!start || start.moved || busyRef.current) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;

    start.moved = true;
    const t = start.tile;
    let r = t.r;
    let c = t.c;
    if (Math.abs(dx) > Math.abs(dy)) {
      c += dx > 0 ? 1 : -1;
    } else {
      r += dy > 0 ? 1 : -1;
    }

    const neighbor = gridRef.current[r]?.[c];
    if (r >= 0 && r < N && c >= 0 && c < N && neighbor) {
      trySwap(t, neighbor);
    }
  };

  const handleBoardPointerUp = () => {
    const s = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!s || s.moved || busyRef.current) return;

    const currentSel = selectedTileRef.current;
    if (!currentSel) {
      selectedTileRef.current = s.tile;
      setSelectedId(s.tile.id);
    } else if (currentSel.id === s.tile.id) {
      clearSelectionAndHints();
    } else if (
      Math.abs(currentSel.r - s.tile.r) + Math.abs(currentSel.c - s.tile.c) === 1
    ) {
      trySwap(currentSel, s.tile);
    } else {
      selectedTileRef.current = s.tile;
      setSelectedId(s.tile.id);
    }
  };

  const handleHintClick = () => {
    if (busyRef.current || overModal) return;
    clearSelectionAndHints();
    const pair = findMove();
    if (pair) {
      pair.forEach((t) => {
        t.hint = true;
      });
      syncGridToReactState();
      const sweetName =
        pair[0].type >= 0
          ? GHANA_SWEETS[pair[0].type % TYPES]?.shortName || "sweet"
          : "Cocoa Bomb";
      setStatusMsg(`💡 Hint: Swap the pulsing ${sweetName} tiles!`);
      triggerHapticSensor("aim_tick");
    }
  };

  const progressPct = Math.min(100, Math.round((score / Math.max(1, goal)) * 100));
  const challengerPct = Math.min(
    100,
    Math.round((challengerLiveScore / Math.max(1, goal)) * 100)
  );
  const currentStage = getMarketStage(level);

  return (
    <div className="max-w-lg mx-auto space-y-1.5 sm:space-y-2 select-none">
      {/* Shared SVG Radial Gradients & ClipPaths for 3D Ghanaian Sweets */}
      <svg width="0" height="0" className="absolute pointer-events-none" aria-hidden="true">
        <defs>
          {GHANA_SWEETS.map((sweet, i) => (
            <React.Fragment key={sweet.id}>
              <radialGradient id={`candy-g${i}`} cx=".35" cy=".3" r=".85">
                <stop offset="0" stopColor={sweet.colors[0]} />
                <stop offset=".55" stopColor={sweet.colors[1]} />
                <stop offset="1" stopColor={sweet.colors[2]} />
              </radialGradient>
              <clipPath id={`candy-c${i}`}>{renderCandyBaseShape(i)}</clipPath>
            </React.Fragment>
          ))}
          <radialGradient id="candy-gb" cx=".35" cy=".3" r=".85">
            <stop offset="0" stopColor="#a16207" />
            <stop offset=".55" stopColor="#451a03" />
            <stop offset="1" stopColor="#1c0a00" />
          </radialGradient>
        </defs>
      </svg>

      {/* ── Compact Kente-Accented Top Header ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#3b1507]/95 via-[#280e04]/95 to-[#1a0802]/95 border border-amber-500/40 shadow-lg">
        {/* Authentic Ghana Kente Top Stripe */}
        <div
          className="h-1 w-full"
          style={{
            background:
              "repeating-linear-gradient(90deg, #ef4444 0px 18px, #facc15 18px 36px, #22c55e 36px 54px, #111827 54px 60px)",
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-1.5 px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {onBackToLobby && (
              <button
                type="button"
                onClick={onBackToLobby}
                className="px-2 py-1 rounded-full bg-white/10 hover:bg-white/15 text-[11px] font-bold text-amber-100 flex items-center gap-0.5 cursor-pointer shrink-0"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Games
              </button>
            )}
            <Badge className="bg-gradient-to-r from-amber-400 via-orange-400 to-rose-500 text-slate-950 font-black text-[10px] px-2 py-0.5 shrink-0">
              🍬 ALEWA &amp; KUBE CRUSH
            </Badge>
            <span className="text-[10px] font-bold text-amber-200/90 truncate hidden sm:inline">
              • {currentStage.market}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <span
              title={`Auto-fitted for ${screenFit.deviceModelHint} (${candyFit.squareBoardSizePx}×${candyFit.squareBoardSizePx}px tray)`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-400/35 text-[9px] font-mono font-bold text-amber-200"
            >
              📱 {candyFit.fitSummaryLabel}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowRules((v) => !v)}
              className="h-6 px-1.5 text-[10px] text-amber-200 hover:text-white gap-1"
            >
              <HelpCircle className="w-3 h-3" />
              {showRules ? "Hide" : "Guide"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const next = !vibrationEnabled;
                setVibrationEnabled(next);
                setGameSensoryPreferences({ vibrationEnabled: next });
                if (next) triggerHapticSensor("aim_tick");
              }}
              className={`h-6 px-1 text-xs ${
                vibrationEnabled ? "text-emerald-300" : "text-slate-500"
              }`}
              title="Toggle Vibration"
            >
              <Smartphone className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const nextMuted = !muted;
                setMuted(nextMuted);
                setGameSensoryPreferences({ soundEnabled: !nextMuted });
              }}
              className="h-6 w-6 p-0 text-amber-300"
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      </div>

      {showRules && (
        <div className="p-2.5 rounded-xl bg-[#260e05]/95 border border-amber-500/40 text-[11px] text-amber-100 space-y-1">
          <p className="font-black text-amber-300">
            🇬🇭 Alewa &amp; Kube Crush — Ghanaian Sweet Tray Rules:
          </p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>
              Swipe or tap two adjacent sweets (*Alewa*, *Kube*, *Golden Cocoa Pod*, *Nkate Cake*, *Sobolo*, *Bofrot*) to match <strong>3 or more</strong>.
            </li>
            <li>
              Match <strong>4 sweets</strong> to wrap a <strong>Kente-Striped Booster</strong> that blasts a full row or column!
            </li>
            <li>
              Match <strong>5 sweets</strong> to forge a <strong>Takoradi Calabash Cocoa Bomb</strong> — swap it with any sweet to clear every sweet of that type on the tray!
            </li>
          </ul>
        </div>
      )}

      {/* ── 4 Stat Pills + Head-to-Head Challenger Race Bar ── */}
      <div className="space-y-1">
        <div className="grid grid-cols-4 gap-1.5">
          <div className="rounded-xl bg-[#2a1207]/90 border border-amber-500/25 py-1 px-1.5 text-center">
            <span className="block text-[8px] uppercase font-bold text-amber-200/75 truncate">
              {currentStage.city} Lv
            </span>
            <strong className="text-sm sm:text-base font-black text-white font-mono">
              {level}
            </strong>
          </div>
          <div className="rounded-xl bg-[#2a1207]/90 border border-amber-500/25 py-1 px-1.5 text-center">
            <span className="block text-[8px] uppercase font-bold text-amber-200/75">
              Your Score
            </span>
            <strong className="text-sm sm:text-base font-black text-amber-300 font-mono">
              {score.toLocaleString()}
            </strong>
          </div>
          <div className="rounded-xl bg-[#2a1207]/90 border border-amber-500/25 py-1 px-1.5 text-center">
            <span className="block text-[8px] uppercase font-bold text-amber-200/75">
              Moves Left
            </span>
            <strong
              className={`text-sm sm:text-base font-black font-mono ${
                moves <= 5 ? "text-rose-400 animate-pulse" : "text-emerald-300"
              }`}
            >
              {moves}
            </strong>
          </div>
          <div className="rounded-xl bg-[#2a1207]/90 border border-amber-500/25 py-1 px-1.5 text-center">
            <span className="block text-[8px] uppercase font-bold text-amber-200/75">
              ⏱️ Rush Clock
            </span>
            <strong
              className={`text-sm sm:text-base font-black font-mono ${
                timeRemainingSec <= 15
                  ? "text-rose-400 animate-pulse"
                  : "text-amber-300"
              }`}
            >
              {Math.floor(timeRemainingSec / 60)}:
              {String(timeRemainingSec % 60).padStart(2, "0")}
            </strong>
          </div>
        </div>

        {/* Dual Progress Race Bar: You vs Challenger toward Market Target */}
        <div className="px-2 py-1 rounded-xl bg-[#1f0d05]/90 border border-amber-500/20 space-y-1">
          <div className="flex items-center justify-between text-[10px] font-bold">
            <span className="text-amber-100 truncate">
              🎯 <strong className="text-amber-300">{currentStage.market}</strong> Goal:{" "}
              <strong className="text-white">{goal.toLocaleString()} pts</strong> ({progressPct}%)
            </span>
            <span className="text-emerald-300 font-mono shrink-0">
              vs {effectiveOpponentName.split(" ")[0]}: {challengerLiveScore.toLocaleString()} pts
            </span>
          </div>
          <div className="relative h-2.5 rounded-full bg-black/50 overflow-hidden border border-white/10">
            {/* Challenger Ghost Marker Bar */}
            <div
              className="absolute inset-y-0 left-0 bg-rose-500/35 transition-all duration-300"
              style={{ width: `${challengerPct}%` }}
            />
            {/* Player Kente Gold-Green Progress Bar */}
            <div
              className="relative h-full rounded-full bg-gradient-to-r from-red-500 via-amber-400 to-emerald-400 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── 8×8 Carved Ghanaian Mahogany Sweet Tray (100% Fitted to Device Screen) ── */}
      <div
        style={{
          width: `${candyFit.squareBoardSizePx}px`,
          height: `${candyFit.squareBoardSizePx}px`,
        }}
        onPointerMove={handleBoardPointerMove}
        onPointerUp={handleBoardPointerUp}
        onPointerCancel={handleBoardPointerUp}
        className="relative mx-auto rounded-3xl p-1.5 sm:p-2 bg-gradient-to-b from-[#6b3410] via-[#451f08] to-[#260e03] border-2 border-amber-400/50 shadow-[0_16px_45px_rgba(0,0,0,0.8),inset_0_2px_8px_rgba(254,243,199,0.22)] touch-none select-none overflow-hidden"
      >
        {/* Active Cascade Combo Floating Banner */}
        {activeComboBanner && (
          <div className="pointer-events-none absolute top-2.5 left-1/2 -translate-x-1/2 z-30 px-3 py-0.5 rounded-full bg-gradient-to-r from-red-600 via-amber-400 to-emerald-500 text-slate-950 font-black text-[11px] shadow-xl animate-bounce whitespace-nowrap">
            {activeComboBanner}
          </div>
        )}

        <div
          role="application"
          aria-label="Alewa and Kube Crush 8x8 Ghanaian Sweet Tray"
          className="relative w-full h-full rounded-2xl overflow-hidden border border-amber-300/20"
          style={{
            backgroundColor: "#1d0c04",
            backgroundImage:
              "conic-gradient(rgba(251,191,36,0.09) 25%, rgba(0,0,0,0.18) 0 50%, rgba(251,191,36,0.09) 0 75%, rgba(0,0,0,0.18) 0)",
            backgroundSize: "25% 25%",
          }}
        >
          {/* Kente Row / Column Blast Beams */}
          {blastBeams.map((beam) =>
            beam.kind === "h" ? (
              <div
                key={beam.id}
                style={{ top: `${beam.index * 12.5}%`, height: "12.5%" }}
                className="pointer-events-none absolute inset-x-0 z-20 bg-gradient-to-r from-red-500/75 via-amber-300/90 to-emerald-500/75 animate-pulse"
              />
            ) : (
              <div
                key={beam.id}
                style={{ left: `${beam.index * 12.5}%`, width: "12.5%" }}
                className="pointer-events-none absolute inset-y-0 z-20 bg-gradient-to-b from-red-500/75 via-amber-300/90 to-emerald-500/75 animate-pulse"
              />
            )
          )}

          {/* 64 Ghanaian Sweet Tiles */}
          {tiles.map((t) => {
            const isSelected = selectedId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onPointerDown={(e) => handleTilePointerDown(t, e)}
                style={{
                  left: `${t.c * 12.5}%`,
                  top: `${t.r * 12.5}%`,
                  width: "12.5%",
                  height: "12.5%",
                  padding: "2.4%",
                  transition:
                    "top 0.28s cubic-bezier(0.4, 1.5, 0.6, 1), left 0.2s ease, transform 0.22s, opacity 0.22s",
                }}
                className={`absolute cursor-pointer focus:outline-none ${
                  isSelected
                    ? "scale-115 z-20 ring-2 ring-amber-300 rounded-xl bg-amber-400/20 animate-pulse"
                    : ""
                } ${t.popping ? "scale-150 opacity-0" : ""} ${
                  t.born ? "scale-105" : ""
                } ${
                  t.hint
                    ? "ring-2 ring-emerald-300 rounded-xl bg-emerald-400/25 animate-bounce z-10"
                    : ""
                }`}
              >
                <CandyTileSvg type={t.type} sp={t.sp} />
              </button>
            );
          })}

          {/* Floating Score & Ghanaian Hype Popups */}
          {floatingPopups.map((pop) => (
            <div
              key={pop.id}
              style={{
                left: `${Math.min(82, Math.max(8, pop.c * 12.5 + 6))}%`,
                top: `${Math.min(82, Math.max(8, pop.r * 12.5))}%`,
              }}
              className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-2 flex flex-col items-center animate-bounce"
            >
              {pop.sublabel && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[8px] font-black uppercase shadow ${
                    pop.accent === "bomb"
                      ? "bg-amber-400 text-slate-950"
                      : pop.accent === "kente"
                      ? "bg-emerald-400 text-slate-950"
                      : "bg-rose-500 text-white"
                  }`}
                >
                  {pop.sublabel}
                </span>
              )}
              <span className="text-xs sm:text-sm font-black text-amber-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)] font-mono">
                {pop.label}
              </span>
            </div>
          ))}
        </div>

        {/* ── Level Complete / Out of Moves Overlay ── */}
        {overModal && (
          <div className="absolute inset-0 z-30 rounded-3xl bg-[#1c0903]/95 backdrop-blur-md flex flex-col items-center justify-center p-5 text-center space-y-2.5 animate-in fade-in duration-200">
            <Badge
              className={
                overModal.win
                  ? "bg-emerald-500 text-slate-950 font-black text-xs px-3 py-1"
                  : "bg-rose-500/20 text-rose-300 border border-rose-400/40 font-black text-xs px-3 py-1"
              }
            >
              {overModal.win
                ? `🇬🇭 ${getMarketStage(overModal.levelNum).market.toUpperCase()} CLEARED!`
                : "⏳ OUT OF MOVES ON THE TRAY"}
            </Badge>

            <h2 className="text-xl sm:text-2xl font-black text-white">
              {overModal.win
                ? `Chale! Sweet Victory, ${creatorName}!`
                : `${effectiveOpponentName} Took This Round!`}
            </h2>

            {overModal.win && (
              <div className="text-3xl tracking-widest text-amber-400 drop-shadow">
                {"★".repeat(overModal.stars)}
                {"☆".repeat(3 - overModal.stars)}
              </div>
            )}

            <div className="w-full max-w-xs rounded-2xl bg-white/5 border border-amber-500/30 p-2.5 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-amber-100 font-bold">Your Tray Score:</span>
                <strong className="text-amber-300 font-mono">
                  {overModal.finalScore.toLocaleString()} pts
                </strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300 font-bold">{effectiveOpponentName}:</span>
                <strong className="text-emerald-300 font-mono">
                  {overModal.challengerScore.toLocaleString()} pts
                </strong>
              </div>
              <div className="flex items-center justify-between border-t border-white/10 pt-1">
                <span className="text-slate-400">Market Target:</span>
                <span className="font-mono text-white">
                  {overModal.goalNeeded.toLocaleString()} pts
                </span>
              </div>
            </div>

            <Button
              type="button"
              onClick={() => {
                const nextLv = overModal.win ? overModal.levelNum + 1 : overModal.levelNum;
                initBoardForLevel(nextLv);
              }}
              className="h-10 px-7 rounded-full bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500 hover:from-amber-300 hover:to-rose-400 text-slate-950 font-black text-sm shadow-xl"
            >
              {overModal.win
                ? `Next Stall: ${getMarketStage(overModal.levelNum + 1).market} →`
                : "Try Market Tray Again"}
            </Button>
          </div>
        )}
      </div>

      {/* ── Ghanaian Sweet Legend Strip + Bottom Controls ── */}
      <div className="space-y-1">
        {/* 6 Local Sweets + Booster Legend */}
        <div className="flex items-center justify-between gap-1 px-2 py-1 rounded-xl bg-[#220d04]/90 border border-amber-500/20 overflow-x-auto no-scrollbar">
          {GHANA_SWEETS.map((sw) => (
            <div
              key={sw.id}
              className="flex items-center gap-1 shrink-0"
              title={`${sw.name}: ${sw.localNote}`}
            >
              <span className="w-4 h-4 inline-block shrink-0">
                <CandyTileSvg type={sw.id} sp={null} />
              </span>
              <span className="text-[9px] font-bold text-amber-100/90">{sw.shortName}</span>
            </div>
          ))}
          <span className="text-[9px] font-black text-emerald-300 shrink-0 pl-1 border-l border-white/10">
            4=🇬🇭Kente • 5=🍫Bomb
          </span>
        </div>

        <p className="min-h-[1.1rem] text-center text-[11px] font-bold text-amber-200/95 truncate px-2">
          {statusMsg}
        </p>

        <div className="grid grid-cols-3 gap-1.5">
          <Button
            type="button"
            variant="outline"
            onClick={handleHintClick}
            className="h-8 rounded-2xl border-amber-400/35 bg-[#2a1207]/90 hover:bg-[#3b1909] text-amber-100 font-black text-xs gap-1"
          >
            <Lightbulb className="w-3.5 h-3.5 text-amber-300" />
            Hint
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const nextMuted = !muted;
              setMuted(nextMuted);
              setGameSensoryPreferences({ soundEnabled: !nextMuted });
            }}
            className="h-8 rounded-2xl border-amber-400/35 bg-[#2a1207]/90 hover:bg-[#3b1909] text-amber-100 font-black text-xs gap-1"
          >
            {muted ? (
              <VolumeX className="w-3.5 h-3.5" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-emerald-300" />
            )}
            Sound: {muted ? "Off" : "On"}
          </Button>

          <Button
            type="button"
            onClick={() => initBoardForLevel(level)}
            className="h-8 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500 hover:from-amber-300 hover:to-rose-400 text-slate-950 font-black text-xs gap-1 shadow-md"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Fresh Tray
          </Button>
        </div>
      </div>
    </div>
  );
}

export default CandyCrashBoard;
