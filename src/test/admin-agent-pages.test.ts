import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (f: string) => readFileSync(join(__dirname, "..", "pages", f), "utf8");

// Safe-agents design: a browser tab never runs agents on a timer, "Run now" asks first,
// and the page never claims an agent acts by itself.
describe("admin agent pages", () => {
  it("the Sentinel AI page does not run agents on a timer", () => {
    const src = read("AdminSentinelAI.tsx");
    expect(src).not.toMatch(/setInterval\([\s\S]{0,400}?(triggerSentinel|functions\.invoke)/);
  });

  it("Run now on the Security page asks in the confirmation box first", () => {
    const src = read("AdminSecurity.tsx");
    const run = src.indexOf("supabase.functions.invoke(agent.edgeFn");
    expect(run).toBeGreaterThan(0);
    expect(src.slice(Math.max(0, run - 1200), run)).toContain("confirmed.confirm(");
  });

  it("the ops worker card does not say it heals orders or runs every 5 minutes", () => {
    const src = read("AdminSecurity.tsx");
    expect(src).not.toMatch(/Heals stuck orders/i);
    expect(src).not.toMatch(/Autonomous Worker/);
  });
});
