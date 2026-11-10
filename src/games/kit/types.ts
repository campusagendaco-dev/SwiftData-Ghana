import type { ComponentType, LazyExoticComponent } from "react";
import type { GameType } from "@/components/games/hub/gameCatalog";

export type MatchMode = "p2p" | "ai" | "free_data";
export type MatchSide = "creator" | "opponent";
export type MatchWinner = MatchSide | "draw";

/**
 * server-checked: the server validates every move and decides the winner.
 * points-only: the game runs on the player's device, so it can only earn Arena Points.
 */
export type VerificationLevel = "server-checked" | "points-only";

export interface GameBoardProps {
  mode: MatchMode;
  mySide: MatchSide;
  creatorName: string;
  opponentName: string;
  challengeId?: string;
  roomCode?: string;
  onFinish: (winner: MatchWinner, pointsEarned: number) => void;
}

export interface GameModule {
  id: GameType;
  verification: VerificationLevel;
  modes: MatchMode[];
  howToPlay: string[];
  Board: LazyExoticComponent<ComponentType<GameBoardProps>>;
}
