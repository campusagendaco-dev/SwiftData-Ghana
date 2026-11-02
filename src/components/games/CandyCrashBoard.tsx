import React, { useState, useEffect, useRef, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Volume2,
  VolumeX,
  Smartphone,
  RotateCcw,
  Lightbulb,
  Trophy,
  ChevronLeft,
  HelpCircle,
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
  type: number; // 0..5, or -1 for chocolate sprinkle bomb
  r: number;
  c: number;
  sp: SpecialKind;
  popping?: boolean;
  born?: boolean;
  hint?: boolean;
}

const N = 8;
const TYPES = 6;

const COL: [string, string, string][] = [
  ["#ff9fb0", "#ff2e55", "#9c0f2c"], // 0: Ruby Capsule
  ["#ffc873", "#ff8a00", "#a84300"], // 1: Amber Sphere
  ["#fff9b0", "#ffd60a", "#b88400"], // 2: Gold Teardrop
  ["#a6f7c0", "#22c55e", "#0a6e31"], // 3: Emerald Cushion
  ["#a8d4ff", "#2f7bff", "#103c9c"], // 4: Sapphire Hexagon
  ["#e6bcff", "#a64dff", "#58199f"], // 5: Amethyst Diamond
];

const BOMB_SPRINKLES = [
  "#ff2e55",
  "#ffd60a",
  "#22c55e",
  "#2f7bff",
  "#ff8a00",
  "#a64dff",
];

