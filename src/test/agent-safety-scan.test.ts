import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Owner hard rules (2026-11-24): AI agents never send/re-send orders, refund, move money or
// change orders, and admin calls into agents always require 2FA. This scans the agent
// source so a later edit can't quietly bring any of that back.
// The single exception is sentinel-ai's payment-webhook backup (owner decision A), marked
// with `// payment-backup:start` / `// payment-backup:end`.

const fnRoot = join(__dirname, "..", "..", "supabase", "functions");
const AGENT_FILES = [
  "ops-worker-ai/index.ts",
  "_shared/ai.ts",
  "sentinel-ai/index.ts",
  "sentinel-evolve/index.ts",
  "guardian-ai/index.ts",
  "threat-hunter/index.ts",
  "aml-scanner/index.ts",
  "account-cloner/index.ts",
  "auto-ticket-resolver/index.ts",
];

const FORBIDDEN: { name: string; re: RegExp }[] = [
  {
    name: "order-sending or refund function",
    re: /(functions\/v1\/|functions\.invoke\(\s*["'`])(verify-payment|heal-processing-orders|check-order-status|process-retries|verify-and-refund|admin-retry-autorouter|route-to-datamart|cron-auto-retry|ai-task-decide)\b/g,
  },
  { name: "wallet or refund RPC", re: /\.rpc\(\s*["'`](credit_wallet|debit_wallet|refund_failed_order)["'`]/g },
  { name: "write to orders", re: /from\(\s*["'`]orders["'`]\s*\)\s*\.(update|insert|delete|upsert)\b/g },
  { name: "2FA check turned off", re: /checkMfa\s*:\s*false/g },
  // Suspensions and terminal locks happen only in _shared/agent_actions.ts, after an admin approved them.
  { name: "suspends or locks accounts by itself", re: /(is_suspended|terminal_locked)\s*:\s*true/g },
];

/** Removes comments but keeps URLs such as https://… inside strings. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\w])\/\/.*$/gm, "$1");
}

type Hit = { file: string; line: number; rule: string };

export function scan(file: string, raw: string): Hit[] {
  const backup = /\/\/ payment-backup:start([\s\S]*?)\/\/ payment-backup:end/.exec(raw);
  const src = stripComments(raw);
  const allowFrom = backup ? backup.index : -1;
  const allowTo = backup ? backup.index + backup[0].length : -1;
  const allowedHere = file === "sentinel-ai/index.ts";
  const hits: Hit[] = [];
  const allowedCount: Record<string, number> = {};
  for (const { name, re } of FORBIDDEN) {
    for (const m of src.matchAll(re)) {
      const at = m.index ?? 0;
      const inBackup = allowedHere && at >= allowFrom && at < allowTo;
      const kind = name === "write to orders" ? "orders" : m[2] === "verify-payment" ? "verify" : null;
      if (inBackup && kind) {
        allowedCount[kind] = (allowedCount[kind] ?? 0) + 1;
        if (allowedCount[kind] <= 1) continue;
      }
      hits.push({ file, line: src.slice(0, at).split("\n").length, rule: name });
    }
  }
  return hits;
}

const read = (f: string) => readFileSync(join(fnRoot, f), "utf8");

describe("AI agent safety scan", () => {
  it("flags an agent approving its own task (self-check)", () => {
    expect(scan("x.ts", "await fetch(`${URL}/functions/v1/ai-task-decide`, {})").map((h) => h.rule)).toEqual(["order-sending or refund function"]);
  });

  it("flags a heal call written as a template URL (self-check)", () => {
    const fixture = "await fetch(`${SUPABASE_URL}/functions/v1/heal-processing-orders`, { method: 'POST' });";
    expect(scan("x.ts", fixture).map((h) => h.rule)).toEqual(["order-sending or refund function"]);
  });

  it("does not let a comment hide a call, and ignores calls that are only in comments", () => {
    expect(scan("x.ts", "// fetch(`${U}/functions/v1/verify-payment`)\nconst a = 1;")).toEqual([]);
    expect(scan("x.ts", "const u = 'https://x.supabase.co/functions/v1/verify-payment';")).toHaveLength(1);
  });

  it("no agent sends orders, refunds, moves money, writes orders or skips 2FA", () => {
    const hits = AGENT_FILES.flatMap((f) => scan(f, read(f)));
    expect(hits).toEqual([]);
  });

  it("keeps the payment backup inside its guards (owner decision A)", () => {
    const raw = read("sentinel-ai/index.ts");
    const block = /\/\/ payment-backup:start([\s\S]*?)\/\/ payment-backup:end/.exec(raw)?.[1] ?? "";
    expect(block).not.toBe("");
    expect(block).toMatch(/\.eq\(\s*"status",\s*"pending"\s*\)/);
    expect(block).toMatch(/\.limit\(10\)/);
    expect(block).toMatch(/amt > 100/);
    expect(block).toMatch(/> 500/);
    expect(block).toMatch(/30 \* 60 \* 1000/);
    expect(block).toMatch(/15 \* 60 \* 1000/);
    expect(block).toMatch(/prevAttempts >= 2/);
    const verifyCall = /functions\/v1\/verify-payment`[\s\S]*?body:\s*JSON\.stringify\(([^)]*)\)/.exec(block)?.[1] ?? "";
    expect(verifyCall).toBe("{ reference: order.id }");
  });

  it("the payment backup counts a try only while the order is still pending, and verifies only then", () => {
    const raw = read("sentinel-ai/index.ts");
    const block = /\/\/ payment-backup:start([\s\S]*?)\/\/ payment-backup:end/.exec(raw)?.[1] ?? "";
    // conditional claim: still pending and nobody else counted this try
    expect(block).toMatch(/\.eq\("id", order\.id\)\s*\.eq\("status", "pending"\)/);
    expect(block).toMatch(/metadata->>ai_heal_attempts/);
    const claimAt = block.search(/if \(claimError \|\| !claimed\?\.length\) return;/);
    const verifyAt = block.indexOf("functions/v1/verify-payment");
    expect(claimAt).toBeGreaterThan(0);
    expect(claimAt).toBeLessThan(verifyAt);
  });

  it("every scheduled agent honours pause (is_active) except for an admin's manual run", () => {
    for (const f of ["ops-worker-ai/index.ts", "sentinel-ai/index.ts", "guardian-ai/index.ts", "threat-hunter/index.ts", "aml-scanner/index.ts", "account-cloner/index.ts"]) {
      const src = stripComments(read(f));
      expect(src, f).toMatch(/shouldSkipRun\(\s*\w+\.is_active\s*,\s*\{\s*manual:/);
      expect(src, f).toMatch(/source\s*===\s*"admin_manual"/);
    }
  });

  it("points at the real schedules file (20261124180000), never the old name", () => {
    const plan = readFileSync(join(__dirname, "..", "..", "docs", "superpowers", "plans", "2026-11-24-safe-ai-agents.md"), "utf8");
    for (const text of [read("ops-worker-ai/index.ts"), plan]) expect(text).not.toContain("20261124170000_ai_agent_schedules");
  });
});

