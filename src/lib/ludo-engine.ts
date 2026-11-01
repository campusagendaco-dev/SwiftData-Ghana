/**
 * COMPLETE RULE-BASED DETERMINISTIC LUDO GAMEPLAY ENGINE
 * Pure TypeScript gameplay mechanics & state-transition engine (Zero UI dependencies).
 * Implements all 13 sections of the Ludo Gameplay Specification:
 * - 2 to 4 players (RED, GREEN, YELLOW, BLUE)
 * - 4 tokens per player initialized in BASE
 * - 52-cell clockwise main track (indices 0..51)
 * - 6-cell private home path per player (positions 1..5 = HOME_PATH, 6 = FINISHED)
 * - 8 protected safe squares (4 starting squares + 4 star squares)
 * - Blockade formation & path-blocking validation (2+ same-player tokens on a square)
 * - Exact dice roll required to reach final home (position 6 / stepsFromStart 56)
 * - Extra turns on rolling 6 or capturing an opponent token (with configurable max consecutive 6s)
 */

export type LudoPlayerId = "RED" | "GREEN" | "YELLOW" | "BLUE";

export type LudoTokenStatus = "BASE" | "ACTIVE" | "HOME_PATH" | "FINISHED";

export type LudoMatchStatus = "WAITING" | "IN_PROGRESS" | "COMPLETED";

export interface LudoRuleConfig {
  blockadeRulesEnabled: boolean;
  protectStartingSquares: boolean;
  protectStarSquares: boolean;
  allowMultipleTokensSameSquare: boolean;
  maxConsecutiveSixes: number; // Default 3: third consecutive 6 forfeits move & switches turn
  tokensToWin: number; // Default 4 (all 4 tokens must reach FINISHED)
}

export const DEFAULT_LUDO_CONFIG: LudoRuleConfig = {
  blockadeRulesEnabled: false,
  protectStartingSquares: true,
  protectStarSquares: true,
  allowMultipleTokensSameSquare: true,
  maxConsecutiveSixes: 3,
  tokensToWin: 4,
};

export interface LudoToken {
  id: string; // e.g. "RED-0", "RED-1", "RED-2", "RED-3"
  tokenIndex: number; // 0..3
  owner: LudoPlayerId;
  status: LudoTokenStatus;
  /**
   * Distance travelled from player's starting square:
   * -1 = BASE
   * 0..50 = ACTIVE on the 52-cell main track (51 squares from start to home-entry square)
   * 51..55 = HOME_PATH cells 1..5
   * 56 = FINISHED (cell 6 of home path / final home triangle)
   */
  stepsFromStart: number;
  /**
   * 0..51 when status === "ACTIVE", otherwise null
   */
  trackPosition: number | null;
  /**
   * 1..5 when status === "HOME_PATH", 6 when status === "FINISHED", otherwise 0
   */
  homePathPosition: number;
}

export interface LudoPlayerMeta {
  id: LudoPlayerId;
  name: string;
  isAI?: boolean;
  invitedPhone?: string | null;
  userId?: string | null;
  startTrackIndex: number;
  homeEntryTrackIndex: number;
}

export interface LudoLegalMove {
  tokenId: string;
  tokenIndex: number;
  owner: LudoPlayerId;
  fromStatus: LudoTokenStatus;
  toStatus: LudoTokenStatus;
  fromSteps: number;
  toSteps: number;
  fromTrackPosition: number | null;
  toTrackPosition: number | null;
  toHomePathPosition: number;
  willCaptureTokenIds: string[];
}

export interface LudoTurnHistoryEntry {
  moveNumber: number;
  player: LudoPlayerId;
  diceValue: number;
  tokenId: string | null;
  action: "ROLL_LAUNCH" | "MOVE" | "CAPTURE" | "ENTER_HOME_PATH" | "FINISH_TOKEN" | "PASS_NO_MOVES" | "TRIPLE_SIX_FORFEIT";
  fromSteps: number | null;
  toSteps: number | null;
  capturedTokenIds: string[];
  grantedExtraTurn: boolean;
  summary: string;
  timestamp: number;
}

