import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import GameShell from "@/games/kit/GameShell";
import GameResultScreen from "@/games/kit/GameResultScreen";
import { useConnectionStatus } from "@/games/kit/useConnectionStatus";

const shellProps = {
  title: "Ghana Ludo",
  players: [
    { name: "Kofi", active: true, score: 3 },
    { name: "Ama", active: false },
  ],
  connection: "online" as const,
  soundOn: true,
  onToggleSound: vi.fn(),
  onHelp: vi.fn(),
  onExit: vi.fn(),
};

describe("GameShell", () => {
  it("shows the game, players and whose turn it is", () => {
    render(<GameShell {...shellProps}><p>Board</p></GameShell>);
    expect(screen.getByRole("heading", { name: "Ghana Ludo" })).toBeInTheDocument();
    expect(screen.getByText("Board")).toBeInTheDocument();
    expect(screen.getByText("Kofi").closest("[aria-current]")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Ama").closest("[aria-current]")).toBeNull();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("formats the turn timer", () => {
    render(<GameShell {...shellProps} secondsLeft={65}><p>Board</p></GameShell>);
    expect(screen.getByRole("timer")).toHaveTextContent("1:05");
  });

  it("hides the timer when the game has none", () => {
    render(<GameShell {...shellProps}><p>Board</p></GameShell>);
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("warns when the connection drops", () => {
    render(<GameShell {...shellProps} connection="offline"><p>Board</p></GameShell>);
    expect(screen.getByRole("status")).toHaveTextContent(/connection lost/i);
  });

  it("runs the sound, help and exit controls", () => {
    render(<GameShell {...shellProps}><p>Board</p></GameShell>);
    fireEvent.click(screen.getByRole("button", { name: "Turn sound off" }));
    fireEvent.click(screen.getByRole("button", { name: "How to play" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave game" }));
    expect(shellProps.onToggleSound).toHaveBeenCalled();
    expect(shellProps.onHelp).toHaveBeenCalled();
    expect(shellProps.onExit).toHaveBeenCalled();
  });
});

describe("GameResultScreen", () => {
  it.each([
    ["win", /you won/i],
    ["lose", /so close/i],
    ["draw", /draw/i],
  ] as const)("shows the %s message", (outcome, text) => {
    render(<GameResultScreen outcome={outcome} onExit={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent(text);
  });

  it("shows points earned", () => {
    render(<GameResultScreen outcome="win" points={35} onExit={() => {}} />);
    expect(screen.getByText("+35 Arena Points")).toBeInTheDocument();
  });

  it("offers a rematch only when one is available", () => {
    const onRematch = vi.fn();
    const { rerender } = render(<GameResultScreen outcome="win" onExit={() => {}} />);
    expect(screen.queryByRole("button", { name: "Play again" })).toBeNull();
    rerender(<GameResultScreen outcome="win" onExit={() => {}} onRematch={onRematch} />);
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(onRematch).toHaveBeenCalled();
  });
});

describe("useConnectionStatus", () => {
  it("follows the browser's connection events", () => {
    const { result } = renderHook(() => useConnectionStatus());
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(result.current).toBe("offline");
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(result.current).toBe("online");
  });
});
