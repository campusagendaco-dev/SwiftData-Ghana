import { describe, expect, it } from "vitest";
import { shouldShowTour, tourSteps, TOUR_NEW_ACCOUNT_DAYS } from "@/lib/amaTour";

const NOW = new Date("2026-11-24T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe("who sees Ama's tour", () => {
  it("shows it once to a new account", () => {
    expect(shouldShowTour({ userCreatedAt: daysAgo(0), done: false, now: NOW })).toBe(true);
    expect(shouldShowTour({ userCreatedAt: daysAgo(0), done: true, now: NOW })).toBe(false);
  });

  it(`does not interrupt accounts older than ${TOUR_NEW_ACCOUNT_DAYS} days`, () => {
    expect(shouldShowTour({ userCreatedAt: daysAgo(TOUR_NEW_ACCOUNT_DAYS + 1), done: false, now: NOW })).toBe(false);
    expect(shouldShowTour({ userCreatedAt: null, done: false, now: NOW })).toBe(false);
  });

  it("always shows when the user asks for it", () => {
    expect(shouldShowTour({ userCreatedAt: daysAgo(400), done: true, now: NOW, requested: true })).toBe(true);
  });
});

describe("tour stops", () => {
  it("shows customers the basics and where to get help", () => {
    const paths = tourSteps({ isAgent: false, isSubAgent: false }).map((s) => s.path);
    expect(paths).toEqual(expect.arrayContaining(["/dashboard/wallet", "/dashboard/buy-data", "/dashboard/transactions", "/dashboard/report-issue"]));
    expect(paths).not.toContain("/dashboard/my-store");
  });

  it("adds the agent's business tools", () => {
    const paths = tourSteps({ isAgent: true, isSubAgent: false }).map((s) => s.path);
    expect(paths).toEqual(expect.arrayContaining(["/dashboard/my-store", "/dashboard/customers", "/dashboard/withdrawals", "/dashboard/subagents"]));
  });

  it("gives sub-agents the store but not their own sub-agents", () => {
    const paths = tourSteps({ isAgent: false, isSubAgent: true }).map((s) => s.path);
    expect(paths).toContain("/dashboard/my-store");
    expect(paths).not.toContain("/dashboard/subagents");
  });

  it("starts with a welcome and ends by pointing to Ama", () => {
    const steps = tourSteps({ isAgent: false, isSubAgent: false });
    expect(steps[0].path).toBeNull();
    expect(steps[steps.length - 1].title).toMatch(/ask me/i);
    for (const s of steps) expect(s.text.length).toBeLessThan(160);
  });
});
