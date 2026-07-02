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
