import { fetchViaDb } from "../db_proxy.ts";
import { ProviderAdapter, ProviderResponse, PurchaseData } from "./types.ts";
import { normalizeRecipient, parseProviderResponse } from "./utils.ts";

export class KorbaAdapter implements ProviderAdapter {
  mapNetwork(rawNetwork: string): string {
    const rawNet = (rawNetwork || "").toUpperCase();
    if (rawNet.includes("TELECEL") || rawNet.includes("VODA")) return "VOD";
    if (rawNet.includes("AIRTEL") || rawNet.includes("TIGO") || rawNet.includes("AT")) return "AIR";
    if (rawNet.includes("GLO")) return "GLO";
    return "MTN";
  }

  async purchase(
    supabaseAdmin: any,
    provider: any,
    data: PurchaseData
  ): Promise<ProviderResponse> {
    const KORBA_CLIENT_ID = Deno.env.get("KORBA_CLIENT_ID") || provider?.settings?.client_id || "2419";
    const KORBA_CLIENT_KEY = Deno.env.get("KORBA_CLIENT_KEY") || provider?.api_key || provider?.settings?.client_key || "";
    const KORBA_SECRET_KEY = Deno.env.get("KORBA_SECRET_KEY") || provider?.api_secret || provider?.settings?.secret_key || "";

    if (!KORBA_CLIENT_KEY || !KORBA_SECRET_KEY) {
      return { ok: false, reason: "Korba credentials not configured (check database settings or env)." };
    }

    const rawNet = String(data.networkRaw || data.network || "").toUpperCase();
    const recipient = normalizeRecipient(String(data.recipient || data.phoneNumber || ""));
    // Append a unique timestamp-based suffix to prevent Duplicate Transaction ID errors on Korba during retries
    const transactionId = `${data.reference || data.order_id || ""}_${String(Date.now()).slice(-6)}_disb`;
    const callbackUrl = String(data.callback_url || `${Deno.env.get("SUPABASE_URL")}/functions/v1/korba-webhook`);
    const baseUrl = (provider.base_url || "").replace(/\/+$/, "");

    let targetUrl = `${baseUrl}/transaction_status/`;
    let korbaPayload: Record<string, any> = {};

    const orderType = String(data.order_type || "data").toLowerCase();
    if (orderType === "airtime") {
      targetUrl = `${baseUrl}/topup/`;
      korbaPayload = {
        customer_number: recipient,
        amount: Number(data.amount || 0),
        transaction_id: transactionId,
        client_id: parseInt(KORBA_CLIENT_ID) || 2419,
        network_code: this.mapNetwork(rawNet),
        callback_url: callbackUrl,
        description: `Airtime purchase for ${recipient}`,
      };
    } else if (orderType === "utility") {
      const prov = String(data.utility_provider || "").toUpperCase();
      if (prov.includes("ECG")) {
        const metadata = data.metadata || {};
        const meterId = metadata.meter_id || data.meter_id;
        const meterNumber = metadata.meter_number || data.meter_number || data.utility_account_number;

        if (prov.includes("PREPAID")) {
          if (meterId) {
            targetUrl = `${baseUrl}/ecg_direct_pay_bill/`;
            korbaPayload = {
              client_id: parseInt(KORBA_CLIENT_ID) || 2419,
              transaction_id: transactionId,
              amount: Number(data.amount || 0),
              meter_id: meterId,
              meter_number: meterNumber,
              callback_url: callbackUrl,
              description: "ECG direct prepaid payment"
            };
          } else {
            targetUrl = `${baseUrl}/ecg_prepaid_initiate_request/`;
            korbaPayload = {
              client_id: parseInt(KORBA_CLIENT_ID) || 2419,
              transaction_id: transactionId,
              meter_code: data.utility_account_number,
              meter_owner: data.utility_account_name || "CUSTOMER",
              amount: Number(data.amount || 0),
              callback_url: callbackUrl,
            };
          }
        } else {
          targetUrl = `${baseUrl}/ecg_pay_bill/`;
          korbaPayload = {
            client_id: parseInt(KORBA_CLIENT_ID) || 2419,
            customer_number: data.utility_account_number,
            amount: Number(data.amount || 0),
            transaction_id: transactionId,
            callback_url: callbackUrl,
            description: "ECG postpaid payment"
          };
        }
      } else if (prov.includes("WATER") || prov.includes("GWCL")) {
        targetUrl = `${baseUrl}/gwcl_pay_bill/`;
        korbaPayload = {
          client_id: parseInt(KORBA_CLIENT_ID) || 2419,
          account_number: data.utility_account_number,
          amount: Number(data.amount || 0),
          transaction_id: transactionId,
          callback_url: callbackUrl,
          customer_number: recipient || data.customer_phone || "0244000000"
        };
      } else if (prov.includes("DSTV") || prov.includes("GOTV") || prov.includes("STARTIMES") || prov.includes("KWESE") || prov.includes("GBC")) {
        targetUrl = `${baseUrl}/utilities_pay_bill/`;
        let billType = "DSTV";
        if (prov.includes("GOTV")) billType = "GOTV";
        else if (prov.includes("STARTIMES")) billType = "STARTIMES";
        else if (prov.includes("KWESE")) billType = "KWESETV";
        else if (prov.includes("GBC")) billType = "GBCTV";

        korbaPayload = {
          customer_number: data.utility_account_number,
          bill_type: billType,
          amount: Number(data.amount || 0),
          transaction_id: transactionId,
          client_id: parseInt(KORBA_CLIENT_ID) || 2419,
          sender_name: data.utility_account_name || "Customer",
          address: "Accra",
          callback_url: callbackUrl,
        };
      } else {
        return { ok: false, reason: `Unsupported utility provider: ${data.utility_provider}` };
      }
    } else {
      // Data Topup
      let targetPath = "mtn_data_topup/";
      if (rawNet.includes("TELECEL") || rawNet.includes("VODA")) {
        targetPath = "vodafone_data_topup/";
      } else if (rawNet.includes("AIRTEL") || rawNet.includes("TIGO") || rawNet.includes("AT")) {
        targetPath = "airteltigo_data_topup/";
      } else if (rawNet.includes("GLO")) {
        targetPath = "new_glo_data_purchase/";
      }
      targetUrl = `${baseUrl}/${targetPath}`;

      let packageId = String(data.plan || data.package_size || "");
      try {
        const { data: pkgMapping } = await supabaseAdmin
          .from("provider_packages")
          .select("external_id")
          .eq("provider_id", provider.id)
          .eq("network", data.networkRaw || data.network || "")
          .eq("package_name", data.package_size || data.plan || "")
          .maybeSingle();
        if (pkgMapping?.external_id) {
          packageId = pkgMapping.external_id;
        }
      } catch (e) {
        console.error("[korba-payload-resolve] Error:", e);
      }

      korbaPayload = {
        customer_number: recipient,
        client_id: parseInt(KORBA_CLIENT_ID) || 2419,
        product_id: packageId,
        amount: Number(data.amount || 0),
        transaction_id: transactionId,
        callback_url: callbackUrl,
        description: `${rawNet} ${data.package_size || ""}`,
      };
    }

    return this.executeRequest(supabaseAdmin, targetUrl, KORBA_CLIENT_KEY, KORBA_SECRET_KEY, korbaPayload, false);
  }

