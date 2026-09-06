import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Routes an HTTP request through the database using the pg_net RPC proxy,
 * ensuring the request originates from the database's dedicated static IP.
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
  if (url.includes("korba365.com") || url.includes("datahubgh.com") || url.includes("skdataplug.com")) {
    const bridgeUrl = Deno.env.get("KORBA_BRIDGE_URL") || "https://swiftdatagh.shop/api/korba";
    const bridgeSecret = Deno.env.get("KORBA_BRIDGE_SECRET") || "swiftdata-korba-bridge-token-2026";
    
    console.log(`[db_proxy] Routing request to Vercel bridge: ${bridgeUrl}`);
    try {
      const bridgeRes = await fetch(bridgeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bridge-secret": bridgeSecret
        },
        body: JSON.stringify({
          url: url,
          method: options.method || "POST",
          headers: options.headers || {},
          body: options.body
        })
      });

      const resText = await bridgeRes.text();
      const responseHeaders = new Headers(bridgeRes.headers);
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
    } catch (bridgeErr: any) {
      console.error(`[db_proxy] Vercel bridge connection failed:`, bridgeErr);
      const errMsg = `Vercel bridge connection failed: ${bridgeErr.message || bridgeErr}`;
      return {
        ok: false,
        status: 502,
        text: async () => JSON.stringify({ error: errMsg }),
        json: async () => ({ error: errMsg }),
        headers: new Headers({ "content-type": "application/json" })
      };
    }
  }

  let parsedBody: any = null;
  if (options.body) {
    try {
      parsedBody = JSON.parse(options.body);
    } catch {
      // Fall back to raw string if it's not a JSON object
      parsedBody = options.body;
    }
  }

  const isWhitelistedOnly = false; // Disabled strict whitelist only to allow korba direct fallbacks
  const method = (options.method || "GET").toUpperCase();
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  const performDirectFetchFallback = async (originalErr: any) => {
    const shouldBlockFallback = options.disableFallback === true;
    if (shouldBlockFallback) {
      console.warn(`[db_proxy] DB Proxy failed (Error: ${JSON.stringify(originalErr)}). Fallback disabled for ${method}. Returning error.`);
      const errMsg = `DB Proxy failed: ${originalErr?.message || JSON.stringify(originalErr)}`;
      return {
        ok: false,
        status: 502,
        text: async () => JSON.stringify({ error: errMsg }),
        json: async () => ({ error: errMsg }),
        headers: new Headers({ "content-type": "application/json" }),
      };
    }
    console.warn(`[db_proxy] DB Proxy failed (Error: ${JSON.stringify(originalErr)}). Attempting direct fetch fallback to: ${url}`);
    try {
      const fetchOpts: RequestInit = {
        method: options.method || "GET",
        headers: options.headers || {},
        body: options.body,
      };

      let client: any = undefined;
      if (url.includes("korba365.com")) {
        const proxyUrl = Deno.env.get("KORBA_PROXY_URL") || "http://cvlscvmy:wylckry6fx3o@31.59.20.176:6754/";
        console.log(`[db_proxy] Routing direct fetch through proxy: ${proxyUrl}`);
        if (typeof (Deno as any).createHttpClient === "function") {
          client = (Deno as any).createHttpClient({ proxy: { url: proxyUrl } });
          (fetchOpts as any).client = client;
        } else {
          console.warn("[db_proxy] Deno.createHttpClient is not available in this environment.");
        }
      }

      let directRes;
      try {
        directRes = await fetch(url, fetchOpts);
      } finally {
        if (client) {
          try {
            client.close();
          } catch (closeErr) {
            console.error("[db_proxy] Error closing HTTP client proxy:", closeErr);
          }
        }
      }
      const textVal = await directRes.text();
      if (!directRes.ok && directRes.status >= 500) {
        return await performRenderFallback({ status: directRes.status, body: textVal });
      }
      return {
        ok: directRes.ok,
        status: directRes.status,
        text: async () => textVal,
        json: async () => {
          try {
            return JSON.parse(textVal);
          } catch {
            return textVal;
          }
        },
        headers: directRes.headers,
      };
    } catch (directErr: any) {
      console.error("[db_proxy] Direct fetch fallback failed. Trying Render backup proxy...", directErr);
      return await performRenderFallback(directErr);
    }
  };

  const performRenderFallback = async (originalErr: any) => {
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
  };

  let data: any = null;
  let error: any = null;

  try {
    const rpcRes = await supabaseAdmin.rpc("exec_http_request_via_db", {
      p_method: options.method || "GET",
      p_url: url,
      p_headers: options.headers || {},
      p_body: parsedBody,
      p_timeout_seconds: timeoutSeconds,
    });
    data = rpcRes.data;
    error = rpcRes.error;
  } catch (rpcErr: any) {
    console.error("[db_proxy] RPC call threw exception:", rpcErr);
    error = rpcErr;
  }

  if (error || !data) {
    if (!isWhitelistedOnly) {
      return await performDirectFetchFallback(error || { message: "No data returned from RPC" });
    }
    console.error("[db_proxy] RPC error calling exec_http_request_via_db:", error);
    const errMsg = error?.message || "Failed to execute request via database proxy";
    return {
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: errMsg }),
      json: async () => ({ error: errMsg }),
      headers: new Headers({ "content-type": "application/json" }),
    };
  }

  const responseBody = data.body || "";
  const status = data.status || (data.ok ? 200 : 502);

  const isTimeout = 
    status === 504 || 
    status === 502 ||
    responseBody.includes("Gateway Timeout") || 
    responseBody.includes("canceling statement due to statement timeout") ||
    responseBody.includes("statement timeout");

  if (isTimeout && !isWhitelistedOnly) {
    return await performDirectFetchFallback({ status, body: responseBody });
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
