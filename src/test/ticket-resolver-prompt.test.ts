import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "..", "supabase", "functions", "auto-ticket-resolver", "index.ts"), "utf8");
const between = (a: string, b: string) => {
  const i = src.indexOf(a);
  const j = src.indexOf(b, i + a.length);
  return i >= 0 && j > i ? src.slice(i, j) : "";
};

// Customers whose order failed must not be told it was refunded, and their ticket must stay
// open for staff. Only an order whose status is exactly "refunded" may close the ticket.
describe("auto-ticket-resolver prompt", () => {
  it("keeps failed-order tickets open", () => {
    const failed = between("If the matching order's Status is failed", "- Otherwise");
    expect(failed).toContain("set should_resolve to false");
    expect(failed).not.toMatch(/close\/resolve|should_resolve to true/);
  });

  it("closes only tickets about a refunded order", () => {
    const refunded = between('whose Status is exactly "refunded"', "- If the matching order's Status is failed");
    expect(refunded).toContain("set should_resolve to true");
  });

  it("runs on its own model as on main, not the ops worker's", () => {
    expect(src).toMatch(/callAiAgent\(\s*supabase,\s*"auto_ticket_resolver",/);
    expect(src).toMatch(/forceModel:\s*"claude-sonnet-4-5-20250929"/);
  });
});