export interface LudoGameState {
  players: LudoPlayerId[]; // Turn order of active players (2..4)
  playerMeta: Record<LudoPlayerId, LudoPlayerMeta>;
  currentPlayerIndex: number;
  currentPlayer: LudoPlayerId;
  diceResult: number | null;
  consecutiveSixes: number;
  tokens: Record<LudoPlayerId, LudoToken[]>;
  safeSquares: number[]; // Main track indices (0..51)
  legalMoves: LudoLegalMove[];
  capturedTokensHistory: {
    byPlayer: LudoPlayerId;
    capturedTokenId: string;
    atTrackPosition: number;
    moveNumber: number;
  }[];
  matchStatus: LudoMatchStatus;
  winner: LudoPlayerId | null;
  turnHistory: LudoTurnHistoryEntry[];
  moveCount: number;
  config: LudoRuleConfig;
}

// ── Track Constants (52-Cell Main Track + 6-Cell Private Home Path) ──────────

export const MAIN_TRACK_LENGTH = 52;
export const LAST_MAIN_TRACK_STEP = 50; // Step 0 is start cell; step 50 is the 51st cell right before entering private home path
export const HOME_PATH_LENGTH = 6; // Cells 1..5 are the colored home stretch; Cell 6 is the final home triangle
export const FINAL_HOME_STEP = LAST_MAIN_TRACK_STEP + HOME_PATH_LENGTH; // 56

export const PLAYER_START_TRACK_INDEX: Record<LudoPlayerId, number> = {
  RED: 0,
  GREEN: 13,
  YELLOW: 26,
  BLUE: 39,
};

export const PLAYER_HOME_ENTRY_TRACK_INDEX: Record<LudoPlayerId, number> = {
  RED: 50,
  GREEN: 11,
  YELLOW: 24,
  BLUE: 37,
};

export const STAR_SAFE_TRACK_INDICES: number[] = [8, 21, 34, 47];
export const START_SAFE_TRACK_INDICES: number[] = [0, 13, 26, 39];

export interface InitializeLudoOptions {
  players?: LudoPlayerId[];
  playerNames?: Partial<Record<LudoPlayerId, string>>;
  playerMetaOverrides?: Partial<Record<LudoPlayerId, Partial<LudoPlayerMeta>>>;
  startingPlayer?: LudoPlayerId;
  config?: Partial<LudoRuleConfig>;
}

/**
 * Helper: Converts a player's relative stepsFromStart (0..50) to an absolute 0..51 main-track index.
 */
export function stepsToTrackIndex(owner: LudoPlayerId, stepsFromStart: number): number | null {
  if (stepsFromStart < 0 || stepsFromStart > LAST_MAIN_TRACK_STEP) return null;
  return (PLAYER_START_TRACK_INDEX[owner] + stepsFromStart) % MAIN_TRACK_LENGTH;
}

/**
 * 1. initializeGame()
 * Initializes a 2–4 player Ludo game with all 4 tokens per player inside their BASE,
 * configures safe squares, and sets the initial turn order.
 */
export function initializeGame(options: InitializeLudoOptions = {}): LudoGameState {
  const defaultPlayers: LudoPlayerId[] =
    options.players && options.players.length >= 2 && options.players.length <= 4
      ? [...options.players]
      : ["RED", "YELLOW"]; // Standard 2-player opposite corners; supports 2, 3, or 4 players

  const config: LudoRuleConfig = {
    ...DEFAULT_LUDO_CONFIG,
    ...(options.config || {}),
  };

  const safeSet = new Set<number>();
  if (config.protectStartingSquares) {
    START_SAFE_TRACK_INDICES.forEach((idx) => safeSet.add(idx));
  }
  if (config.protectStarSquares) {
    STAR_SAFE_TRACK_INDICES.forEach((idx) => safeSet.add(idx));
  }

  const allColors: LudoPlayerId[] = ["RED", "GREEN", "YELLOW", "BLUE"];
  const tokens: Record<LudoPlayerId, LudoToken[]> = {
    RED: [],
    GREEN: [],
    YELLOW: [],
    BLUE: [],
  };

  const playerMeta: Record<LudoPlayerId, LudoPlayerMeta> = {} as Record<
    LudoPlayerId,
    LudoPlayerMeta
  >;

  for (const color of allColors) {
    tokens[color] = Array.from({ length: 4 }, (_, idx) => ({
      id: `${color}-${idx}`,
      tokenIndex: idx,
      owner: color,
      status: "BASE",
      stepsFromStart: -1,
      trackPosition: null,
      homePathPosition: 0,
    }));

    const override = options.playerMetaOverrides?.[color] || {};
    playerMeta[color] = {
      id: color,
      name: options.playerNames?.[color] || override.name || `${color} Player`,
      isAI: Boolean(override.isAI),
      invitedPhone: override.invitedPhone || null,
      userId: override.userId || null,
      startTrackIndex: PLAYER_START_TRACK_INDEX[color],
      homeEntryTrackIndex: PLAYER_HOME_ENTRY_TRACK_INDEX[color],
    };
  }

  const startIdx = options.startingPlayer
    ? Math.max(0, defaultPlayers.indexOf(options.startingPlayer))
    : 0;

  return {
    players: defaultPlayers,
    playerMeta,
    currentPlayerIndex: startIdx,
    currentPlayer: defaultPlayers[startIdx],
    diceResult: null,
    consecutiveSixes: 0,
    tokens,
    safeSquares: Array.from(safeSet).sort((a, b) => a - b),
    legalMoves: [],
    capturedTokensHistory: [],
    matchStatus: "IN_PROGRESS",
    winner: null,
    turnHistory: [],
    moveCount: 0,
    config,
  };
}

