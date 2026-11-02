import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  HelpCircle,
  Shield,
  Volume2,
  VolumeX,
  Smartphone,
  Users,
  UserPlus,
  Send,
  History,
  MessageCircle,
  RotateCcw,
} from "lucide-react";
import { playSuccessSound } from "@/lib/sound";
import { useDeviceScreenFit } from "@/hooks/use-device-screen-fit";
import {
  playDiceRattleSound,
  playWoodSeedClack,
  playLevelUpFanfare,
  triggerHapticSensor,
  getGameSensoryPreferences,
  setGameSensoryPreferences,
  HUMAN_CHALLENGER_PERSONAS,
} from "@/lib/game-sensory-engine";
import {
  type LudoGameState,
  type LudoPlayerId,
  type LudoToken,
  type LudoLegalMove,
  initializeGame,
  rollDice,
  moveToken,
  validateMove,
  enterHomePath,
  chooseComputerToken,
} from "@/lib/ludo-engine";

const MOVE_STEP_DELAY_MS = 130;
const SEATS_USED_BY_PLAYER_COUNT: Record<2 | 3 | 4, LudoPlayerId[]> = {
  2: ["RED", "YELLOW"],
  3: ["RED", "GREEN", "YELLOW"],
  4: ["RED", "GREEN", "YELLOW", "BLUE"],
};
const FINISH_TRIANGLE_OFFSET: Record<LudoPlayerId, [number, number]> = {
  GREEN: [-1, 0],
  YELLOW: [0, -1],
  RED: [0, 1],
  BLUE: [1, 0],
};
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

// Exported compatibility wrapper state stored in `game_challenges.board_state`
export interface LudoState {
  engine: LudoGameState;
  turn: "creator" | "opponent";
  winner: "creator" | "opponent" | null;
  moveCount: number;
  lastAction?: string;
}

export const INITIAL_LUDO_STATE: LudoState = {
  engine: initializeGame({
    players: ["RED", "YELLOW"],
    playerNames: {
      RED: "Red Challenger",
      GREEN: "Green Challenger",
      YELLOW: "Yellow Challenger",
      BLUE: "Blue Challenger",
    },
  }),
  turn: "creator",
  winner: null,
  moveCount: 0,
  lastAction: "Roll a 6 on the 3D Blue Dice to launch a token from your Base onto the 52-cell track!",
};

/**
 * Exact 52-cell clockwise main track coordinates on the 15x15 Ludo Cross Board (indices 0..51)
 */
const MAIN_TRACK_COORDS: [number, number][] = [
  // Quadrant 0: RED Start [13,6] -> Up Bottom Arm -> Left along Left Arm (0..12)
  [13, 6],
  [12, 6],
  [11, 6],
  [10, 6],
  [9, 6],
  [8, 5],
  [8, 4],
  [8, 3],
  [8, 2], // 8: Star Safe
  [8, 1],
  [8, 0],
  [7, 0], // 11: GREEN Home Path Entry
  [6, 0],
  // Quadrant 1: GREEN Start [6,1] -> Right along Left Arm -> Up Top Arm (13..25)
  [6, 1],
  [6, 2],
  [6, 3],
  [6, 4],
  [6, 5],
  [5, 6],
  [4, 6],
  [3, 6],
  [2, 6], // 21: Star Safe
  [1, 6],
  [0, 6],
  [0, 7], // 24: YELLOW Home Path Entry
  [0, 8],
  // Quadrant 2: YELLOW Start [1,8] -> Down Top Arm -> Right along Right Arm (26..38)
  [1, 8],
  [2, 8],
  [3, 8],
  [4, 8],
  [5, 8],
  [6, 9],
  [6, 10],
  [6, 11],
  [6, 12], // 34: Star Safe
  [6, 13],
  [6, 14],
  [7, 14], // 37: BLUE Home Path Entry
  [8, 14],
  // Quadrant 3: BLUE Start [8,13] -> Left along Right Arm -> Down Bottom Arm (39..51)
  [8, 13],
  [8, 12],
  [8, 11],
  [8, 10],
  [8, 9],
  [9, 8],
  [10, 8],
  [11, 8],
  [12, 8], // 47: Star Safe
  [13, 8],
  [14, 8],
  [14, 7], // 50: RED Home Path Entry
  [14, 6],
];

/**
 * Private 5-cell colored Home Stretch coordinates (homePathPosition 1..5; 6 is inside Center Home Triangle)
 */
const HOME_PATH_COORDS: Record<LudoPlayerId, [number, number][]> = {
  RED: [
    [13, 7],
    [12, 7],
    [11, 7],
    [10, 7],
    [9, 7],
  ],
  GREEN: [
    [7, 1],
    [7, 2],
    [7, 3],
    [7, 4],
    [7, 5],
  ],
  YELLOW: [
    [1, 7],
    [2, 7],
    [3, 7],
    [4, 7],
    [5, 7],
  ],
  BLUE: [
    [7, 13],
    [7, 12],
    [7, 11],
    [7, 10],
    [7, 9],
  ],
};

const PLAYER_THEME: Record<
  LudoPlayerId,
  {
    label: string;
    bg: string;
    border: string;
    text: string;
    badgeBg: string;
    hex: string;
  }
> = {
  RED: {
    label: "Red",
    bg: "bg-[#dc2626]",
    border: "border-red-300",
    text: "text-red-300",
    badgeBg: "bg-red-500/15 border-red-500/40",
    hex: "#dc2626",
  },
  GREEN: {
    label: "Green",
    bg: "bg-[#15803d]",
    border: "border-emerald-300",
    text: "text-emerald-300",
    badgeBg: "bg-emerald-500/15 border-emerald-500/40",
    hex: "#15803d",
  },
  YELLOW: {
    label: "Yellow",
    bg: "bg-[#eab308]",
    border: "border-amber-200",
    text: "text-amber-300",
    badgeBg: "bg-amber-500/15 border-amber-500/40",
    hex: "#eab308",
  },
  BLUE: {
    label: "Blue",
    bg: "bg-[#0284c7]",
    border: "border-sky-300",
    text: "text-sky-300",
    badgeBg: "bg-sky-500/15 border-sky-500/40",
    hex: "#0284c7",
  },
};

function getTokenGridCoord(token: LudoToken): [number, number] | null {
  if (token.status === "BASE" || token.status === "FINISHED") return null;
  if (token.status === "ACTIVE" && token.trackPosition !== null) {
    return MAIN_TRACK_COORDS[token.trackPosition] || null;
  }
  if (token.status === "HOME_PATH" && token.homePathPosition >= 1 && token.homePathPosition <= 5) {
    return HOME_PATH_COORDS[token.owner][token.homePathPosition - 1] || null;
  }
  return null;
}

/**
 * 3D Royal-Blue Dice with White Pips
 */