  async checkStatus(
    supabaseAdmin: any,
    provider: any,
    providerOrderId: string,
    reference: string
  ): Promise<ProviderResponse> {
    const KORBA_CLIENT_ID = Deno.env.get("KORBA_CLIENT_ID") || provider?.settings?.client_id || "2419";
    const KORBA_CLIENT_KEY = Deno.env.get("KORBA_CLIENT_KEY") || provider?.api_key || provider?.settings?.client_key || "";
    const KORBA_SECRET_KEY = Deno.env.get("KORBA_SECRET_KEY") || provider?.api_secret || provider?.settings?.secret_key || "";

    if (!KORBA_CLIENT_KEY || !KORBA_SECRET_KEY) {
      return { ok: false, reason: "Korba credentials not configured (check database settings or env)." };
    }

    const baseUrl = (provider.base_url || "").replace(/\/+$/, "");
    const targetUrl = `${baseUrl}/transaction_status/`;

    let activeProviderOrderId = (providerOrderId && providerOrderId !== "timeout" && providerOrderId !== "failed_api_call") ? providerOrderId : reference;
    if (activeProviderOrderId === reference) {
      activeProviderOrderId = `${reference}_disb`;
    }
    const korbaPayload = {
      transaction_id: String(activeProviderOrderId),
      client_id: parseInt(KORBA_CLIENT_ID) || 2419,
    };

    return this.executeRequest(supabaseAdmin, targetUrl, KORBA_CLIENT_KEY, KORBA_SECRET_KEY, korbaPayload, true);
  }

