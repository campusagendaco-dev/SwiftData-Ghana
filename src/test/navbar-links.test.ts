import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({}) }));
vi.mock("@/contexts/ThemeContext", () => ({ useAppTheme: () => ({}) }));
vi.mock("@/components/NotificationCenter", () => ({ NotificationCenter: () => null }));

import { PRIMARY_NAV_LINKS, getMoreNavLinks } from "@/components/Navbar";

const destinations = (showAgent: boolean) =>
  [...PRIMARY_NAV_LINKS, ...getMoreNavLinks(showAgent)].map((link) => link.to);

describe("public navigation links", () => {
  it("keeps every page from the previous bar reachable", () => {
    expect(destinations(true)).toEqual(
      expect.arrayContaining([
        "/",
        "/buy-data",
        "/buy-airtime",
        "/challenges",
        "/submit-numbers",
        "/order-status",
        "/blog",
        "/agent-program",
      ]),
    );
  });

  it("does not list a page twice", () => {
    const all = destinations(true);
    expect(new Set(all).size).toBe(all.length);
  });

  it("shows the agent link only when asked", () => {
    expect(destinations(true)).toContain("/agent-program");
    expect(destinations(false)).not.toContain("/agent-program");
  });
});
