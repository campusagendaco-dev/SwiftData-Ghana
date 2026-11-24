import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  SENSITIVE_FUNCTIONS,
  SENSITIVE_RPCS,
  SENSITIVE_PAYOUT_ACTIONS,
  SENSITIVE_USER_ACTIONS,
  SENSITIVE_ARENA_ACTIONS,
  SENSITIVE_ACCESS_ACTIONS,
} from "@/lib/adminSensitive";

// Owner rule (2026-11-24): every admin call that moves money, sends/re-sends orders or spends
// message credit must ask the admin first. A covered call is allowed only when
//   - it goes through useConfirmedCall()'s confirmed.invoke / confirmed.rpc, or
//   - `confirmed.confirm(` appears in the 25 lines before it (one confirmation for a batch), or
//   - the line or the one before it carries a `read-only:` comment explaining why it can't
//     move money or send (e.g. count_only queries).
const root = join(__dirname, "..");
const files = [
  ...readdirSync(join(root, "pages"))
    .filter((f) => /^Admin.*\.tsx$/.test(f))
    .map((f) => join(root, "pages", f)),
  join(root, "components", "UserDetailDrawer.tsx"),
  join(root, "components", "AdminLayout.tsx"),
];

const ACTION_SETS: Record<string, Set<string>> = {
  "system-payout-v1": new Set([...SENSITIVE_PAYOUT_ACTIONS, ...SENSITIVE_ACCESS_ACTIONS]),
  "admin-user-actions": new Set([...SENSITIVE_USER_ACTIONS, ...SENSITIVE_ACCESS_ACTIONS]),
  "challenge-arena": SENSITIVE_ARENA_ACTIONS,
};

function coveredCallAt(lines: string[], i: number): string | null {
  const line = lines[i];
  const fn =
    line.match(/(?<!confirmed\.)(?:functions\s*\.invoke|invokePublicFunctionAsUser)\(\s*["'`]([a-z0-9-]+)["'`]/) ||
    line.match(/fetch\(\s*`[^`]*\/functions\/v1\/([a-z0-9-]+)/);
  if (fn) {
    if (SENSITIVE_FUNCTIONS.has(fn[1])) return fn[1];
    const actions = ACTION_SETS[fn[1]];
    if (actions) {
      const window = lines.slice(i, i + 12).join(" ");
      const action = window.match(/action\s*:\s*["'`]([a-z_]+)["'`]/);
      if (action && actions.has(action[1])) return `${fn[1]}:${action[1]}`;
    }
  }
  // page-local wrappers such as AdminSecurity's invoke({ action: "revoke_admin_role" })
  const wrapped = line.match(/\binvoke\(\{\s*action:\s*["'`]([a-z_]+)["'`]/);
  if (wrapped && SENSITIVE_ACCESS_ACTIONS.has(wrapped[1])) return `access:${wrapped[1]}`;
  const rpc = line.match(/(?<!confirmed)\.rpc\(\s*["'`]([a-z0-9_]+)["'`]/);
  if (rpc && SENSITIVE_RPCS.has(rpc[1])) return `rpc:${rpc[1]}`;
  return null;
}

function unconfirmedCalls(): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((_, i) => {
      const what = coveredCallAt(lines, i);
      if (!what) return;
      const before = lines.slice(Math.max(0, i - 25), i).join("\n");
      const readOnly = /read-only:/.test(lines[i]) || (i > 0 && /read-only:/.test(lines[i - 1]));
      if (before.includes("confirmed.confirm(") || readOnly) return;
      hits.push(`${file.split(/[\\/]/).slice(-2).join("/")}:${i + 1} ${what}`);
    });
  }
  return hits;
}

describe("admin money/send actions are confirmed", () => {
  it("no admin page calls a covered function without asking the admin first", () => {
    expect(unconfirmedCalls()).toEqual([]);
  });
});
