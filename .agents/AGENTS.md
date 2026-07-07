# SwiftData Workspace Rules

## API Integrations & Credentials Resolution
* **Always Prioritize Environment Secrets**: When resolving credentials (API keys, Client IDs, Secret Keys) that exist in both environment variables (`Deno.env` / process envs) and database tables (e.g., `providers`), always prioritize environment variables as the source of truth first, falling back to database parameters only if environment variables are not set. This prevents stale database configurations from breaking active API integrations.
  * *Correct Pattern*:
    ```typescript
    const KEY = Deno.env.get("API_KEY") || provider?.api_key || "";
    ```
  * *Incorrect Pattern*:
    ```typescript
    const KEY = provider?.api_key || Deno.env.get("API_KEY") || "";
    ```

## Development & Scoping Safeguards
* **Variable Scoping Check**: Ensure new local variables do not duplicate existing declarations in the same scope or closure.
* **Pre-Deployment Build Verification**: Always compile or verify Edge Functions using `esbuild` or equivalent CLI tools locally before pushing to production to ensure preflight `OPTIONS` requests boot up correctly.
* **Supabase Promise Catch Safety**: Never chain `.catch()` directly to Supabase query builders (e.g. `supabase.from(...).select(...).maybeSingle().catch(...)`). Wrap the query builder in `Promise.resolve(...)` or ensure `.then()` is called before `.catch()`.
* **Try-Catch Scope Checking**: If any variable destructured inside a `try` block needs to be referenced in the outer scope, declare it in the outer scope first with `let` (e.g. `let sysRes; try { [..., sysResData] = await ...; sysRes = sysResData; }`) instead of destructuring with `const` inside the `try` block.
* **Storefront & Reseller Sync**: Keep user `profiles` and `reseller_stores` in sync. Storefront agents (`is_agent = true` and `store_name` is set) must have exactly one row in `reseller_stores` with matching `slug` and metadata, whereas direct resellers must have 0 rows in `reseller_stores` to prevent routing conflicts in the `agent_stores` view.
