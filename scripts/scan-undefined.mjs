import { execSync } from "child_process";
import fs from "fs";

console.log("🔍 Scanning for undefined variables / identifiers...");

let hasError = false;

// 1. Scan frontend code
try {
  const out = execSync("npx tsc -p tsconfig.app.json --noEmit", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
} catch (err) {
  const stdout = err.stdout || "";
  const stderr = err.stderr || "";
  const lines = (stdout + "\n" + stderr).split("\n");
  const undefinedErrors = lines.filter(l => /error (TS2304|TS2552)/.test(l));
  if (undefinedErrors.length > 0) {
    console.error("❌ Frontend undefined identifier errors found:");
    undefinedErrors.forEach(e => console.error("   ", e.trim()));
    hasError = true;
  }
}

// 2. Scan edge functions if tsconfig exists
if (fs.existsSync("scratch/tsconfig.edge-scan.json")) {
  try {
    const out = execSync("npx tsc -p scratch/tsconfig.edge-scan.json", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    const stdout = err.stdout || "";
    const stderr = err.stderr || "";
    const lines = (stdout + "\n" + stderr).split("\n");
    // Filter out Deno ambient type complaints
    const undefinedErrors = lines.filter(l => /error (TS2304|TS2552)/.test(l) && !l.includes("'Deno'"));
    if (undefinedErrors.length > 0) {
      console.error("❌ Edge Functions undefined identifier errors found:");
      undefinedErrors.forEach(e => console.error("   ", e.trim()));
      hasError = true;
    }
  }
}

if (hasError) {
  console.error("💥 Undefined symbol scan failed! Please resolve all undefined names before deploying.");
  process.exit(1);
} else {
  console.log("✅ Undefined identifier scan passed (0 missing names)!");
}
