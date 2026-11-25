import { describe, expect, it } from "vitest";
import { extractPrepaidToken } from "../../supabase/functions/_shared/korba_token";

describe("reading an ECG prepaid token from Korba", () => {
  it("passes Korba's own prepaid-token field through exactly as sent", () => {
    expect(extractPrepaidToken({ prepaid_token: "1234 5678 9012 3456 7890" }, { delivered: false })).toBe("1234 5678 9012 3456 7890");
    expect(extractPrepaidToken({ results: { prepaid_token: "1234-5678-9012" } }, { delivered: false })).toBe("1234-5678-9012");
  });

  it("uses a generic token field only when it looks like a meter token", () => {
    expect(extractPrepaidToken({ results: { data: { token: "11112222333344445555" } } }, { delivered: false })).toBe("11112222333344445555");
  });

  it("reads a token from the message only when delivered and the number follows the word token", () => {
    const parsed = { message: "Payment successful. Your token is 1111-2222-3333-4444-5555. Thank you" };
    expect(extractPrepaidToken(parsed, { delivered: true })).toBe("11112222333344445555");
    expect(extractPrepaidToken(parsed, { delivered: false })).toBeNull();
  });

  it("never takes a transaction reference for a token", () => {
    expect(extractPrepaidToken({ message: "Transaction 98765432109876543210 received, processing" }, { delivered: true })).toBeNull();
    expect(extractPrepaidToken({ message: "Ref 12345678901234567890. Token will be sent by SMS" }, { delivered: true })).toBeNull();
  });

  it("ignores token fields that aren't token-shaped", () => {
    expect(extractPrepaidToken({ token: "eyJhbGciOi.session" }, { delivered: true })).toBeNull();
    expect(extractPrepaidToken({}, { delivered: true })).toBeNull();
  });
});

describe("Korba and supplier-key safety in the code", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = join(__dirname, "..", "..");
  const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

  it("the Korba adapter uses the safe token reader and alerts when keys are missing", () => {
    const src = read("supabase", "functions", "_shared", "providers", "korba.ts");
    expect(src).not.toMatch(/msgText\.match\(/);
    expect((src.match(/extractPrepaidToken\(/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((src.match(/await alertKorbaKeysMissing\(supabaseAdmin\)/g) || []).length).toBe(2);
  });

  it("no screen reads supplier keys or whole supplier rows", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) { if (f !== "test") walk(p); }
        else if (/\.tsx?$/.test(f)) files.push(p);
      }
    };
    walk(join(root, "src"));
    const hits: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      const re = /\.from\("providers"(?: as any)?\)\s*\.select\("([^"]*)"\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        if (m[1] === "*" || /\bapi_key\b|\bapi_secret\b/.test(m[1])) hits.push(`${f.split(/[\\/]/).pop()}: select("${m[1]}")`);
      }
    }
    expect(hits).toEqual([]);
  });
});
