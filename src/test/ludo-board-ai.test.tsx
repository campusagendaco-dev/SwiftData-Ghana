import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel, send: async () => "ok", track: async () => "ok", presenceState: () => ({}) };
  return { supabase: { channel: () => channel, removeChannel: () => {} } };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({}) }));

import { GhanaLudoBoard, INITIAL_LUDO_STATE, normalizeIncomingLudoState } from "@/components/games/GhanaLudoBoard";
import { switchPlayer } from "@/lib/ludo-engine";

describe("Ludo starting board", () => {
  it.each(["free_data", "ai"] as const)("makes Yellow a computer in %s matches", (mode) => {
    const state = normalizeIncomingLudoState(INITIAL_LUDO_STATE, "Kofi", "Ama", mode);
    expect(state.engine.playerMeta.YELLOW.isAI).toBe(true);
    expect(state.engine.playerMeta.RED.isAI).toBe(false);
    expect(state.engine.playerMeta.RED.name).toBe("Kofi");
  });

  it("keeps both seats human in online matches", () => {
    const state = normalizeIncomingLudoState(INITIAL_LUDO_STATE, "Kofi", "Ama", "p2p");
    expect(state.engine.playerMeta.YELLOW.isAI).toBe(false);
  });

  it("leaves a game already in progress alone", () => {
    const inProgress = { ...INITIAL_LUDO_STATE, moveCount: 4 };
    expect(normalizeIncomingLudoState(inProgress, "Kofi", "Ama", "free_data")).toBe(inProgress);
  });
});

describe("Ludo computer turn", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rolls the dice by itself", async () => {
    const start = normalizeIncomingLudoState(INITIAL_LUDO_STATE, "Kofi", "Ama", "free_data");
    const yellowsTurn = { ...start, moveCount: 1, engine: switchPlayer(start.engine) };
    const onStateChange = vi.fn();

    render(
      <GhanaLudoBoard
        mode="free_data"
        mySide="creator"
        creatorName="Kofi"
        opponentName="Ama"
        initialState={yellowsTurn}
        onStateChange={onStateChange}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(onStateChange).toHaveBeenCalled();
  });
});