/**
 * 8. checkSafeSquare()
 * Checks whether a main-track position (0..51) is a protected safe square.
 */
export function checkSafeSquare(
  state: LudoGameState,
  trackPosition: number | null
): boolean {
  if (trackPosition === null || trackPosition < 0 || trackPosition >= MAIN_TRACK_LENGTH) {
    return false;
  }
  return state.safeSquares.includes(trackPosition);
}

/**
 * 9. checkBlockade()
 * Checks whether 2 or more tokens belonging to the same player occupy `trackPosition`,
 * forming a blockade. Returns the owner of the blockade if one exists, or null.
 */
export function checkBlockade(
  state: LudoGameState,
  trackPosition: number
): { isBlockade: boolean; owner: LudoPlayerId | null; count: number } {
  if (!state.config.blockadeRulesEnabled) {
    return { isBlockade: false, owner: null, count: 0 };
  }

  for (const player of state.players) {
    const count = (state.tokens[player] || []).filter(
      (t) => t.status === "ACTIVE" && t.trackPosition === trackPosition
    ).length;
    if (count >= 2) {
      return { isBlockade: true, owner: player, count };
    }
  }

  return { isBlockade: false, owner: null, count: 0 };
}

/**
 * Helper: Checks if an opponent blockade blocks the path along steps `(fromSteps + 1) .. toSteps`.
 */
