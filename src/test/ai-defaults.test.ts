import { beforeAll, describe, expect, it } from "vitest";

// ai.ts reads Deno.env; give it an empty environment (no AI keys).
beforeAll(() => {
  (globalThis as any).Deno = { env: { get: () => undefined } };
});
const load = () => import("../../supabase/functions/_shared/ai");

const registry = (result: { data: unknown; error: unknown }) => ({
  from: () => {
    const q: any = { select: () => q, eq: () => q, maybeSingle: async () => result };
    return q;
  },
});

describe("agent config defaults", () => {
  it("is watch-only when the autonomy_mode column does not exist yet", async () => {
    const { getAgentConfig } = await load();
    const cfg = await getAgentConfig(registry({ data: null, error: { message: 'column "autonomy_mode" does not exist' } }), "sentinel_prime");
    expect(cfg.autonomy_mode).toBe("observe_only");
  });

  it("is watch-only when the agent has no registry row", async () => {
    const { getAgentConfig } = await load();
    expect((await getAgentConfig(registry({ data: null, error: null }), "new_agent")).autonomy_mode).toBe("observe_only");
  });

  it("is watch-only for the draft's old 'autonomous' value", async () => {
    const { getAgentConfig } = await load();
    const cfg = await getAgentConfig(registry({ data: { name: "x", autonomy_mode: "autonomous", active_model: "claude-haiku-4-5-20251001" }, error: null }), "x");
    expect(cfg.autonomy_mode).toBe("observe_only");
  });

  it("keeps propose when the admin allowed it", async () => {
    const { getAgentConfig } = await load();
    const cfg = await getAgentConfig(registry({ data: { name: "x", autonomy_mode: "propose", active_model: "claude-haiku-4-5-20251001" }, error: null }), "x");
    expect(cfg.autonomy_mode).toBe("propose");
  });
});

describe("models", () => {
  it("runs every agent on the model it runs on today (main's mapping)", async () => {
    const { normalizeModelName } = await load();
    // On main, the July seed (claude-haiku-4-5) and empty models ran on gemini-3.6-flash.
    expect(normalizeModelName("claude-haiku-4-5-20251001")).toBe("gemini-3.6-flash");
    expect(normalizeModelName("")).toBe("gemini-3.6-flash");
    expect(normalizeModelName("gemini-2.5-flash")).toBe("gemini-3.6-flash");
    expect(normalizeModelName("claude-haiku")).toBe("claude-3-5-haiku-20241022");
    expect(normalizeModelName("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4-5-20250929");
    expect(normalizeModelName("gpt-4o-mini")).toBe("gpt-4o-mini");
  });
});

describe("no-AI fallback", () => {
  it("never proposes actions, even for an outage-looking message", async () => {
    const { generateHeuristicFallback } = await load();
    const res = generateHeuristicFallback(
      "sentinel_prime",
      "Return JSON",
      JSON.stringify({ providers: [{ id: "p1", priority: 1, handler_type: "x", consecutive_failures: 9 }, { id: "p2", priority: 2, handler_type: "y", is_active: true, balance: 900 }], network_failures: { MTN: 0.4 } }) + " MTN failures 40%",
    );
    const parsed = JSON.parse(res.text);
    expect(parsed.actions).toEqual([]);
    expect(res.provider).toBe("heuristic");
  });
});
