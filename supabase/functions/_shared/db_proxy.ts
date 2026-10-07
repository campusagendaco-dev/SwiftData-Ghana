import "../deno.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export type SupabaseClient = ReturnType<typeof createClient>;

declare const Deno: any;

async function performDirectFetch(url: string, options: any) {
  const fetchOpts: RequestInit = {
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body,
    signal: AbortSignal.timeout(6000),
  };

  let client: any = undefined;
  if (url.includes("korba365.com")) {
    const proxyUrl = Deno.env.get("KORBA_PROXY_URL")?.trim() || "https://WCaCqU:PL9knqRP@149-28-121-181.ip.private.ipb.cloud:9443";
    if (proxyUrl) {
      console.log(`[db_proxy] Routing direct fetch through whitelisted proxy: ${proxyUrl.replace(/:[^:@]+@/, ":***@")}`);
      if (typeof (Deno as any).createHttpClient === "function") {
        client = (Deno as any).createHttpClient({ proxy: { url: proxyUrl } });
        (fetchOpts as any).client = client;
      }
    }
  }

  let directRes;
  try {
    directRes = await fetch(url, fetchOpts);
  } finally {
    if (client) {
      try { client.close(); } catch { /* ignore */ }
    }
  }

  const textVal = await directRes.text();
  return {
    ok: directRes.ok,
    status: directRes.status,
    text: async () => textVal,
    json: async () => {
      try { return JSON.parse(textVal); } catch { return textVal; }
    },
    headers: directRes.headers,
  };
}

async function performRenderFallback(url: string, options: any, originalErr: any) {
  const renderUrl = (Deno.env.get("RENDER_BACKEND_URL") || "https://swiftdata-auth-backend.onrender.com").replace(/\/$/, "");
  const proxySecret = Deno.env.get("PROXY_SECRET") || "swiftdata-proxy-secret-2026";
  console.warn(`[db_proxy] Attempting backup proxy fetch via Render service (${renderUrl})...`);
  try {
    const renderRes = await fetch(`${renderUrl}/api/proxy-pass`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-proxy-secret": proxySecret
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        url: url,
        method: options.method || "GET",
        headers: options.headers || {},
        body: options.body
      })
    });

    const resText = await renderRes.text();
    return {
      ok: renderRes.ok,
      status: renderRes.status,
      text: async () => resText,
      json: async () => {
        try {
          return JSON.parse(resText);
        } catch {
          return resText;
        }
      },
      headers: renderRes.headers
    };
  } catch (renderErr: any) {
    console.error("[db_proxy] Render fallback failed:", renderErr);
    const errMsg = `DB Proxy, Direct Fetch & Render Fallback failed: ${renderErr?.message || renderErr}`;
    return {
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: errMsg }),
      json: async () => ({ error: errMsg }),
      headers: new Headers({ "content-type": "application/json" })
    };
  }
}

/**
 * Routes an HTTP request directly via native Deno fetch for sub-second speeds,
 * with fast fallback to database RPC proxy / backup proxy if required.
 */
export async function fetchViaDb(
  supabaseAdmin: SupabaseClient,
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    disableFallback?: boolean;
    allowMutationFallback?: boolean;
  },
  timeoutSeconds = 25
): Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<any>;
  headers: Headers;
}> {
  const configuredBridgeUrl = Deno.env.get("KORBA_BRIDGE_URL")?.trim() || "https://swiftdatagh.shop/api/korba";
  if (configuredBridgeUrl && (url.includes("korba365.com") || url.includes("datahubgh.com") || url.includes("skdataplug.com"))) {
    const bridgeSecret = Deno.env.get("KORBA_BRIDGE_SECRET") || "swiftdata-korba-bridge-token-2026";
    
    console.log(`[db_proxy] Routing request to Vercel bridge: ${configuredBridgeUrl}`);
    try {
      const bridgeRes = await fetch(configuredBridgeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bridge-secret": bridgeSecret
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          url: url,
          method: options.method || "POST",
          headers: options.headers || {},
          body: options.body
        })
      });

      const resText = await bridgeRes.text();
      const responseHeaders = new Headers(bridgeRes.headers);
      if (bridgeRes.ok) {
        return {
          ok: bridgeRes.ok,
          status: bridgeRes.status,
          text: async () => resText,
          json: async () => {
            try {
              return JSON.parse(resText);
            } catch {
              return resText;
            }
          },
          headers: responseHeaders
        };
      }
      console.warn(`[db_proxy] Vercel bridge returned status ${bridgeRes.status}. Falling back...`);
    } catch (bridgeErr: any) {
      console.error(`[db_proxy] Vercel bridge connection failed: ${bridgeErr?.message || bridgeErr}. Falling back...`);
    }
  }

  // 1. Try Direct Native Fetch First (fastest response path, ~100-200ms)
  try {
    const directResult = await performDirectFetch(url, options);
    if (directResult.ok || (directResult.status >= 200 && directResult.status < 500)) {
      return directResult;
    }
    console.warn(`[db_proxy] Direct native fetch returned status ${directResult.status}. Trying DB RPC fallback...`);
  } catch (directErr) {
    console.warn(`[db_proxy] Direct native fetch failed: ${directErr}. Trying DB RPC fallback...`);
  }

  // 2. Fallback to DB RPC if direct fetch failed
  let parsedBody: any = null;
  if (options.body) {
    try {
      parsedBody = JSON.parse(options.body);
    } catch {
      parsedBody = options.body;
    }
  }

  let data: any = null;
  let error: any = null;

  try {
    const rpcRes = await supabaseAdmin.rpc("exec_http_request_via_db", {
      p_method: options.method || "GET",
      p_url: url,
      p_headers: options.headers || {},
      p_body: parsedBody,
      p_timeout_seconds: Math.min(timeoutSeconds, 5), // Short timeout for RPC fallback
    });
    data = rpcRes.data;
    error = rpcRes.error;
  } catch (rpcErr: any) {
    console.error("[db_proxy] RPC call threw exception:", rpcErr);
    error = rpcErr;
  }

  if (error || !data) {
    return await performRenderFallback(url, options, error || { message: "No data returned from RPC" });
  }

  const responseBody = data.body || "";
  const status = data.status || (data.ok ? 200 : 502);

  const isTimeout = 
    status === 504 || 
    status === 502 ||
    responseBody.includes("Gateway Timeout") || 
    responseBody.includes("canceling statement due to statement timeout") ||
    responseBody.includes("statement timeout");

  if (isTimeout) {
    return await performRenderFallback(url, options, { status, body: responseBody });
  }

  const responseHeaders = new Headers(data.headers || {});

  return {
    ok: !!data.ok,
    status: status,
    text: async () => responseBody,
    json: async () => {
      try {
        return JSON.parse(responseBody);
      } catch {
        return responseBody;
      }
    },
    headers: responseHeaders,
  };
}