function RoyalBlue3DDice({
  value,
  rolling,
  disabled,
  onClick,
  size = "lg",
}: {
  value: number;
  rolling: boolean;
  disabled?: boolean;
  onClick?: () => void;
  size?: "md" | "lg";
}) {
  const pipMap: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  const activePips = pipMap[value] || pipMap[6];
  const dims = size === "lg" ? "w-16 h-16 sm:w-20 sm:h-20" : "w-12 h-12";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Complete your move or wait for your turn" : "Tap to Roll Dice!"}
      className={`group relative select-none transition-all duration-200 ${
        disabled ? "cursor-default opacity-80" : "cursor-pointer hover:scale-110 active:scale-95"
      }`}
    >
      <div
        className={`${dims} rounded-[18px] relative transition-transform duration-300 ${
          rolling ? "animate-spin scale-110" : "-rotate-12 group-hover:-rotate-6"
        }`}
        style={{
          background: "linear-gradient(145deg, #6366f1 0%, #4338ca 45%, #1e1b4b 100%)",
          boxShadow:
            "0 12px 24px rgba(0,0,0,0.65), inset 0 3px 6px rgba(255,255,255,0.45), inset -4px -6px 10px rgba(15,23,42,0.8)",
          border: "2px solid rgba(165, 180, 252, 0.55)",
        }}
      >
        <div className="w-full h-full p-2.5 sm:p-3 grid grid-cols-3 grid-rows-3 gap-1 place-items-center">
          {Array.from({ length: 9 }).map((_, idx) => {
            const hasPip = activePips.includes(idx);
            return (
              <span
                key={idx}
                className={`rounded-full transition-all ${
                  size === "lg" ? "w-2.5 h-2.5 sm:w-3 sm:h-3" : "w-2 h-2"
                } ${
                  hasPip
                    ? "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.6),inset_0_-1px_2px_rgba(203,213,225,0.9)] scale-100"
                    : "opacity-0 scale-0"
                }`}
              />
            );
          })}
        </div>
      </div>
    </button>
  );
}

export interface GhanaLudoBoardProps {
  mode: "p2p" | "ai" | "free_data";
  mySide: "creator" | "opponent";
  creatorName: string;
  opponentName: string;
  roomCode?: string;
  initialState?: any;
  onStateChange?: (nextState: LudoState) => void;
  onMatchComplete?: (winnerSide: "creator" | "opponent" | "draw", finalState: LudoState) => void;
  onPointsEarned?: (points: number, reason: string) => void;
  onInvitePlayer?: (phoneOrUser: { phone?: string; name?: string; seat?: LudoPlayerId }) => void;
  playerLevel?: number;
}

function normalizeIncomingLudoState(
  raw: any,
  creatorName: string,
  opponentName: string,
  mode: "p2p" | "ai" | "free_data"
): LudoState {
  if (raw && raw.engine && Array.isArray(raw.engine.players) && raw.engine.tokens) {
    return raw as LudoState;
  }
  const engine = initializeGame({
    players: ["RED", "YELLOW"],
    playerNames: {
      RED: creatorName || "Player 1 (Red)",
      GREEN: "Kofi Boateng (94% Human Sense)",
      YELLOW: opponentName || HUMAN_CHALLENGER_PERSONAS.ludo.name,
      BLUE: "Yaw Mensah (92% Human Sense)",
    },
    playerMetaOverrides: {
      RED: { isAI: false },
      GREEN: { isAI: true },
      YELLOW: { isAI: mode !== "p2p" },
      BLUE: { isAI: true },
    },
  });
  return {
    engine,
    turn: "creator",
    winner: null,
    moveCount: 0,
    lastAction:
      "Roll a 6 on the 3D Blue Dice to launch a token from your Base onto the 52-cell track!",
  };
}