  private async executeRequest(
    supabaseAdmin: any,
    targetUrl: string,
    clientKey: string,
    secretKey: string,
    payload: any,
    isStatusCheck: boolean
  ): Promise<ProviderResponse> {
    // Generate Signature
    const sortedKeys = Object.keys(payload).sort();
    const messageParts = [];
    for (const key of sortedKeys) {
      if (payload[key] !== undefined) {
        messageParts.push(`${key}=${payload[key]}`);
      }
    }
    const message = messageParts.join("&");
    
    const keyData = new TextEncoder().encode(secretKey);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const messageData = new TextEncoder().encode(message);
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const signatureHex = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    let success = false;
    let resText = "";
    let status = 0;
    let contentType: string | null = null;
    let proxyError = "";

    // Attempt 1: Call via DB Proxy
    try {
      console.log(`[KorbaAdapter] Calling via DB Proxy: ${targetUrl}`);
      const res = await fetchViaDb(supabaseAdmin, targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `HMAC ${clientKey}:${signatureHex}`,
        },
        body: JSON.stringify(payload),
        disableFallback: !isStatusCheck,
      }, 20);

      resText = await res.text();
      status = res.status;
      contentType = res.headers.get("content-type");
      
      if (res.ok && !resText.includes("Gateway Timeout") && !resText.includes("canceling statement")) {
        success = true;
      } else {
        proxyError = resText || `HTTP ${status}`;
      }
    } catch (e: any) {
      console.warn(`[KorbaAdapter] DB Proxy exception: ${e.message}`);
      proxyError = e.message || "Unknown proxy exception";
    }

    // Attempt 2: Direct HTTP Fetch Fallback (Only for status checks)
    if (!success && isStatusCheck) {
      console.log(`[KorbaAdapter] DB Proxy failed (${proxyError}). Falling back to Direct fetch...`);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);
        
        const res = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": `HMAC ${clientKey}:${signatureHex}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        resText = await res.text();
        status = res.status;
        contentType = res.headers.get("content-type");
        
        if (res.ok) {
          success = true;
        } else {
          proxyError = resText || `HTTP ${status}`;
        }
      } catch (e: any) {
        console.error(`[KorbaAdapter] Direct fallback failed:`, e);
        return { ok: false, reason: `Proxy failed (${proxyError}). Direct fallback failed: ${e.message || e}` };
      }
    }

    if (success) {
      const semantic = parseProviderResponse(resText, contentType);
      if (semantic.ok) {
        let token: string | null = null;
        try {
          const parsed = JSON.parse(resText);
          token = parsed.prepaid_token || parsed.prepaidToken || (parsed.data?.prepaid_token) || (parsed.results?.prepaid_token) || null;
        } catch { /* ignore */ }
        
        return { 
          ok: true, 
          reason: "", 
          id: semantic.id, 
          status: semantic.status,
          raw: token ? { prepaid_token: token } : undefined
        };
      }
      return { ok: false, reason: semantic.reason || "Korba rejected this order." };
    }

    let parsedMsg = "";
    try { parsedMsg = JSON.parse(resText)?.message || JSON.parse(resText)?.error || ""; } catch { /* ignore */ }
    return { ok: false, reason: parsedMsg || `Korba returned status ${status}: ${resText.slice(0, 100)}` };
  }
}