function renderCandyShape(typeIndex: number) {
  switch (typeIndex) {
    case 0:
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
      return <circle cx="50" cy="50" r="38" />;
    case 2:
      return (
        <path d="M50 10C76 10 90 38 90 56C90 80 70 90 50 90C30 90 10 80 10 56C10 38 24 10 50 10Z" />
      );
    case 3:
      return <rect x="14" y="14" width="72" height="72" rx="18" />;
    case 4:
      return (
        <path
          d="M50 10L86 31V69L50 90L14 69V31Z"
          strokeLinejoin="round"
          strokeWidth="10"
        />
      );
    default:
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

function CandyTileSvg({ type, sp }: { type: number; sp: SpecialKind }) {
  const gloss = (
    <>
      <ellipse
        cx="34"
        cy="28"
        rx="17"
        ry="9"
        fill="#fff"
        opacity=".6"
        transform="rotate(-30 34 28)"
      />
      <circle cx="64" cy="72" r="4" fill="#fff" opacity=".35" />
    </>
  );

  if (sp === "bomb" || type < 0) {
    return (
      <svg viewBox="0 0 100 100" className="w-full h-full block drop-shadow-[0_3px_2px_rgba(0,0,0,0.4)]">
        <circle cx="50" cy="50" r="40" fill="url(#candy-gb)" stroke="#1f0f08" strokeWidth="3" />
        {BOMB_SPRINKLES.map((c, i) => (
          <rect
            key={i}
            x={24 + ((i * 37) % 52)}
            y={22 + ((i * 29) % 50)}
            width="14"
            height="6"
            rx="3"
            fill={c}
            transform={`rotate(${i * 50} ${30 + i * 8} ${28 + i * 7})`}
          />
        ))}
        {gloss}
      </svg>
    );
  }

  const safeType = ((type % TYPES) + TYPES) % TYPES;
  const strokeColor = COL[safeType][2];

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full block drop-shadow-[0_3px_2px_rgba(0,0,0,0.4)]">
      <g
        fill={`url(#candy-g${safeType})`}
        stroke={strokeColor}
        strokeWidth={safeType === 4 ? 10 : 4}
        strokeLinejoin="round"
      >
        {renderCandyShape(safeType)}
      </g>
      {(sp === "h" || sp === "v") && (
        <g clipPath={`url(#candy-c${safeType})`}>
          {[20, 42, 64].map((p) =>
            sp === "h" ? (
              <rect key={p} x="0" y={p} width="100" height="11" fill="#fff" opacity=".82" />
            ) : (
              <rect key={p} x={p} y="0" width="11" height="100" fill="#fff" opacity=".82" />
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
    "Reach 1,100 points. Match 4 for a striped candy, 5 for a chocolate sprinkle bomb."
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showRules, setShowRules] = useState<boolean>(false);
  const [tiles, setTiles] = useState<CandyTile[]>([]);
  const [overModal, setOverModal] = useState<{
    win: boolean;
    stars: number;
    finalScore: number;
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
  const scoreRef = useRef<number>(0);
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
      levelRef.current = lv;
      goalRef.current = nextGoal;
      movesRef.current = nextMoves;
      scoreRef.current = 0;
      busyRef.current = false;
      selectedTileRef.current = null;

      setLevel(lv);
      setGoal(nextGoal);
      setMoves(nextMoves);
      setScore(0);
      setSelectedId(null);
      setOverModal(null);

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
        `Reach ${nextGoal.toLocaleString()} points. Match 4 for a striped candy, 5 for a chocolate sprinkle bomb.`
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
    async (forced: Set<CandyTile>, pref: CandyTile[]) => {
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

        // BFS propagate row/column blasts for any cleared striped candies
        const seen = new Set<CandyTile>();
        const q = [...set];
        while (q.length) {
          const t = q.pop()!;
          if (seen.has(t)) continue;
          seen.add(t);
          if (t.sp === "h" || t.sp === "v") {
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

        const specialCountInSet = [...set].filter((t) => Boolean(t.sp)).length;
        const bonus = seen.size ? specialCountInSet * 60 : 0;
        const pts = set.size * 10 * combo + bonus + mk.length * 40;

        scoreRef.current += pts;
        setScore(scoreRef.current);
        playCandyPopSound(combo);

        if (combo > 1) {
          setStatusMsg(`🔥 Combo x${combo}! +${pts} pts`);
          if (combo >= 3) {
            onPointsEarned?.(combo * 15, `Candy Crash ${combo}x Cascade Combo!`);
          }
        } else if (bonus > 0) {
          setStatusMsg(`✨ Special Candy Blast! +${pts} pts`);
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

        // Remove popped tiles and drop surviving candies down each column
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
        await sleep(360);

        // Clear born flags
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            if (g[r]?.[c]?.born) g[r]![c]!.born = false;
          }
        }

        first = false;
        currentPref = [];
      }
    },
    [effect, findRuns, onPointsEarned, syncGridToReactState]
  );

  const finishLevel = useCallback(
    (win: boolean) => {
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
      if (win) {
        playLevelUpFanfare();
        triggerHapticSensor("victory");
        onPointsEarned?.(
          150 + stars * 50,
          `Cleared Candy Crash Level ${currentLv} (${stars}★)`
        );
      }

      const aiScore = Math.round(currentGoal * (0.88 + Math.min(0.1, playerLevel * 0.01)));
      const nextState: CandyCrashState = {
        creatorScore: currentScore,
        opponentScore: aiScore,
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
      }

      busyRef.current = true;
      window.setTimeout(() => {
        setOverModal({
          win,
          stars,
          finalScore: currentScore,
          goalNeeded: currentGoal,
          levelNum: currentLv,
        });
      }, 450);
    },
    [bestScore, initialState?.moveCount, mySide, onMatchComplete, onPointsEarned, onStateChange, playerLevel]
  );

  const trySwap = useCallback(
    async (a: CandyTile, b: CandyTile) => {
      if (busyRef.current || movesRef.current <= 0) return;
      busyRef.current = true;
      clearSelectionAndHints();

      swapCells(a, b);
      await sleep(210);

      let forced = new Set<CandyTile>();
      const g = gridRef.current;

      if (a.sp === "bomb" || b.sp === "bomb") {
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
        setStatusMsg("No match there. Try another swap.");
        busyRef.current = false;
        return;
      }

      movesRef.current -= 1;
      setMoves(movesRef.current);
      setStatusMsg("");

      await resolve(forced, [a, b]);

      if (scoreRef.current >= goalRef.current) {
        finishLevel(true);
        return;
      }
      if (movesRef.current <= 0) {
        finishLevel(false);
        return;
      }
      if (!findMove()) {
        setStatusMsg("No moves left, reshuffling…");
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
      setStatusMsg("💡 Try swapping the pulsing candies!");
      triggerHapticSensor("aim_tick");
    }
  };

  const progressPct = Math.min(100, Math.round((score / Math.max(1, goal)) * 100));

  return (
    <div className="max-w-lg mx-auto space-y-2 sm:space-y-2.5 select-none">
      {/* Shared SVG Radial Gradients & ClipPaths for Glossy 3D Candies */}
      <svg width="0" height="0" className="absolute pointer-events-none" aria-hidden="true">
        <defs>
          {COL.map((c, i) => (
            <React.Fragment key={i}>
              <radialGradient id={`candy-g${i}`} cx=".35" cy=".3" r=".85">
                <stop offset="0" stopColor={c[0]} />
                <stop offset=".55" stopColor={c[1]} />
                <stop offset="1" stopColor={c[2]} />
              </radialGradient>
              <clipPath id={`candy-c${i}`}>{renderCandyShape(i)}</clipPath>
            </React.Fragment>
          ))}
          <radialGradient id="candy-gb" cx=".35" cy=".3" r=".85">
            <stop offset="0" stopColor="#9a6a4a" />
            <stop offset=".6" stopColor="#4a2a1a" />
            <stop offset="1" stopColor="#1f0f08" />
          </radialGradient>
        </defs>
      </svg>

      {/* ── Compact Top Header: < Games | Candy Crash | Device Fit Badge | Audio/Haptics ── */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 px-3 py-2 rounded-2xl bg-gradient-to-r from-[#3a0d4e]/95 via-[#240a37]/95 to-[#160724]/95 border border-fuchsia-500/35 shadow-lg">
        <div className="flex items-center gap-1.5">
          {onBackToLobby && (
            <button
              type="button"
              onClick={onBackToLobby}
              className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/15 text-xs font-bold text-slate-200 flex items-center gap-1 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Games
            </button>
          )}
          <Badge className="bg-gradient-to-r from-pink-500 to-amber-400 text-slate-950 font-black text-[10px] sm:text-xs px-2.5 py-0.5">
            🍬 CANDY CRASH
          </Badge>
          <span
            title={`Auto-fitted for ${screenFit.deviceModelHint} (${candyFit.squareBoardSizePx}×${candyFit.squareBoardSizePx}px board)`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-400/30 text-[9px] font-mono font-bold text-sky-300"
          >
            📱 {candyFit.fitSummaryLabel}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowRules((v) => !v)}
            className="h-7 px-2 text-[10px] text-pink-200 hover:text-white gap-1"
          >
            <HelpCircle className="w-3 h-3" />
            {showRules ? "Hide" : "Rules"}
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
            className={`h-7 px-1.5 text-xs ${
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
            className="h-7 w-7 p-0 text-amber-300"
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {showRules && (
        <div className="p-3 rounded-xl bg-[#240a37]/95 border border-pink-500/30 text-xs text-pink-100 space-y-1">
          <p className="font-black text-amber-300">🍬 Candy Crash Match-3 Rules:</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Swipe or tap two adjacent candies to match <strong>3 or more</strong> in a row or column.</li>
            <li>Match <strong>4 candies</strong> to forge a <strong>Striped Candy</strong> that blasts a whole row or column!</li>
            <li>Match <strong>5 candies</strong> to forge a <strong>Chocolate Sprinkle Bomb</strong> — swap it with any candy to clear every candy of that color on the board!</li>
          </ul>
        </div>
      )}

      {/* ── 4 Stat Pills (Level, Score, Moves, Best) + Goal Progress Bar ── */}
      <div className="space-y-1.5">
        <div className="grid grid-cols-4 gap-1.5">
          <div className="rounded-xl bg-white/[0.07] border border-white/10 py-1 px-2 text-center">
            <span className="block text-[9px] uppercase font-bold text-pink-200/75">Level</span>
            <strong className="text-sm sm:text-base font-black text-white font-mono">
              {level}
            </strong>
          </div>
          <div className="rounded-xl bg-white/[0.07] border border-white/10 py-1 px-2 text-center">
            <span className="block text-[9px] uppercase font-bold text-pink-200/75">Score</span>
            <strong className="text-sm sm:text-base font-black text-amber-300 font-mono">
              {score.toLocaleString()}
            </strong>
          </div>
          <div className="rounded-xl bg-white/[0.07] border border-white/10 py-1 px-2 text-center">
            <span className="block text-[9px] uppercase font-bold text-pink-200/75">Moves</span>
            <strong className="text-sm sm:text-base font-black text-emerald-300 font-mono">
              {moves}
            </strong>
          </div>
          <div className="rounded-xl bg-white/[0.07] border border-white/10 py-1 px-2 text-center">
            <span className="block text-[9px] uppercase font-bold text-pink-200/75">Best</span>
            <strong className="text-sm sm:text-base font-black text-pink-300 font-mono">
              {Math.max(bestScore, score).toLocaleString()}
            </strong>
          </div>
        </div>

        {/* Target Goal Progress Bar */}
        <div className="px-1 space-y-0.5">
          <div className="flex items-center justify-between text-[10px] font-bold text-pink-200/90">
            <span>
              Goal: <strong className="text-amber-300">{goal.toLocaleString()} pts</strong> ({progressPct}%)
            </span>
            {mode !== "p2p" && (
              <span className="text-emerald-300">
                ⚡ Challenger: {effectiveOpponentName} ({persona.humanSensePercent}% AI)
              </span>
            )}
          </div>
          <div className="h-2.5 rounded-full bg-white/10 overflow-hidden p-0.5 border border-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 via-pink-500 to-fuchsia-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── 8×8 Candy Crash Board (Mathematically Fitted 100% to Device Screen) ── */}
      <div
        style={{
          width: `${candyFit.squareBoardSizePx}px`,
          height: `${candyFit.squareBoardSizePx}px`,
        }}
        onPointerMove={handleBoardPointerMove}
        onPointerUp={handleBoardPointerUp}
        onPointerCancel={handleBoardPointerUp}
        className="relative mx-auto rounded-3xl p-1.5 sm:p-2 bg-gradient-to-b from-[#4a1259] via-[#2c0b3a] to-[#1b0624] border-2 border-pink-400/35 shadow-[0_16px_45px_rgba(0,0,0,0.75),inset_0_0_0_2px_rgba(255,255,255,0.12)] touch-none select-none overflow-hidden"
      >
        <div
          role="application"
          aria-label="Candy Crash 8x8 Board"
          className="relative w-full h-full rounded-2xl overflow-hidden"
          style={{
            background:
              "conic-gradient(rgba(255,255,255,0.08) 25%, transparent 0 50%, rgba(255,255,255,0.08) 0 75%, transparent 0) 0 0 / 25% 25%",
          }}
        >
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
                  padding: "2.6%",
                  transition:
                    "top 0.28s cubic-bezier(0.4, 1.5, 0.6, 1), left 0.2s ease, transform 0.22s, opacity 0.22s",
                }}
                className={`absolute cursor-pointer focus:outline-none ${
                  isSelected
                    ? "scale-115 z-20 ring-2 ring-amber-300 rounded-xl bg-white/15 animate-pulse"
                    : ""
                } ${t.popping ? "scale-150 opacity-0" : ""} ${
                  t.born ? "scale-110" : ""
                } ${
                  t.hint
                    ? "ring-2 ring-emerald-300 rounded-xl bg-emerald-400/20 animate-bounce z-10"
                    : ""
                }`}
              >
                <CandyTileSvg type={t.type} sp={t.sp} />
              </button>
            );
          })}
        </div>

        {/* ── Level Complete / Out of Moves Overlay ── */}
        {overModal && (
          <div className="absolute inset-0 z-30 rounded-3xl bg-[#1f072c]/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center space-y-3 animate-in fade-in duration-200">
            <Badge
              className={
                overModal.win
                  ? "bg-emerald-500 text-slate-950 font-black text-xs px-3 py-1"
                  : "bg-rose-500/20 text-rose-300 border border-rose-400/40 font-black text-xs px-3 py-1"
              }
            >
              {overModal.win ? `🏆 LEVEL ${overModal.levelNum} CLEARED!` : "⏳ OUT OF MOVES"}
            </Badge>

            <h2 className="text-2xl sm:text-3xl font-black text-white">
              {overModal.win ? `Sweet Victory! (${ creatorName })` : "Almost There!"}
            </h2>

            {overModal.win && (
              <div className="text-3xl sm:text-4xl tracking-widest text-amber-400 drop-shadow">
                {"★".repeat(overModal.stars)}
                {"☆".repeat(3 - overModal.stars)}
              </div>
            )}

            <p className="text-sm text-pink-100 font-bold">
              Score: <strong className="text-amber-300">{overModal.finalScore.toLocaleString()}</strong>
              {!overModal.win && ` of ${overModal.goalNeeded.toLocaleString()} needed`}
            </p>

            <Button
              type="button"
              onClick={() => {
                const nextLv = overModal.win ? overModal.levelNum + 1 : overModal.levelNum;
                initBoardForLevel(nextLv);
              }}
              className="h-11 px-8 rounded-full bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 hover:from-pink-400 hover:to-amber-400 text-white font-black text-sm shadow-xl"
            >
              {overModal.win ? `Play Level ${overModal.levelNum + 1} →` : "Try Again"}
            </Button>
          </div>
        )}
      </div>

      {/* ── Live Feedback Message & Bottom Controls (Hint, Sound, Restart) ── */}
      <div className="space-y-1.5">
        <p className="min-h-[1.25rem] text-center text-xs font-bold text-pink-200/90 truncate px-2">
          {statusMsg}
        </p>

        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleHintClick}
            className="h-9 rounded-2xl border-pink-400/35 bg-white/[0.06] hover:bg-white/[0.12] text-pink-100 font-black text-xs gap-1.5"
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
            className="h-9 rounded-2xl border-pink-400/35 bg-white/[0.06] hover:bg-white/[0.12] text-pink-100 font-black text-xs gap-1.5"
          >
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-300" />}
            Sound: {muted ? "Off" : "On"}
          </Button>

          <Button
            type="button"
            onClick={() => initBoardForLevel(1)}
            className="h-9 rounded-2xl bg-gradient-to-r from-pink-500 to-amber-500 hover:from-pink-400 hover:to-amber-400 text-slate-950 font-black text-xs gap-1.5 shadow-md"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restart
          </Button>
        </div>
      </div>
    </div>
  );
}

export default CandyCrashBoard;