export function GhanaLudoBoard({
  mode,
  mySide,
  creatorName,
  opponentName,
  roomCode,
  initialState,
  onStateChange,
  onMatchComplete,
  onPointsEarned,
  onInvitePlayer,
}: GhanaLudoBoardProps) {
  const persona = HUMAN_CHALLENGER_PERSONAS.ludo;
  const effectiveOpponentName =
    mode === "p2p"
      ? opponentName || "Invited Challenger"
      : opponentName && !opponentName.toLowerCase().includes("ai")
      ? opponentName
      : persona.name;

  const [ludo, setLudo] = useState<LudoState>(() =>
    normalizeIncomingLudoState(initialState, creatorName, effectiveOpponentName, mode)
  );
  const [rolling, setRolling] = useState(false);
  const [lastRolledVisual, setLastRolledVisual] = useState<number>(6);
  const [isAnimatingMove, setIsAnimatingMove] = useState(false);
  const [animatingTokenStep, setAnimatingTokenStep] = useState<{
    tokenId: string;
    owner: LudoPlayerId;
    stepsFromStart: number;
  } | null>(null);
  const [opponentType, setOpponentType] = useState<"computers" | "friends">(
    mode === "p2p" ? "friends" : "computers"
  );
  const gameSessionIdRef = useRef(0);
  const [showRules, setShowRules] = useState(false);
  const [showInviteBar, setShowInviteBar] = useState(false);
  const [invitePhoneInput, setInvitePhoneInput] = useState("");
  const [inviteNameInput, setInviteNameInput] = useState("");
  const [inviteSeatColor, setInviteSeatColor] = useState<LudoPlayerId>("GREEN");
  const [soundEnabled, setSoundEnabled] = useState(
    () => getGameSensoryPreferences().soundEnabled
  );
  const [vibrationEnabled, setVibrationEnabled] = useState(
    () => getGameSensoryPreferences().vibrationEnabled
  );

  // Sync incoming P2P state
  useEffect(() => {
    if (
      initialState &&
      initialState.engine &&
      ((initialState.moveCount || 0) > (ludo.moveCount || 0) ||
        ((initialState.moveCount || 0) === (ludo.moveCount || 0) &&
          (initialState.engine.currentPlayer !== ludo.engine.currentPlayer ||
            initialState.engine.diceResult !== ludo.engine.diceResult)))
    ) {
      gameSessionIdRef.current += 1;
      setIsAnimatingMove(false);
      setAnimatingTokenStep(null);
      setLudo(initialState);
      if (initialState.engine.diceResult) {
        setLastRolledVisual(initialState.engine.diceResult);
      }
    }
  }, [initialState, ludo.moveCount, ludo.engine.currentPlayer, ludo.engine.diceResult]);

  const engine = ludo.engine;
  const myColor: LudoPlayerId = mySide === "creator" ? "RED" : "YELLOW";

  // Resolve visual token state during step-by-step animation
  const resolveVisualToken = useCallback(
    (tok: LudoToken): LudoToken => {
      if (animatingTokenStep && animatingTokenStep.tokenId === tok.id) {
        const dest = enterHomePath(tok.owner, animatingTokenStep.stepsFromStart);
        return {
          ...tok,
          status: dest.status,
          stepsFromStart: animatingTokenStep.stepsFromStart,
          trackPosition: dest.trackPosition,
          homePathPosition: dest.homePathPosition,
        };
      }
      return tok;
    },
    [animatingTokenStep]
  );

  // Determine whether the current seat is controlled by a human player
  const isCurrentSeatHumanControlled = useMemo(() => {
    if (engine.matchStatus !== "IN_PROGRESS") return false;
    const activeColor = engine.currentPlayer;
    if (mode === "p2p") {
      if (mySide === "creator" && activeColor === "RED") return true;
      if (mySide === "opponent" && activeColor !== "RED") return true;
      if ((engine.moveCount || 0) === 0 && engine.diceResult === null) return true;
      const meta = engine.playerMeta[activeColor];
      return !meta?.isAI && mySide === "creator";
    }
    if (opponentType === "friends") {
      return true;
    }
    const meta = engine.playerMeta[activeColor];
    if (meta && meta.isAI === false) return true;
    return activeColor === "RED";
  }, [engine, mode, mySide, opponentType]);

  const syncWrapperState = useCallback(
    (nextEngine: LudoGameState, customLastAction?: string) => {
      const latestEntry =
        nextEngine.turnHistory[nextEngine.turnHistory.length - 1];
      const summary =
        customLastAction ||
        latestEntry?.summary ||
        ludo.lastAction ||
        "52-Cell Ghana Ludo Match in progress.";

      const mappedTurn: "creator" | "opponent" =
        nextEngine.currentPlayer === "RED" ? "creator" : "opponent";
      const mappedWinner: "creator" | "opponent" | null =
        nextEngine.winner === null
          ? null
          : nextEngine.winner === "RED"
          ? "creator"
          : "opponent";

      const nextWrapper: LudoState = {
        engine: nextEngine,
        turn: mappedTurn,
        winner: mappedWinner,
        moveCount: nextEngine.moveCount,
        lastAction: summary,
      };

      setLudo(nextWrapper);
      onStateChange?.(nextWrapper);

      if (mappedWinner) {
        playSuccessSound();
        onMatchComplete?.(mappedWinner, nextWrapper);
      }
    },
    [ludo.lastAction, onMatchComplete, onStateChange]
  );

  // Start / Reset New Game with selected player count & opponent mode
  const startNewLudoGame = useCallback(
    (
      count: 2 | 3 | 4 = (engine.players.length as 2 | 3 | 4) || 2,
      nextOpponentType: "computers" | "friends" = opponentType
    ) => {
      gameSessionIdRef.current += 1;
      setRolling(false);
      setIsAnimatingMove(false);
      setAnimatingTokenStep(null);
      setLastRolledVisual(6);

      const seatOrder = SEATS_USED_BY_PLAYER_COUNT[count] || ["RED", "YELLOW"];
      const isComputerOpponents = mode !== "p2p" && nextOpponentType === "computers";

      const freshEngine = initializeGame({
        players: seatOrder,
        playerNames: {
          RED: creatorName || "Red",
          GREEN: isComputerOpponents ? "Green (Computer)" : "Green",
          YELLOW: isComputerOpponents ? `${effectiveOpponentName} (Computer)` : effectiveOpponentName || "Yellow",
          BLUE: isComputerOpponents ? "Blue (Computer)" : "Blue",
        },
        playerMetaOverrides: {
          RED: { isAI: false },
          GREEN: { isAI: isComputerOpponents },
          YELLOW: { isAI: isComputerOpponents },
          BLUE: { isAI: isComputerOpponents },
        },
      });

      syncWrapperState(
        freshEngine,
        `${freshEngine.playerMeta.RED?.name || "Red"}: roll the dice.`
      );
    },
    [creatorName, effectiveOpponentName, engine.players.length, mode, opponentType, syncWrapperState]
  );

  // Switch between 2-Player, 3-Player, or 4-Player Ludo
  const handleSelectPlayerCount = (count: 2 | 3 | 4) => {
    if (mode === "p2p" && engine.moveCount > 0) return;
    startNewLudoGame(count, opponentType);
  };

  // Switch between Play Computers and Play Friends
  const handleSelectOpponentType = (nextType: "computers" | "friends") => {
    if (mode === "p2p" && engine.moveCount > 0) return;
    setOpponentType(nextType);
    startNewLudoGame((engine.players.length as 2 | 3 | 4) || 2, nextType);
  };

  // Invite a friend into GREEN, YELLOW, or BLUE seat
  const handleInviteFriendToLudoSeat = () => {
    const cleanName = inviteNameInput.trim() || `Invited (${inviteSeatColor})`;
    const cleanPhone = invitePhoneInput.trim();

    const updatedPlayers = engine.players.includes(inviteSeatColor)
      ? engine.players
      : [...engine.players, inviteSeatColor];

    const nextEngine: LudoGameState = {
      ...engine,
      players: updatedPlayers,
      playerMeta: {
        ...engine.playerMeta,
        [inviteSeatColor]: {
          ...engine.playerMeta[inviteSeatColor],
          name: cleanName,
          invitedPhone: cleanPhone || null,
          isAI: false,
        },
      },
    };

    syncWrapperState(
      nextEngine,
      `📲 Invited ${cleanName} to the ${inviteSeatColor} seat!`
    );

    if (cleanPhone) {
      onInvitePlayer?.({
        phone: cleanPhone,
        name: cleanName,
        seat: inviteSeatColor,
      });
    }
    setInvitePhoneInput("");
    setInviteNameInput("");
  };

  // 9-Frame Dice Roll Animation (matches `animateDiceRoll`: 9 frames x 70ms)
  const animateAndExecuteRoll = useCallback(
    async (targetEngine: LudoGameState) => {
      const sessionId = gameSessionIdRef.current;
      setRolling(true);
      playDiceRattleSound();
      triggerHapticSensor("dice_roll");

      for (let frame = 0; frame < 9; frame++) {
        setLastRolledVisual(1 + Math.floor(Math.random() * 6));
        await sleep(70);
        if (sessionId !== gameSessionIdRef.current) return;
      }

      const rollRes = rollDice(targetEngine, targetEngine.currentPlayer);
      setRolling(false);
      if (rollRes.diceValue) {
        setLastRolledVisual(rollRes.diceValue);
      }

      const rollerName =
        targetEngine.playerMeta[targetEngine.currentPlayer]?.name ||
        targetEngine.currentPlayer;

      if (rollRes.tripleSixForfeited) {
        syncWrapperState(
          rollRes.state,
          `${rollerName} rolled three 6s in a row and loses the turn.`
        );
        return;
      }

      if (rollRes.autoPassed) {
        syncWrapperState(
          rollRes.state,
          `${rollerName} rolled a ${rollRes.diceValue}: no move possible.`
        );
        return;
      }

      const customPrompt =
        rollRes.legalMoves.length > 1 && isCurrentSeatHumanControlled
          ? `You rolled a ${rollRes.diceValue}. Tap a glowing token to move it.`
          : `${rollerName} rolled a ${rollRes.diceValue}.`;

      syncWrapperState(rollRes.state, customPrompt);
    },
    [isCurrentSeatHumanControlled, syncWrapperState]
  );

  // Human Roll Dice Handler
  const handleRollDice = useCallback(() => {
    if (
      engine.matchStatus !== "IN_PROGRESS" ||
      !isCurrentSeatHumanControlled ||
      engine.diceResult !== null ||
      rolling ||
      isAnimatingMove
    ) {
      return;
    }
    let targetEngine = engine;
    if (mode === "p2p" && (engine.moveCount || 0) === 0 && engine.currentPlayer !== myColor) {
      const mySeatIdx = Math.max(0, engine.players.indexOf(myColor));
      targetEngine = {
        ...engine,
        currentPlayer: myColor,
        currentPlayerIndex: mySeatIdx,
      };
    }
    void animateAndExecuteRoll(targetEngine);
  }, [animateAndExecuteRoll, engine, isAnimatingMove, isCurrentSeatHumanControlled, mode, myColor, rolling]);

  // Step-by-Step Animated Token Movement (matches reference `moveToken`: 300ms Base launch, 130ms per step, 500ms capture pause)
  const executeAnimatedTokenMove = useCallback(
    async (targetEngine: LudoGameState, owner: LudoPlayerId, tokenIndex: number) => {
      if (isAnimatingMove) return;
      const validation = validateMove(targetEngine, owner, tokenIndex);
      if (!validation.valid || !validation.move) return;

      const move = validation.move;
      const sessionId = gameSessionIdRef.current;
      setIsAnimatingMove(true);

      if (move.fromSteps === -1) {
        setAnimatingTokenStep({
          tokenId: move.tokenId,
          owner,
          stepsFromStart: 0,
        });
        playWoodSeedClack(0);
        triggerHapticSensor("seed_drop");
        await sleep(300);
        if (sessionId !== gameSessionIdRef.current) return;
      } else {
        for (let step = move.fromSteps + 1; step <= move.toSteps; step++) {
          setAnimatingTokenStep({
            tokenId: move.tokenId,
            owner,
            stepsFromStart: step,
          });
          playWoodSeedClack(step);
          triggerHapticSensor("seed_drop");
          await sleep(MOVE_STEP_DELAY_MS);
          if (sessionId !== gameSessionIdRef.current) return;
        }
      }

      const moveRes = moveToken(targetEngine, owner, tokenIndex);
      if (moveRes.capturedTokenIds.length > 0) {
        triggerHapticSensor("pocket_drop");
        await sleep(500);
        if (sessionId !== gameSessionIdRef.current) return;
      }

      setAnimatingTokenStep(null);
      setIsAnimatingMove(false);

      // Award Arena progression points for human player actions
      if (owner === myColor) {
        if (moveRes.capturedTokenIds.length > 0) {
          onPointsEarned?.(
            50 * moveRes.capturedTokenIds.length,
            `Captured Opponent Token (+${50 * moveRes.capturedTokenIds.length} Pts)`
          );
        }
        if (moveRes.movedMove?.toStatus === "FINISHED") {
          triggerHapticSensor("pocket_drop");
          onPointsEarned?.(90, "Token Reached Final Home by Exact Roll (+90 Pts)");
        }
        if (moveRes.winner === myColor) {
          playLevelUpFanfare();
          triggerHapticSensor("victory");
          onPointsEarned?.(300, "Ghana Ludo 4-Token Victory (+300 Pts)");
        }
      }

      syncWrapperState(moveRes.state);
    },
    [isAnimatingMove, myColor, onPointsEarned, syncWrapperState]
  );

  // Select Token to Move Handler (Player taps a glowing token)
  const handleSelectTokenMove = useCallback(
    (owner: LudoPlayerId, tokenIndex: number) => {
      if (
        engine.matchStatus !== "IN_PROGRESS" ||
        !isCurrentSeatHumanControlled ||
        engine.currentPlayer !== owner ||
        engine.diceResult === null ||
        rolling ||
        isAnimatingMove
      ) {
        return;
      }
      void executeAnimatedTokenMove(engine, owner, tokenIndex);
    },
    [engine, executeAnimatedTokenMove, isAnimatingMove, isCurrentSeatHumanControlled, rolling]
  );

  // Reference Turn Flow Controller:
  // 1. If human rolled and only 1 movable token exists (`legalMoves.length === 1`), highlight for 600ms then auto-advance it.
  // 2. If computer seat is active, roll after 700ms and pick best move via `chooseComputerToken` after 800ms (or 600ms if 1 move).
  useEffect(() => {
    if (engine.matchStatus !== "IN_PROGRESS" || rolling || isAnimatingMove) {
      return;
    }

    const activePlayer = engine.currentPlayer;

    // Human turn with exactly 1 legal move -> highlight for 600ms then move automatically (matching reference `runGame`)
    if (isCurrentSeatHumanControlled) {
      if (engine.diceResult !== null && engine.legalMoves.length === 1) {
        const singleMove = engine.legalMoves[0];
        const autoSingleTimer = window.setTimeout(() => {
          void executeAnimatedTokenMove(engine, activePlayer, singleMove.tokenIndex);
        }, 600);
        return () => window.clearTimeout(autoSingleTimer);
      }
      return;
    }

    // Computer turn Step 1: Roll dice after 700ms
    if (engine.diceResult === null) {
      const rollTimer = window.setTimeout(() => {
        void animateAndExecuteRoll(engine);
      }, 700);
      return () => window.clearTimeout(rollTimer);
    }

    // Computer turn Step 2: Choose best token using threat-aware `chooseComputerToken`
    if (engine.legalMoves.length > 0) {
      const delayMs = engine.legalMoves.length > 1 ? 800 : 600;
      const moveTimer = window.setTimeout(() => {
        const movableIndexes = engine.legalMoves.map((m) => m.tokenIndex);
        const chosenIndex =
          movableIndexes.length > 1
            ? chooseComputerToken(engine, activePlayer, movableIndexes, engine.diceResult!)
            : movableIndexes[0];
        void executeAnimatedTokenMove(engine, activePlayer, chosenIndex);
      }, delayMs);
      return () => window.clearTimeout(moveTimer);
    }
  }, [
    animateAndExecuteRoll,
    engine,
    executeAnimatedTokenMove,
    isAnimatingMove,
    isCurrentSeatHumanControlled,
    rolling,
  ]);

  // Lookup map of legal moves for the current player keyed by tokenId
  const legalMoveByTokenId = useMemo(() => {
    const map = new Map<string, LudoLegalMove>();
    for (const m of engine.legalMoves) {
      map.set(m.tokenId, m);
    }
    return map;
  }, [engine.legalMoves]);

  // Lookup map of destination preview coordinates for legal moves
  const destinationPreviewCoords = useMemo(() => {
    const coords = new Set<string>();
    for (const m of engine.legalMoves) {
      if (m.toStatus === "ACTIVE" && m.toTrackPosition !== null) {
        const c = MAIN_TRACK_COORDS[m.toTrackPosition];
        if (c) coords.add(`${c[0]}-${c[1]}`);
      } else if (m.toStatus === "HOME_PATH" && m.toHomePathPosition >= 1 && m.toHomePathPosition <= 5) {
        const c = HOME_PATH_COORDS[m.owner][m.toHomePathPosition - 1];
        if (c) coords.add(`${c[0]}-${c[1]}`);
      }
    }
    return coords;
  }, [engine.legalMoves]);

  // Group active/home-path tokens by (row, col) cell using visual step-by-step state
  const tokensByCell = useMemo(() => {
    const map = new Map<string, LudoToken[]>();
    for (const color of engine.players) {
      for (const rawToken of engine.tokens[color] || []) {
        const token = resolveVisualToken(rawToken);
        const coord = getTokenGridCoord(token);
        if (!coord) continue;
        const key = `${coord[0]}-${coord[1]}`;
        const list = map.get(key) || [];
        list.push(token);
        map.set(key, list);
      }
    }
    return map;
  }, [engine.players, engine.tokens, resolveVisualToken]);

  // Finished tokens inside the 3x3 Center Home Triangles (progress === HOME_PROGRESS / status === "FINISHED")
  const finishedTokensInCenter = useMemo(() => {
    const list: { token: LudoToken; leftPct: number; topPct: number }[] = [];
    for (const color of engine.players) {
      const visualTokens = (engine.tokens[color] || []).map(resolveVisualToken);
      visualTokens.forEach((tok, tokenIndex) => {
        if (tok.status !== "FINISHED") return;
        const finishedRank = visualTokens
          .slice(0, tokenIndex)
          .filter((other) => other.status === "FINISHED").length;
        const [offsetX, offsetY] = FINISH_TRIANGLE_OFFSET[color];
        const spread = (finishedRank - 1.5) * 13;
        const leftPct = 50 + offsetX * 30 + (offsetX === 0 ? spread : 0);
        const topPct = 50 + offsetY * 30 + (offsetX !== 0 ? spread : 0);
        list.push({ token: tok, leftPct, topPct });
      });
    }
    return list;
  }, [engine.players, engine.tokens, resolveVisualToken]);

  const screenFit = useDeviceScreenFit();
  const ludoFit = screenFit.computeBoardStageMetrics("ludo", { reservedTopPx: 38 });

  return (
    <div className="space-y-2 sm:space-y-3 max-w-2xl mx-auto">
      {/* ── Top Control Header: 52-Cell Rule Badge, Device Auto-Fit Badge, 2P/3P/4P Selector, Computers/Friends, New Game & Audio/Haptics ── */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 p-2 sm:p-2.5 rounded-2xl bg-slate-900/95 border border-white/10 shadow-lg">
        <div className="flex flex-wrap items-center gap-1.5">
          <img
            src="/ludo-challenge-icon.png"
            alt="Ghana Ludo"
            className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg object-cover shadow-md border border-white/20"
          />
          <Badge className="bg-amber-500 text-slate-950 font-black text-[10px] sm:text-xs px-2 py-0.5">
            🎲 52-CELL LUDO
          </Badge>
          <span
            title={`Auto-fitted for ${screenFit.deviceModelHint} (${ludoFit.squareBoardSizePx}×${ludoFit.squareBoardSizePx}px board)`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-400/30 text-[9px] font-mono font-bold text-sky-300"
          >
            📱 {ludoFit.fitSummaryLabel}
          </span>

          {/* 2P / 3P / 4P Seat Switcher */}
          <div className="inline-flex items-center rounded-xl bg-slate-950 p-0.5 border border-white/10 gap-0.5">
            {([2, 3, 4] as const).map((cnt) => {
              const active = engine.players.length === cnt;
              return (
                <button
                  key={cnt}
                  type="button"
                  disabled={mode === "p2p" && engine.moveCount > 0}
                  onClick={() => handleSelectPlayerCount(cnt)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-black transition-all flex items-center gap-1 cursor-pointer ${
                    active
                      ? "bg-amber-500 text-slate-950 shadow"
                      : "text-slate-400 hover:text-white disabled:opacity-40"
                  }`}
                  title="Select 2, 3, or 4 Players"
                >
                  <Users className="w-2.5 h-2.5" /> {cnt}P
                </button>
              );
            })}
          </div>

          {/* Play Computers vs Play Friends Selector */}
          {mode !== "p2p" && (
            <div className="inline-flex items-center rounded-xl bg-slate-950 p-0.5 border border-white/10 gap-0.5">
              {(["computers", "friends"] as const).map((opt) => {
                const active = opponentType === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => handleSelectOpponentType(opt)}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-black transition-all cursor-pointer ${
                      active
                        ? "bg-indigo-500 text-white shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {opt === "computers" ? "🤖 AI" : "👥 Friends"}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {mode !== "p2p" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                startNewLudoGame((engine.players.length as 2 | 3 | 4) || 2, opponentType)
              }
              className="h-7 px-2 rounded-xl border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 text-[10px] font-black gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              New
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowInviteBar((v) => !v)}
            className="h-7 px-2 rounded-xl border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-[10px] font-black gap-1"
          >
            <UserPlus className="w-3 h-3" />
            Invite ({engine.players.length}/4)
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowRules((v) => !v)}
            className="h-7 px-2 text-[10px] text-amber-300 hover:text-amber-200 gap-1"
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
            title="Toggle Haptic Vibration"
          >
            <Smartphone className="w-3.5 h-3.5" />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              setGameSensoryPreferences({ soundEnabled: next });
            }}
            className="h-7 px-1.5 text-xs text-amber-300"
            title="Toggle Sound"
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* ── Multi-Player Invite Console (Invite Other Players to Green / Yellow / Blue Seats) ── */}
      {showInviteBar && (
        <div className="p-4 rounded-2xl bg-slate-950/95 border border-amber-500/40 space-y-3 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black text-amber-300 flex items-center gap-1.5">
                <UserPlus className="w-4 h-4" /> Invite Up to 3 Other Players to Your Ludo Table (2–4 Players)
              </p>
              <p className="text-[11px] text-slate-400">
                Assign a friend to <strong>Green</strong>, <strong>Yellow</strong>, or <strong>Blue</strong> and send them an instant SMS / In-App / WhatsApp invite!
              </p>
            </div>
            {roomCode && (
              <a
                href={`https://wa.me/?text=${encodeURIComponent(
                  `🎲 Join my ${engine.players.length}-Player Ghana Ludo Table on SwiftData Arena!\n🔑 Room #${roomCode}\n👉 Tap to join live: ${window.location.origin}/challenges?room=${roomCode}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[11px]"
              >
                <MessageCircle className="w-3.5 h-3.5" /> Share Ludo Room on WhatsApp
              </a>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <select
              value={inviteSeatColor}
              onChange={(e) => setInviteSeatColor(e.target.value as LudoPlayerId)}
              className="h-9 rounded-xl bg-slate-900 border border-white/15 px-3 text-xs font-bold text-white"
            >
              <option value="GREEN">🟢 Green Seat (Player 2)</option>
              <option value="YELLOW">🟡 Yellow Seat (Player 3)</option>
              <option value="BLUE">🔵 Blue Seat (Player 4)</option>
            </select>

            <Input
              placeholder="Friend's Name (e.g. Kwesi)"
              value={inviteNameInput}
              onChange={(e) => setInviteNameInput(e.target.value)}
              className="h-9 rounded-xl bg-slate-900 border-white/15 text-xs text-white"
            />

            <Input
              placeholder="Friend's Phone (0241234567)"
              value={invitePhoneInput}
              onChange={(e) => setInvitePhoneInput(e.target.value)}
              className="h-9 rounded-xl bg-slate-900 border-white/15 text-xs font-mono text-white"
            />

            <Button
              type="button"
              onClick={handleInviteFriendToLudoSeat}
              className="h-9 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs gap-1.5"
            >
              <Send className="w-3.5 h-3.5" /> Add &amp; Send Invite
            </Button>
          </div>
        </div>
      )}

      {/* ── Official Ludo Rules Drawer ── */}
      {showRules && (
        <div className="p-3.5 rounded-xl bg-amber-950/50 border border-amber-500/30 text-xs text-amber-100/90 space-y-1.5">
          <p className="font-black text-amber-400">
            🇬🇭 Complete 52-Cell Ludo Rules:
          </p>
          <ul className="list-disc pl-4 space-y-1">
            <li>
              Roll a <strong>6</strong> to bring a token out of its base onto your coloured start square.
            </li>
            <li>
              Move a token clockwise by the number you roll. Tap a glowing token to choose which one moves.
            </li>
            <li>
              Landing on an opponent token sends it back to its base, unless it is on a coloured start square or a star (★) square.
            </li>
            <li>
              Rolling a <strong>6</strong>, <strong>capturing a token</strong>, or <strong>reaching home</strong> gives you another roll. Three 6s in a row cost you the turn.
            </li>
            <li>
              Your tokens turn into your coloured home column after one full lap. You need the exact number to reach the centre.
            </li>
            <li>
              The first player to bring all four tokens home wins.
            </li>
          </ul>
        </div>
      )}

      {/* ── Player Scorecards & Seat Status Bar (2–4 Players) ── */}
      <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
        {(["RED", "GREEN", "YELLOW", "BLUE"] as LudoPlayerId[]).map((color) => {
          const isPlaying = engine.players.includes(color);
          const isTurn = engine.currentPlayer === color && engine.matchStatus === "IN_PROGRESS";
          const meta = engine.playerMeta[color];
          const colorTokens = (engine.tokens[color] || []).map(resolveVisualToken);
          const finishedCount = colorTokens.filter((t) => t.status === "FINISHED").length;
          const activeCount = colorTokens.filter(
            (t) => t.status === "ACTIVE" || t.status === "HOME_PATH"
          ).length;
          const theme = PLAYER_THEME[color];

          return (
            <div
              key={color}
              className={`px-2 py-1.5 rounded-xl border transition-all ${
                !isPlaying
                  ? "bg-slate-950/40 border-white/5 opacity-45"
                  : isTurn
                  ? `${theme.badgeBg} ring-2 ring-amber-400 shadow-lg`
                  : "bg-slate-900/90 border-white/10"
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1 min-w-0">
                  <span className={`w-2.5 h-2.5 rounded-full ${theme.bg} border border-white shrink-0`} />
                  <span className="text-[10px] sm:text-xs font-black text-white truncate">
                    {meta?.name || color}
                  </span>
                </div>
                {isPlaying ? (
                  <span className="text-[9px] font-mono font-bold text-amber-300 shrink-0">
                    🏠{finishedCount}/4
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={mode === "p2p" && engine.moveCount > 0}
                    onClick={() => {
                      setInviteSeatColor(color);
                      setShowInviteBar(true);
                    }}
                    className="text-[8px] font-bold text-amber-400 hover:underline cursor-pointer shrink-0"
                  >
                    +Invite
                  </button>
                )}
              </div>

              <div className="hidden sm:flex items-center justify-between text-[9px] text-slate-400 mt-0.5">
                <span>
                  {isPlaying
                    ? `Track: ${activeCount} • Base: ${4 - finishedCount - activeCount}`
                    : "Seat Open"}
                </span>
                {isTurn && (
                  <span className="font-black text-amber-300 animate-pulse">
                    {engine.diceResult ? `🎲 ${engine.diceResult}` : "Roll"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Main 15x15 Ludo Cross Board & 3D Blue Dice Stage (Mathematically Fitted to Device Screen) ── */}
      <div className="p-2 sm:p-3.5 rounded-3xl bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 border-2 border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.85)]">
        <div
          style={{
            width: `${ludoFit.squareBoardSizePx}px`,
            height: `${ludoFit.squareBoardSizePx}px`,
          }}
          className="relative mx-auto aspect-square rounded-2xl bg-[#eef6fb] p-1 sm:p-2 shadow-2xl border-4 border-slate-300"
        >
          <div className="w-full h-full grid grid-cols-15 grid-rows-15 border-2 border-slate-900 bg-white relative">
            {/* 1. GREEN YARD (Top-Left 6x6: rows 0..5, cols 0..5) */}
            <div
              className="bg-[#15803d] border-r-2 border-b-2 border-slate-900 p-2 sm:p-3.5 flex items-center justify-center relative"
              style={{ gridRow: "1 / span 6", gridColumn: "1 / span 6" }}
            >
              <div className="w-full h-full bg-white rounded-2xl border-2 border-slate-900 p-2 sm:p-3 grid grid-cols-2 grid-rows-2 gap-2 place-items-center shadow-inner">
                {(engine.tokens.GREEN || []).map((rawTok) => {
                  const tok = resolveVisualToken(rawTok);
                  const inBase = tok.status === "BASE" && engine.players.includes("GREEN");
                  const isLegal =
                    legalMoveByTokenId.has(tok.id) &&
                    isCurrentSeatHumanControlled &&
                    !isAnimatingMove;
                  return (
                    <div
                      key={tok.id}
                      className="w-7 h-7 sm:w-10 sm:h-10 rounded-full bg-[#15803d] border-2 border-slate-900 flex items-center justify-center shadow-inner"
                    >
                      {inBase && (
                        <button
                          type="button"
                          disabled={!isLegal}
                          onClick={() => handleSelectTokenMove("GREEN", tok.tokenIndex)}
                          className={`w-5 h-5 sm:w-7 sm:h-7 rounded-full bg-gradient-to-br from-emerald-300 via-emerald-500 to-green-900 border-2 border-white shadow-md flex items-center justify-center text-[9px] font-black text-white ${
                            isLegal
                              ? "ring-4 ring-amber-300 animate-bounce cursor-pointer"
                              : "cursor-default"
                          }`}
                        >
                          G{tok.tokenIndex + 1}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. YELLOW YARD (Top-Right 6x6: rows 0..5, cols 9..14) */}
            <div
              className="bg-[#eab308] border-l-2 border-b-2 border-slate-900 p-2 sm:p-3.5 flex items-center justify-center relative"
              style={{ gridRow: "1 / span 6", gridColumn: "10 / span 6" }}
            >
              <div className="w-full h-full bg-white rounded-2xl border-2 border-slate-900 p-2 sm:p-3 grid grid-cols-2 grid-rows-2 gap-2 place-items-center shadow-inner">
                {(engine.tokens.YELLOW || []).map((rawTok) => {
                  const tok = resolveVisualToken(rawTok);
                  const inBase = tok.status === "BASE" && engine.players.includes("YELLOW");
                  const isLegal =
                    legalMoveByTokenId.has(tok.id) &&
                    isCurrentSeatHumanControlled &&
                    !isAnimatingMove;
                  return (
                    <div
                      key={tok.id}
                      className="w-7 h-7 sm:w-10 sm:h-10 rounded-full bg-[#eab308] border-2 border-slate-900 flex items-center justify-center shadow-inner"
                    >
                      {inBase && (
                        <button
                          type="button"
                          disabled={!isLegal}
                          onClick={() => handleSelectTokenMove("YELLOW", tok.tokenIndex)}
                          className={`w-5 h-5 sm:w-7 sm:h-7 rounded-full bg-gradient-to-br from-yellow-200 via-amber-400 to-amber-700 border-2 border-slate-950 shadow-md flex items-center justify-center text-[9px] font-black text-slate-950 ${
                            isLegal
                              ? "ring-4 ring-emerald-400 animate-bounce cursor-pointer"
                              : "cursor-default"
                          }`}
                        >
                          Y{tok.tokenIndex + 1}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. RED YARD (Bottom-Left 6x6: rows 9..14, cols 0..5) */}
            <div
              className="bg-[#dc2626] border-r-2 border-t-2 border-slate-900 p-2 sm:p-3.5 flex items-center justify-center relative"
              style={{ gridRow: "10 / span 6", gridColumn: "1 / span 6" }}
            >
              <div className="w-full h-full bg-white rounded-2xl border-2 border-slate-900 p-2 sm:p-3 grid grid-cols-2 grid-rows-2 gap-2 place-items-center shadow-inner">
                {(engine.tokens.RED || []).map((rawTok) => {
                  const tok = resolveVisualToken(rawTok);
                  const inBase = tok.status === "BASE" && engine.players.includes("RED");
                  const isLegal =
                    legalMoveByTokenId.has(tok.id) &&
                    isCurrentSeatHumanControlled &&
                    !isAnimatingMove;
                  return (
                    <div
                      key={tok.id}
                      className="w-7 h-7 sm:w-10 sm:h-10 rounded-full bg-[#dc2626] border-2 border-slate-900 flex items-center justify-center shadow-inner"
                    >
                      {inBase && (
                        <button
                          type="button"
                          disabled={!isLegal}
                          onClick={() => handleSelectTokenMove("RED", tok.tokenIndex)}
                          className={`w-5 h-5 sm:w-7 sm:h-7 rounded-full bg-gradient-to-br from-red-300 via-red-600 to-red-950 border-2 border-white shadow-md flex items-center justify-center text-[9px] font-black text-white ${
                            isLegal
                              ? "ring-4 ring-amber-300 animate-bounce cursor-pointer"
                              : "cursor-default"
                          }`}
                        >
                          R{tok.tokenIndex + 1}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 4. BLUE YARD (Bottom-Right 6x6: rows 9..14, cols 9..14) */}
            <div
              className="bg-[#0284c7] border-l-2 border-t-2 border-slate-900 p-2 sm:p-3.5 flex items-center justify-center relative"
              style={{ gridRow: "10 / span 6", gridColumn: "10 / span 6" }}
            >
              <div className="w-full h-full bg-white rounded-2xl border-2 border-slate-900 p-2 sm:p-3 grid grid-cols-2 grid-rows-2 gap-2 place-items-center shadow-inner">
                {(engine.tokens.BLUE || []).map((rawTok) => {
                  const tok = resolveVisualToken(rawTok);
                  const inBase = tok.status === "BASE" && engine.players.includes("BLUE");
                  const isLegal =
                    legalMoveByTokenId.has(tok.id) &&
                    isCurrentSeatHumanControlled &&
                    !isAnimatingMove;
                  return (
                    <div
                      key={tok.id}
                      className="w-7 h-7 sm:w-10 sm:h-10 rounded-full bg-[#0284c7] border-2 border-slate-900 flex items-center justify-center shadow-inner"
                    >
                      {inBase && (
                        <button
                          type="button"
                          disabled={!isLegal}
                          onClick={() => handleSelectTokenMove("BLUE", tok.tokenIndex)}
                          className={`w-5 h-5 sm:w-7 sm:h-7 rounded-full bg-gradient-to-br from-sky-300 via-sky-500 to-blue-950 border-2 border-white shadow-md flex items-center justify-center text-[9px] font-black text-white ${
                            isLegal
                              ? "ring-4 ring-amber-300 animate-bounce cursor-pointer"
                              : "cursor-default"
                          }`}
                        >
                          B{tok.tokenIndex + 1}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 5. CENTER 3x3 MULTI-COLORED HOME TRIANGLES (rows 6..8, cols 6..8) */}
            <div
              className="relative border-2 border-slate-900 overflow-hidden flex items-center justify-center"
              style={{ gridRow: "7 / span 3", gridColumn: "7 / span 3" }}
            >
              <svg viewBox="0 0 100 100" className="w-full h-full block">
                <polygon points="0,0 50,50 0,100" fill="#15803d" stroke="#0f172a" strokeWidth="2" />
                <polygon points="0,0 100,0 50,50" fill="#eab308" stroke="#0f172a" strokeWidth="2" />
                <polygon points="0,100 100,100 50,50" fill="#dc2626" stroke="#0f172a" strokeWidth="2" />
                <polygon points="100,0 100,100 50,50" fill="#0284c7" stroke="#0f172a" strokeWidth="2" />
              </svg>

              {/* Finished tokens arranged along their home triangle edges */}
              {finishedTokensInCenter.map(({ token: tok, leftPct, topPct }) => {
                const tokenPalette =
                  tok.owner === "RED"
                    ? "from-red-300 via-red-600 to-red-950 text-white border-white"
                    : tok.owner === "GREEN"
                    ? "from-emerald-300 via-emerald-600 to-green-950 text-white border-white"
                    : tok.owner === "YELLOW"
                    ? "from-yellow-200 via-amber-400 to-amber-700 text-slate-950 border-slate-950"
                    : "from-sky-300 via-sky-500 to-blue-950 text-white border-white";
                return (
                  <span
                    key={tok.id}
                    style={{
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                    className={`absolute w-3.5 h-3.5 sm:w-5 sm:h-5 rounded-full bg-gradient-to-br ${tokenPalette} border shadow-md flex items-center justify-center text-[7px] sm:text-[8px] font-black z-20 pointer-events-none`}
                  >
                    {tok.owner[0]}
                    {tok.tokenIndex + 1}
                  </span>
                );
              })}

              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="px-1.5 py-0.5 rounded bg-slate-950/85 text-white font-black text-[8px] sm:text-[10px] border border-white/20 shadow">
                  HOME 4/4
                </span>
              </div>
            </div>

            {/* 6. RENDER ALL 52 MAIN-TRACK CELLS + 20 COLORED HOME-PATH CELLS */}
            {Array.from({ length: 15 }).map((_, r) =>
              Array.from({ length: 15 }).map((__, c) => {
                const inTopLeft = r < 6 && c < 6;
                const inTopRight = r < 6 && c > 8;
                const inBottomLeft = r > 8 && c < 6;
                const inBottomRight = r > 8 && c > 8;
                const inCenter = r >= 6 && r <= 8 && c >= 6 && c <= 8;
                if (inTopLeft || inTopRight || inBottomLeft || inBottomRight || inCenter) {
                  return null;
                }

                // Determine cell coloring (Home Stretch or Starting Safe Square or Star Safe Square)
                const isRedHomeStretch = c === 7 && r >= 9 && r <= 13;
                const isYellowHomeStretch = c === 7 && r >= 1 && r <= 5;
                const isGreenHomeStretch = r === 7 && c >= 1 && c <= 5;
                const isBlueHomeStretch = r === 7 && c >= 9 && c <= 13;

                const isRedStart = r === 13 && c === 6;
                const isGreenStart = r === 6 && c === 1;
                const isYellowStart = r === 1 && c === 8;
                const isBlueStart = r === 8 && c === 13;

                const isStarCell =
                  (r === 8 && c === 2) ||
                  (r === 2 && c === 6) ||
                  (r === 6 && c === 12) ||
                  (r === 12 && c === 8);

                let cellBg = "bg-white";
                if (isRedHomeStretch || isRedStart) cellBg = "bg-[#dc2626]";
                else if (isYellowHomeStretch || isYellowStart) cellBg = "bg-[#eab308]";
                else if (isGreenHomeStretch || isGreenStart) cellBg = "bg-[#15803d]";
                else if (isBlueHomeStretch || isBlueStart) cellBg = "bg-[#0284c7]";

                const cellKey = `${r}-${c}`;
                const cellTokens = tokensByCell.get(cellKey) || [];
                const isDestinationPreview = destinationPreviewCoords.has(cellKey);

                return (
                  <div
                    key={cellKey}
                    style={{ gridRow: r + 1, gridColumn: c + 1 }}
                    className={`${cellBg} border border-slate-800/80 relative flex items-center justify-center select-none ${
                      isDestinationPreview ? "ring-2 ring-inset ring-emerald-400 bg-emerald-100/80" : ""
                    }`}
                  >
                    {/* Safe Star Marker */}
                    {(isRedStart || isGreenStart || isYellowStart || isBlueStart || isStarCell) &&
                      cellTokens.length === 0 && (
                        <span
                          className={`text-[9px] sm:text-xs font-black ${
                            isStarCell ? "text-slate-500" : "text-white/90"
                          }`}
                        >
                          ★
                        </span>
                      )}

                    {/* Destination Preview Dot */}
                    {isDestinationPreview && cellTokens.length === 0 && (
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                    )}

                    {/* Tokens occupying this square (with circular ring spread when 2+ tokens stack) */}
                    {cellTokens.map((tok, stackIdx) => {
                      const isLegal =
                        legalMoveByTokenId.has(tok.id) &&
                        isCurrentSeatHumanControlled &&
                        !isAnimatingMove;
                      const angle =
                        cellTokens.length > 1
                          ? (Math.PI * 2 * stackIdx) / cellTokens.length
                          : 0;
                      const offsetStyle =
                        cellTokens.length > 1
                          ? {
                              transform: `translate(${Math.cos(angle) * 4.5}px, ${
                                Math.sin(angle) * 4.5
                              }px) scale(0.86)`,
                            }
                          : undefined;

                      const tokenPalette =
                        tok.owner === "RED"
                          ? "from-red-300 via-red-600 to-red-950 text-white border-white"
                          : tok.owner === "GREEN"
                          ? "from-emerald-300 via-emerald-600 to-green-950 text-white border-white"
                          : tok.owner === "YELLOW"
                          ? "from-yellow-200 via-amber-400 to-amber-700 text-slate-950 border-slate-950"
                          : "from-sky-300 via-sky-500 to-blue-950 text-white border-white";

                      return (
                        <button
                          key={tok.id}
                          type="button"
                          disabled={!isLegal}
                          onClick={() => handleSelectTokenMove(tok.owner, tok.tokenIndex)}
                          style={offsetStyle}
                          title={
                            isLegal
                              ? `Tap to move ${tok.owner} Token #${tok.tokenIndex + 1} by ${engine.diceResult}`
                              : `${tok.owner} Token #${tok.tokenIndex + 1}`
                          }
                          className={`w-4 h-4 sm:w-6 sm:h-6 rounded-full bg-gradient-to-br ${tokenPalette} border-2 shadow-md flex items-center justify-center text-[8px] sm:text-[9px] font-black z-10 transition-transform ${
                            isLegal
                              ? "ring-4 ring-amber-300 animate-bounce scale-125 cursor-pointer z-20"
                              : "cursor-default"
                          }`}
                        >
                          {tok.owner[0]}
                          {tok.tokenIndex + 1}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Interactive 3D Royal-Blue Dice Dock & Turn Action Bar ── */}
        <div className="mt-2.5 p-2.5 sm:p-3.5 rounded-2xl bg-slate-950/90 border border-white/10 flex flex-row items-center justify-between gap-2.5">
          <div className="space-y-0.5 min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isCurrentSeatHumanControlled ? "bg-emerald-400 animate-ping" : "bg-amber-400"
                }`}
              />
              <span className="text-[11px] sm:text-xs font-black text-white truncate">
                {engine.winner ? (
                  `🏆 ${engine.playerMeta[engine.winner]?.name || engine.winner} WON THE LUDO MATCH!`
                ) : isCurrentSeatHumanControlled ? (
                  engine.diceResult === null ? (
                    `🟢 YOUR TURN (${engine.playerMeta[engine.currentPlayer]?.name}) — Tap Dice!`
                  ) : (
                    `🎯 Rolled ${engine.diceResult}! Tap highlighted ${engine.currentPlayer} token!`
                  )
                ) : (
                  `⏳ ${engine.playerMeta[engine.currentPlayer]?.name || engine.currentPlayer} playing...`
                )}
              </span>
              {engine.consecutiveSixes > 0 && (
                <Badge className="bg-amber-500/20 text-amber-300 border border-amber-400/40 text-[9px] px-1.5 py-0">
                  🔥 6s: {engine.consecutiveSixes}/3
                </Badge>
              )}
            </div>
            <p className="text-[10px] sm:text-xs text-amber-300/90 font-medium truncate">
              {ludo.lastAction}
            </p>
          </div>

          {/* 3D Royal-Blue Dice & Legal Token Quick-Select Pills */}
          <div className="flex items-center gap-2 shrink-0">
            {isCurrentSeatHumanControlled &&
              !isAnimatingMove &&
              engine.diceResult !== null &&
              engine.legalMoves.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {engine.legalMoves.map((m) => (
                    <Button
                      key={m.tokenId}
                      size="sm"
                      onClick={() => handleSelectTokenMove(m.owner, m.tokenIndex)}
                      className="h-7 px-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-[10px] shadow"
                    >
                      {m.owner[0]}
                      {m.tokenIndex + 1}{" "}
                      {m.fromStatus === "BASE"
                        ? "(Out)"
                        : m.willCaptureTokenIds.length > 0
                        ? "(💥)"
                        : m.toStatus === "FINISHED"
                        ? "(🏠)"
                        : `(+${engine.diceResult})`}
                    </Button>
                  ))}
                </div>
              )}

            <div className="flex items-center gap-2 bg-slate-900/90 px-2.5 py-1.5 rounded-2xl border border-indigo-500/30 shadow-inner">
              <div className="text-right hidden sm:block">
                <p className="text-[9px] font-bold uppercase tracking-wider text-indigo-300">
                  {rolling
                    ? "Rolling..."
                    : engine.diceResult
                    ? `Rolled: ${engine.diceResult}`
                    : "3D Dice"}
                </p>
                <p className="text-[10px] font-semibold text-slate-400">
                  {isCurrentSeatHumanControlled && engine.diceResult === null && !isAnimatingMove
                    ? "Tap to roll"
                    : engine.diceResult !== null
                    ? "Choose token"
                    : "Waiting..."}
                </p>
              </div>
              <RoyalBlue3DDice
                value={rolling ? lastRolledVisual : engine.diceResult || lastRolledVisual}
                rolling={rolling}
                disabled={
                  !isCurrentSeatHumanControlled ||
                  engine.diceResult !== null ||
                  rolling ||
                  isAnimatingMove ||
                  engine.matchStatus !== "IN_PROGRESS"
                }
                onClick={handleRollDice}
              />
            </div>
          </div>
        </div>

        {/* ── Recent Turn History Log (Shown on non-short viewports) ── */}
        {!ludoFit.isShortViewport && engine.turnHistory.length > 0 && (
          <div className="mt-2 px-3 py-1.5 rounded-xl bg-slate-950/70 border border-white/5 flex items-center justify-between gap-2 text-[10px] text-slate-300">
            <span className="truncate">
              <History className="w-3 h-3 text-amber-400 inline mr-1" />
              <strong className="text-amber-300 font-mono">
                #{engine.turnHistory[engine.turnHistory.length - 1].moveNumber}
              </strong>{" "}
              {engine.turnHistory[engine.turnHistory.length - 1].summary}
            </span>
            <span className="font-mono text-slate-400 shrink-0">
              🎲 {engine.turnHistory[engine.turnHistory.length - 1].diceValue}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