function isPathBlockedByOpponentBlockade(
  state: LudoGameState,
  player: LudoPlayerId,
  fromSteps: number,
  toSteps: number
): boolean {
  if (!state.config.blockadeRulesEnabled) return false;

  // Launching from BASE (-1 -> 0): check starting square (0)
  if (fromSteps === -1 && toSteps === 0) {
    const startTrack = PLAYER_START_TRACK_INDEX[player];
    const blk = checkBlockade(state, startTrack);
    return blk.isBlockade && blk.owner !== player;
  }

  // Moving along main track: check every square stepped on (intermediate & destination)
  for (let step = fromSteps + 1; step <= Math.min(toSteps, LAST_MAIN_TRACK_STEP); step++) {
    const trackIdx = stepsToTrackIndex(player, step);
    if (trackIdx !== null) {
      const blk = checkBlockade(state, trackIdx);
      if (blk.isBlockade && blk.owner !== player) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 10. enterHomePath()
 * Computes the resulting status, trackPosition, and homePathPosition when a token advances
 * to `targetSteps` (0..56).
 */
export function enterHomePath(
  owner: LudoPlayerId,
  targetSteps: number
): {
  status: LudoTokenStatus;
  trackPosition: number | null;
  homePathPosition: number;
} {
  if (targetSteps < 0) {
    return { status: "BASE", trackPosition: null, homePathPosition: 0 };
  }
  if (targetSteps <= LAST_MAIN_TRACK_STEP) {
    return {
      status: "ACTIVE",
      trackPosition: stepsToTrackIndex(owner, targetSteps),
      homePathPosition: 0,
    };
  }
  if (targetSteps < FINAL_HOME_STEP) {
    return {
      status: "HOME_PATH",
      trackPosition: null,
      homePathPosition: targetSteps - LAST_MAIN_TRACK_STEP, // 1..5
    };
  }
  return {
    status: "FINISHED",
    trackPosition: null,
    homePathPosition: HOME_PATH_LENGTH, // 6
  };
}

/**
 * 3. validateDiceRoll()
 * Validates whether `player` is allowed to roll the dice in the current game state.
 */
export function validateDiceRoll(
  state: LudoGameState,
  player: LudoPlayerId,
  proposedDiceValue?: number
): { valid: boolean; reason?: string } {
  if (state.matchStatus !== "IN_PROGRESS" || state.winner !== null) {
    return { valid: false, reason: "Match has already ended." };
  }
  if (state.currentPlayer !== player) {
    return { valid: false, reason: `It is ${state.currentPlayer}'s turn, not ${player}'s.` };
  }
  if (state.diceResult !== null) {
    return {
      valid: false,
      reason: "Dice has already been rolled for this turn. Complete your move first.",
    };
  }
  if (
    proposedDiceValue !== undefined &&
    (!Number.isInteger(proposedDiceValue) || proposedDiceValue < 1 || proposedDiceValue > 6)
  ) {
    return { valid: false, reason: "Dice value must be an integer between 1 and 6." };
  }
  return { valid: true };
}

/**
 * 5. validateMove()
 * Validates whether `player` can move `tokenIndex` using the current `state.diceResult`.
 */
export function validateMove(
  state: LudoGameState,
  player: LudoPlayerId,
  tokenIndex: number
): {
  valid: boolean;
  reason?: string;
  move?: LudoLegalMove;
} {
  if (state.matchStatus !== "IN_PROGRESS" || state.winner !== null) {
    return { valid: false, reason: "Match is not in progress." };
  }
  if (state.currentPlayer !== player) {
    return { valid: false, reason: "Current player does not own this turn." };
  }
  const dice = state.diceResult;
  if (dice === null || dice < 1 || dice > 6) {
    return { valid: false, reason: "Dice must be rolled before moving a token." };
  }

  const playerTokens = state.tokens[player];
  if (!playerTokens || tokenIndex < 0 || tokenIndex >= playerTokens.length) {
    return { valid: false, reason: "Invalid token index." };
  }

  const token = playerTokens[tokenIndex];
  if (token.owner !== player) {
    return { valid: false, reason: "Player does not own the selected token." };
  }
  if (token.status === "FINISHED") {
    return { valid: false, reason: "Finished tokens cannot move again." };
  }

  // Case A: Token is in BASE
  if (token.status === "BASE") {
    if (dice !== 6) {
      return { valid: false, reason: "Must roll a 6 to move a token out of base." };
    }
    if (isPathBlockedByOpponentBlockade(state, player, -1, 0)) {
      return {
        valid: false,
        reason: "Starting square is blocked by an opponent blockade.",
      };
    }

    const startTrack = PLAYER_START_TRACK_INDEX[player];
    const capturableIds = getCapturableOpponentTokenIds(state, player, startTrack);

    return {
      valid: true,
      move: {
        tokenId: token.id,
        tokenIndex: token.tokenIndex,
        owner: player,
        fromStatus: "BASE",
        toStatus: "ACTIVE",
        fromSteps: -1,
        toSteps: 0,
        fromTrackPosition: null,
        toTrackPosition: startTrack,
        toHomePathPosition: 0,
        willCaptureTokenIds: capturableIds,
      },
    };
  }

  // Case B: Token is ACTIVE or on HOME_PATH
  const targetSteps = token.stepsFromStart + dice;
  if (targetSteps > FINAL_HOME_STEP) {
    return {
      valid: false,
      reason: "Dice value exceeds exact remaining distance to final home.",
    };
  }

  // Check if path or destination is blocked by an opponent blockade
  if (isPathBlockedByOpponentBlockade(state, player, token.stepsFromStart, targetSteps)) {
    return {
      valid: false,
      reason: "Move is blocked by an opponent blockade on the main track.",
    };
  }

  const dest = enterHomePath(player, targetSteps);

  // If multiple tokens of same player on same square are disallowed by custom config
  if (
    !state.config.allowMultipleTokensSameSquare &&
    dest.status !== "FINISHED"
  ) {
    const occupiedBySelf = playerTokens.some(
      (t) =>
        t.id !== token.id &&
        t.stepsFromStart === targetSteps
    );
    if (occupiedBySelf) {
      return {
        valid: false,
        reason: "Multiple tokens on the same square are disabled by configuration.",
      };
    }
  }

  const capturableIds =
    dest.status === "ACTIVE" && dest.trackPosition !== null
      ? getCapturableOpponentTokenIds(state, player, dest.trackPosition)
      : [];

  return {
    valid: true,
    move: {
      tokenId: token.id,
      tokenIndex: token.tokenIndex,
      owner: player,
      fromStatus: token.status,
      toStatus: dest.status,
      fromSteps: token.stepsFromStart,
      toSteps: targetSteps,
      fromTrackPosition: token.trackPosition,
      toTrackPosition: dest.trackPosition,
      toHomePathPosition: dest.homePathPosition,
      willCaptureTokenIds: capturableIds,
    },
  };
}

/**
 * Helper: Finds all opponent tokens at `trackPosition` that can be captured.
 */
function getCapturableOpponentTokenIds(
  state: LudoGameState,
  mover: LudoPlayerId,
  trackPosition: number
): string[] {
  if (checkSafeSquare(state, trackPosition)) {
    return [];
  }

  const blk = checkBlockade(state, trackPosition);
  if (blk.isBlockade && blk.owner !== mover) {
    // Cannot capture a protected blockade
    return [];
  }

  const ids: string[] = [];
  for (const p of state.players) {
    if (p === mover) continue;
    for (const t of state.tokens[p] || []) {
      if (t.status === "ACTIVE" && t.trackPosition === trackPosition) {
        ids.push(t.id);
      }
    }
  }
  return ids;
}

/**
 * 4. calculateLegalMoves()
 * Returns all valid token moves for the current player and dice result.
 */
export function calculateLegalMoves(
  state: LudoGameState,
  player: LudoPlayerId = state.currentPlayer
): LudoLegalMove[] {
  if (state.matchStatus !== "IN_PROGRESS" || state.diceResult === null) {
    return [];
  }
  const tokens = state.tokens[player] || [];
  const moves: LudoLegalMove[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const res = validateMove(state, player, i);
    if (res.valid && res.move) {
      moves.push(res.move);
    }
  }
  return moves;
}

/**
 * 7. captureOpponent()
 * Sends any opponent tokens on a capturable main-track square back to their BASE.
 */
export function captureOpponent(
  state: LudoGameState,
  mover: LudoPlayerId,
  trackPosition: number | null
): {
  tokens: Record<LudoPlayerId, LudoToken[]>;
  capturedTokenIds: string[];
} {
  if (trackPosition === null || checkSafeSquare(state, trackPosition)) {
    return { tokens: state.tokens, capturedTokenIds: [] };
  }

  const capturableIds = new Set(getCapturableOpponentTokenIds(state, mover, trackPosition));
  if (capturableIds.size === 0) {
    return { tokens: state.tokens, capturedTokenIds: [] };
  }

  const nextTokens: Record<LudoPlayerId, LudoToken[]> = {
    RED: [...state.tokens.RED],
    GREEN: [...state.tokens.GREEN],
    YELLOW: [...state.tokens.YELLOW],
    BLUE: [...state.tokens.BLUE],
  };

  const capturedList: string[] = [];
  for (const p of state.players) {
    if (p === mover) continue;
    nextTokens[p] = nextTokens[p].map((t) => {
      if (capturableIds.has(t.id)) {
        capturedList.push(t.id);
        return {
          ...t,
          status: "BASE",
          stepsFromStart: -1,
          trackPosition: null,
          homePathPosition: 0,
        };
      }
      return t;
    });
  }

  return { tokens: nextTokens, capturedTokenIds: capturedList };
}

/**
 * 11. checkWinningCondition()
 * Checks if `player` has moved all 4 tokens (or `config.tokensToWin`) into final `FINISHED` home.
 */
export function checkWinningCondition(
  state: LudoGameState,
  player: LudoPlayerId
): boolean {
  const playerTokens = state.tokens[player] || [];
  const finishedCount = playerTokens.filter(
    (t) => t.status === "FINISHED" && t.stepsFromStart === FINAL_HOME_STEP
  ).length;
  return finishedCount >= state.config.tokensToWin;
}

/**
 * 12. grantExtraTurn()
 * Determines whether the player keeps their turn:
 * Rolling a 6, capturing an opponent token, or reaching home gives another roll.
 */
export function grantExtraTurn(
  diceValue: number,
  capturedCount: number,
  hasWon: boolean,
  reachedHome: boolean = false
): boolean {
  if (hasWon) return false;
  return diceValue === 6 || capturedCount > 0 || reachedHome;
}

/**
 * Returns all opponent tokens currently on the 52-cell main track (progress 1..51 / stepsFromStart 0..50).
 */
export function getOpponentTokensOnTrack(
  state: LudoGameState,
  player: LudoPlayerId
): { opponent: LudoPlayerId; tokenIndex: number; trackIndex: number }[] {
  const tokensOnTrack: { opponent: LudoPlayerId; tokenIndex: number; trackIndex: number }[] = [];
  for (const opponent of state.players) {
    if (opponent === player) continue;
    (state.tokens[opponent] || []).forEach((t, tokenIndex) => {
      if (t.status === "ACTIVE" && t.trackPosition !== null) {
        tokensOnTrack.push({
          opponent,
          tokenIndex,
          trackIndex: t.trackPosition,
        });
      }
    });
  }
  return tokensOnTrack;
}

/**
 * Checks whether `trackIndex` has an opponent token 1..6 squares behind it on the 52-cell main track.
 */
export function isThreatened(
  trackIndex: number,
  opponentTokensOnTrack: { opponent: LudoPlayerId; tokenIndex: number; trackIndex: number }[]
): boolean {
  return opponentTokensOnTrack.some(({ trackIndex: opponentIndex }) => {
    const distanceBehind = (trackIndex - opponentIndex + MAIN_TRACK_LENGTH) % MAIN_TRACK_LENGTH;
    return distanceBehind >= 1 && distanceBehind <= 6;
  });
}

/**
 * Scores a candidate move using the reference Ludo tactical evaluation:
 * - Base score = destination progress (1..57)
 * - Reaching Home (57) = +100
 * - Leaving Base (fromProgress === 0) = +40
 * - Capturing opponent on non-safe track square = +70
 * - Landing on safe square = +15, else if destination is threatened = -30
 * - Escaping from a threatened non-safe origin square = +25
 * - Small random tie-breaker (+0..4)
 */
export function scoreMove(
  state: LudoGameState,
  player: LudoPlayerId,
  tokenIndex: number,
  rollValue: number
): number {
  const token = state.tokens[player]?.[tokenIndex];
  if (!token) return -Infinity;
  const fromProgress = token.stepsFromStart + 1; // 0 = BASE, 1..51 = TRACK, 52..56 = HOME_COLUMN, 57 = HOME
  const toProgress = fromProgress === 0 ? 1 : fromProgress + rollValue;
  const opponentTokens = getOpponentTokensOnTrack(state, player);
  let score = toProgress;
  if (toProgress === 57) score += 100;
  if (fromProgress === 0) score += 40;
  if (toProgress <= 51) {
    const destination = stepsToTrackIndex(player, toProgress - 1)!;
    const isSafe = checkSafeSquare(state, destination);
    if (!isSafe && opponentTokens.some((tok) => tok.trackIndex === destination)) score += 70;
    if (isSafe) score += 15;
    else if (isThreatened(destination, opponentTokens)) score -= 30;
  }
  if (fromProgress >= 1 && fromProgress <= 51) {
    const origin = stepsToTrackIndex(player, fromProgress - 1)!;
    if (!checkSafeSquare(state, origin) && isThreatened(origin, opponentTokens)) score += 25;
  }
  return score + Math.random() * 4;
}

/**
 * Selects the highest-scoring legal token index for computer players.
 */
export function chooseComputerToken(
  state: LudoGameState,
  player: LudoPlayerId,
  movableTokenIndexes: number[],
  rollValue: number
): number {
  return movableTokenIndexes.reduce((bestIndex, tokenIndex) =>
    scoreMove(state, player, tokenIndex, rollValue) > scoreMove(state, player, bestIndex, rollValue)
      ? tokenIndex
      : bestIndex
  );
}

/**
 * 13. switchPlayer()
 * Advances turn to the next player in `state.players` and resets turn-scoped dice state.
 */
export function switchPlayer(state: LudoGameState): LudoGameState {
  const nextIndex = (state.currentPlayerIndex + 1) % state.players.length;
  const nextPlayer = state.players[nextIndex];
  return {
    ...state,
    currentPlayerIndex: nextIndex,
    currentPlayer: nextPlayer,
    diceResult: null,
    consecutiveSixes: 0,
    legalMoves: [],
  };
}

/**
 * 14. updateGameState()
 * Immutable state updater that guarantees consistency of derived fields.
 */
export function updateGameState(
  state: LudoGameState,
  patch: Partial<LudoGameState>
): LudoGameState {
  return {
    ...state,
    ...patch,
  };
}

/**
 * 15. endGame()
 * Immediately transitions the match to COMPLETED and locks out further rolls or moves.
 */
export function endGame(state: LudoGameState, winner: LudoPlayerId): LudoGameState {
  return updateGameState(state, {
    matchStatus: "COMPLETED",
    winner,
    diceResult: null,
    legalMoves: [],
  });
}

/**
 * 2. rollDice()
 * Generates (or accepts a deterministic test value for) a 1..6 dice roll, validates the roll,
 * handles consecutive sixes, calculates legal moves, and automatically passes the turn
 * ONLY when no legal moves exist and no extra roll was granted by a 6.
 */
export function rollDice(
  state: LudoGameState,
  player: LudoPlayerId = state.currentPlayer,
  forcedDiceValue?: number
): {
  state: LudoGameState;
  diceValue: number | null;
  legalMoves: LudoLegalMove[];
  autoPassed: boolean;
  tripleSixForfeited: boolean;
  error?: string;
} {
  const validation = validateDiceRoll(state, player, forcedDiceValue);
  if (!validation.valid) {
    return {
      state,
      diceValue: null,
      legalMoves: [],
      autoPassed: false,
      tripleSixForfeited: false,
      error: validation.reason,
    };
  }

  const diceValue =
    forcedDiceValue !== undefined
      ? forcedDiceValue
      : Math.floor(Math.random() * 6) + 1;

  const nextConsecutiveSixes = diceValue === 6 ? state.consecutiveSixes + 1 : 0;

  // Handle configurable consecutive sixes limit (e.g. 3 consecutive sixes forfeits turn)
  if (
    state.config.maxConsecutiveSixes > 0 &&
    nextConsecutiveSixes >= state.config.maxConsecutiveSixes
  ) {
    const moveNumber = state.moveCount + 1;
    const historyEntry: LudoTurnHistoryEntry = {
      moveNumber,
      player,
      diceValue,
      tokenId: null,
      action: "TRIPLE_SIX_FORFEIT",
      fromSteps: null,
      toSteps: null,
      capturedTokenIds: [],
      grantedExtraTurn: false,
      summary: `${state.playerMeta[player]?.name || player} rolled three consecutive 6s! Turn forfeited.`,
      timestamp: Date.now(),
    };

    const switched = switchPlayer({
      ...state,
      moveCount: moveNumber,
      turnHistory: [...state.turnHistory, historyEntry],
    });

    return {
      state: switched,
      diceValue,
      legalMoves: [],
      autoPassed: true,
      tripleSixForfeited: true,
    };
  }

  const stateWithDice = updateGameState(state, {
    diceResult: diceValue,
    consecutiveSixes: nextConsecutiveSixes,
  });

  const legalMoves = calculateLegalMoves(stateWithDice, player);

  // If no legal move exists, automatically pass turn
  if (legalMoves.length === 0) {
    const moveNumber = state.moveCount + 1;
    const playerName = state.playerMeta[player]?.name || player;
    const historyEntry: LudoTurnHistoryEntry = {
      moveNumber,
      player,
      diceValue,
      tokenId: null,
      action: "PASS_NO_MOVES",
      fromSteps: null,
      toSteps: null,
      capturedTokenIds: [],
      grantedExtraTurn: false,
      summary: `${playerName} rolled a ${diceValue}: no move possible.`,
      timestamp: Date.now(),
    };

    const switched = switchPlayer({
      ...stateWithDice,
      moveCount: moveNumber,
      turnHistory: [...state.turnHistory, historyEntry],
    });

    return {
      state: switched,
      diceValue,
      legalMoves: [],
      autoPassed: true,
      tripleSixForfeited: false,
    };
  }

  // Legal moves exist: wait for player to choose a token (NEVER auto-move when multiple options exist)
  const readyState = updateGameState(stateWithDice, {
    legalMoves,
  });

  return {
    state: readyState,
    diceValue,
    legalMoves,
    autoPassed: false,
    tripleSixForfeited: false,
  };
}

/**
 * 6. moveToken()
 * Validates and executes a token move for `player`, handles opponent captures,
 * checks winning condition, and either grants an extra turn or switches player.
 */
export function moveToken(
  state: LudoGameState,
  player: LudoPlayerId,
  tokenIndex: number
): {
  state: LudoGameState;
  movedMove?: LudoLegalMove;
  capturedTokenIds: string[];
  earnedExtraTurn: boolean;
  winner: LudoPlayerId | null;
  error?: string;
} {
  const validation = validateMove(state, player, tokenIndex);
  if (!validation.valid || !validation.move) {
    return {
      state,
      capturedTokenIds: [],
      earnedExtraTurn: false,
      winner: state.winner,
      error: validation.reason,
    };
  }

  const move = validation.move;
  const diceValue = state.diceResult!;

  // 1. Update the moving player's token
  const updatedPlayerTokens = state.tokens[player].map((t, idx) => {
    if (idx !== tokenIndex) return t;
    return {
      ...t,
      status: move.toStatus,
      stepsFromStart: move.toSteps,
      trackPosition: move.toTrackPosition,
      homePathPosition: move.toHomePathPosition,
    };
  });

  const intermediateState: LudoGameState = {
    ...state,
    tokens: {
      ...state.tokens,
      [player]: updatedPlayerTokens,
    },
  };

  // 2. Execute capture mechanics if landing on an opponent on the main track
  const captureResult =
    move.toStatus === "ACTIVE" && move.toTrackPosition !== null
      ? captureOpponent(intermediateState, player, move.toTrackPosition)
      : { tokens: intermediateState.tokens, capturedTokenIds: [] };

  const moveNumber = state.moveCount + 1;
  const nextCapturedHistory = [
    ...state.capturedTokensHistory,
    ...captureResult.capturedTokenIds.map((id) => ({
      byPlayer: player,
      capturedTokenId: id,
      atTrackPosition: move.toTrackPosition!,
      moveNumber,
    })),
  ];

  let nextState: LudoGameState = updateGameState(intermediateState, {
    tokens: captureResult.tokens,
    capturedTokensHistory: nextCapturedHistory,
    moveCount: moveNumber,
  });

  // 3. Check winning condition (all 4 tokens in FINISHED state)
  const hasWon = checkWinningCondition(nextState, player);
  const reachedHome = move.toStatus === "FINISHED";
  const extraTurn = grantExtraTurn(
    diceValue,
    captureResult.capturedTokenIds.length,
    hasWon,
    reachedHome
  );

  // 4. Build descriptive turn history entry
  const playerName = state.playerMeta[player]?.name || player;
  let actionType: LudoTurnHistoryEntry["action"] = "MOVE";
  let summary = `${playerName} moved Token #${tokenIndex + 1} by ${diceValue}.`;

  if (move.fromStatus === "BASE") {
    actionType = "ROLL_LAUNCH";
    summary =
      captureResult.capturedTokenIds.length > 0
        ? `🚀 ${playerName} launched Token #${tokenIndex + 1}, captured ${captureResult.capturedTokenIds.join(", ")}, and rolls again!`
        : `🚀 ${playerName} rolled 6, launched Token #${tokenIndex + 1} onto Start, and rolls again!`;
  } else if (reachedHome) {
    actionType = "FINISH_TOKEN";
    summary = hasWon
      ? `🏆 ${playerName} wins the game! All 4 tokens reached Home!`
      : `🏠 ${playerName} brought Token #${tokenIndex + 1} into Final Home by exact roll (${diceValue}) and rolls again!`;
  } else if (captureResult.capturedTokenIds.length > 0) {
    actionType = "CAPTURE";
    summary = `💥 ${playerName} captured a token (${captureResult.capturedTokenIds.join(", ")}) and rolls again!`;
  } else if (move.fromStatus === "ACTIVE" && move.toStatus === "HOME_PATH") {
    actionType = "ENTER_HOME_PATH";
    summary =
      diceValue === 6
        ? `🛡️ ${playerName}'s Token #${tokenIndex + 1} entered the Home Column and rolls again!`
        : `🛡️ ${playerName}'s Token #${tokenIndex + 1} entered the protected Home Column!`;
  } else if (diceValue === 6) {
    summary = `🎲 ${playerName} advanced Token #${tokenIndex + 1} by 6 and rolls again!`;
  }

  const historyEntry: LudoTurnHistoryEntry = {
    moveNumber,
    player,
    diceValue,
    tokenId: move.tokenId,
    action: actionType,
    fromSteps: move.fromSteps,
    toSteps: move.toSteps,
    capturedTokenIds: captureResult.capturedTokenIds,
    grantedExtraTurn: extraTurn,
    summary,
    timestamp: Date.now(),
  };

  nextState = updateGameState(nextState, {
    turnHistory: [...nextState.turnHistory, historyEntry],
  });

  if (hasWon) {
    nextState = endGame(nextState, player);
    return {
      state: nextState,
      movedMove: move,
      capturedTokenIds: captureResult.capturedTokenIds,
      earnedExtraTurn: false,
      winner: player,
    };
  }

  if (extraTurn) {
    nextState = updateGameState(nextState, {
      diceResult: null,
      legalMoves: [],
    });
  } else {
    nextState = switchPlayer(nextState);
  }

  return {
    state: nextState,
    movedMove: move,
    capturedTokenIds: captureResult.capturedTokenIds,
    earnedExtraTurn: extraTurn,
    winner: null,
  };
}

