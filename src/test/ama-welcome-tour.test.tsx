import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

let auth: any = {};
const navigate = vi.fn();
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

// Some test environments have no localStorage; give the tour a simple in-memory one.
if (typeof globalThis.localStorage === "undefined" || typeof globalThis.localStorage?.clear !== "function") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

import AmaWelcomeTour from "@/components/ama/AmaWelcomeTour";
import { TOUR_START_EVENT } from "@/lib/amaTour";

const newUser = () => ({ user: { id: "u1", created_at: new Date().toISOString() }, profile: { is_agent: false, is_sub_agent: false }, isAdmin: false });

describe("Ama's welcome tour", () => {
  beforeEach(() => {
    navigate.mockReset();
    localStorage.clear();
    auth = newUser();
  });
  afterEach(cleanup);

  it("greets a new user and walks through the stops", () => {
    render(<AmaWelcomeTour />);
    expect(screen.getByText("Akwaaba! I'm Ama 👋")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Your wallet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Akwaaba! I'm Ama 👋")).toBeInTheDocument();
  });

  it("opens the page for a stop with Show me", () => {
    render(<AmaWelcomeTour />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    expect(navigate).toHaveBeenCalledWith("/dashboard/wallet");
  });

  it("is shown only once: skipping remembers it", () => {
    render(<AmaWelcomeTour />);
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByText("Akwaaba! I'm Ama 👋")).not.toBeInTheDocument();
    cleanup();
    render(<AmaWelcomeTour />);
    expect(screen.queryByText("Akwaaba! I'm Ama 👋")).not.toBeInTheDocument();
  });

  it("finishes on the last stop", () => {
    render(<AmaWelcomeTour />);
    let guard = 0;
    while (screen.queryByRole("button", { name: "Next" }) && guard++ < 30) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Just ask me")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.queryByText("Just ask me")).not.toBeInTheDocument();
    expect(localStorage.getItem("ama_tour_done:u1")).toBe("1");
  });

  it("doesn't interrupt older accounts, admins or signed-out visitors, but starts when asked", () => {
    auth = { ...newUser(), user: { id: "u2", created_at: "2025-01-01T00:00:00Z" } };
    render(<AmaWelcomeTour />);
    expect(screen.queryByText("Akwaaba! I'm Ama 👋")).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event(TOUR_START_EVENT));
    });
    expect(screen.getByText("Akwaaba! I'm Ama 👋")).toBeInTheDocument();
    cleanup();
    auth = { ...newUser(), isAdmin: true };
    render(<AmaWelcomeTour />);
    expect(screen.queryByText("Akwaaba! I'm Ama 👋")).not.toBeInTheDocument();
    cleanup();
    auth = { user: null, profile: null, isAdmin: false };
    render(<AmaWelcomeTour />);
    expect(screen.queryByText("Akwaaba! I'm Ama 👋")).not.toBeInTheDocument();
  });

  it("shows agents their business stops", () => {
    auth = { ...newUser(), profile: { is_agent: true, is_sub_agent: false } };
    render(<AmaWelcomeTour />);
    let guard = 0;
    while (!screen.queryByText("Your store") && guard++ < 30) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Your store")).toBeInTheDocument();
  });
});
