import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/integrations/supabase/client";

// Use an authless client for public purchase/verification edge function calls.
// This avoids browser session JWT algorithm mismatches at the gateway level.
const publicFunctionClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: "swiftdata-public-function-client",
    // Explicit no-op custom lock to mirror main client and neutralize console warnings
    lock: async (_, __, fn) => await fn(),
  },
});

export async function invokePublicFunction(functionName: string, options?: { body?: unknown; headers?: Record<string, string> }) {
  let supportsQueryInPath = false;
  try {
    const testUrl = new URL("https://example.com/a?b=c");
    supportsQueryInPath = testUrl.pathname === "/a";
  } catch (e) {
    supportsQueryInPath = false;
  }

  // Optimize for offline purchases: queue immediately if offline
  if (typeof window !== "undefined" && !window.navigator.onLine && functionName.includes("wallet-buy-data")) {
    const body = options?.body as any;
    const reference = body?.reference || crypto.randomUUID();
    try {
      const { queueTransaction } = await import("./offline-queue");
      const baseUrl = SUPABASE_URL;
      const cacheBuster = `cb=${Date.now()}`;
      const finalUrl = supportsQueryInPath
        ? (functionName.includes("?") 
            ? `${baseUrl}/functions/v1/${functionName}&${cacheBuster}` 
            : `${baseUrl}/functions/v1/${functionName}?${cacheBuster}`)
        : `${baseUrl}/functions/v1/${functionName}`;
      
      await queueTransaction({
        id: reference,
        url: finalUrl,
        method: "POST",
        body: JSON.stringify(body || {}),
        headers: options?.headers || {},
        network: body?.network,
        packageSize: body?.package_size,
        phone: body?.customer_phone,
        amount: body?.amount,
      });
      
      return {
        data: {
          success: true,
          status: "pending_sync",
          order_id: reference,
          queued: true
        },
        error: null
      } as any;
    } catch (queueErr) {
      console.error("[Resilience] Failed to queue transaction offline:", queueErr);
    }
  }

  let retries = 0;
  const maxRetries = 3;
  const baseDelay = 800; // start with 800ms
  
  // Dynamic Cache-Buster to prevent Opera Mini, Phoenix, and Telecom caching proxies from serving stale API responses
  const cacheBuster = `cb=${Date.now()}`;
  const finalFunctionName = supportsQueryInPath
    ? (functionName.includes("?") 
        ? `${functionName}&${cacheBuster}` 
        : `${functionName}?${cacheBuster}`)
    : functionName;

  const finalOptions = {
    ...options,
    headers: options?.headers,
  };
  
  while (retries <= maxRetries) {
    try {
      const result = await publicFunctionClient.functions.invoke(finalFunctionName, finalOptions);
      if (result.error && (result.error.status === 429 || String(result.error.message).includes("429"))) {
        console.warn(`[PublicFunctionClient] ${functionName} hit rate limit (429).`);
      }
      // If we got a result (even an error), return it
      return result;
    } catch (error: any) {
      const isConnectionError = 
        error?.message?.includes("failed to fetch") || 
        error?.message?.includes("Network error") ||
        error?.message?.includes("ERR_CONNECTION_CLOSED");

      if (retries === maxRetries || !isConnectionError) {
        if (isConnectionError) {
          console.error(`[Resilience] Final retry for ${functionName} failed:`, error);
          
          if (functionName.includes("wallet-buy-data")) {
            try {
              const body = options?.body as any;
              const reference = body?.reference || crypto.randomUUID();
              const { queueTransaction } = await import("./offline-queue");
              const baseUrl = SUPABASE_URL;
              const finalUrl = `${baseUrl}/functions/v1/${finalFunctionName}`;
              
              await queueTransaction({
                id: reference,
                url: finalUrl,
                method: "POST",
                body: JSON.stringify(body || {}),
                headers: options?.headers || {},
                network: body?.network,
                packageSize: body?.package_size,
                phone: body?.customer_phone,
                amount: body?.amount,
              });
              
              return {
                data: {
                  success: true,
                  status: "pending_sync",
                  order_id: reference,
                  queued: true
                },
                error: null
              } as any;
            } catch (queueErr) {
              console.error("[Resilience] Failed to queue failed transaction offline:", queueErr);
            }
          }
        }
        throw error;
      }

      retries++;
      const delay = baseDelay * Math.pow(2, retries - 1); // 800, 1600, 3200ms
      console.warn(`[Resilience] ${functionName} failed (retry ${retries}/${maxRetries} after ${delay}ms):`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return await publicFunctionClient.functions.invoke(finalFunctionName, finalOptions);
}

export async function invokePublicFunctionAsUser(functionName: string, options?: { body?: unknown; headers?: Record<string, string> }) {
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  const headers = { ...(options?.headers || {}) };

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
    headers["x-user-access-token"] = accessToken;
  }

  return await invokePublicFunction(functionName, {
    ...options,
    headers,
  });
}
