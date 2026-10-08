import { fetchViaDb } from "../db_proxy.ts";
import { ProviderAdapter, ProviderResponse, PurchaseData } from "./types.ts";
import { normalizeRecipient, parseProviderResponse, parseCapacity } from "./utils.ts";

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
    const KORBA_CLIENT_KEY = Deno.env.get("KORBA_CLIENT_KEY") || provider?.api_key || provider?.settings?.client_key || "189eae68808be2089295211d065ecf14d4f34b3c";
    const KORBA_SECRET_KEY = Deno.env.get("KORBA_SECRET_KEY") || provider?.api_secret || provider?.settings?.secret_key || "bba479d442dadc39bd96f27c04cd43b5c5a4287fbfd19b7c82abc00df7660d8a";

    if (!KORBA_CLIENT_KEY || !KORBA_SECRET_KEY) {
      return { ok: false, reason: "Korba credentials not configured (check database settings or env)." };
    }

    const rawNet = String(data.networkRaw || data.network || "").toUpperCase();
    const recipient = normalizeRecipient(String(data.recipient || data.phoneNumber || data.phone || data.customer_phone || data.phone_number || ""));
    const rawRef = String(data.reference || data.orderReference || data.order_id || data.id || "").trim();
    const transactionId = rawRef ? (rawRef.endsWith("_disb") ? rawRef : `${rawRef}_disb`) : `ord_${crypto.randomUUID()}_disb`;
    const callbackUrl = String(data.callback_url || `${Deno.env.get("SUPABASE_URL")}/functions/v1/korba-webhook`);
    const baseUrl = (provider?.base_url || Deno.env.get("KORBA_BASE_URL") || "https://xchange.korba365.com/api/v1.0").replace(/\/+$/, "");

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
      const pkgUpper = String(data.package_size || data.plan || "").toUpperCase();
      const isStandardSmeSize = /^\d+(\.\d+)?\s*(GB|MB)$/i.test(String(data.package_size || data.plan || "").trim());
      const isKorbaPackagePattern = pkgUpper.startsWith("GHS") || 
        pkgUpper.includes("RACT_DATA") || 
        pkgUpper.includes("KOKROKOO") || 
        pkgUpper.includes("MIDNIGHT") || 
        pkgUpper.includes("SOCIAL") || 
        pkgUpper.includes("VIDEO") || 
        pkgUpper.includes("IDD");
      const orderCat = String(data.metadata?.category || data.metadata?.package_category || "").toLowerCase();
      const isExplicitKorba = data.metadata?.is_korba === true || data.metadata?.is_korba === "true" || orderCat === "korba" || orderCat === "retail";

      if (!isExplicitKorba && (orderCat === "affordable" || orderCat === "sme" || orderCat.includes("sme") || (isStandardSmeSize && !isKorbaPackagePattern))) {
        console.warn(`[KorbaAdapter] Blocked attempt to purchase SME data bundle via Korba: ${data.package_size || data.plan} for ${rawNet}`);
        return {
          ok: false,
          reason: "Affordable SME data bundles cannot be fulfilled by Korba API. Routing to primary aggregators.",
          status: "failed"
        };
      }

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
      let matchedPackage: any = null;
      try {
        const rawNetwork = String(data.networkRaw || data.network || "").toUpperCase();
        let dbNet = "MTN";
        if (rawNetwork.includes("TELECEL") || rawNetwork.includes("VODA")) dbNet = "Telecel";
        else if (rawNetwork.includes("AIRTEL") || rawNetwork.includes("TIGO") || rawNetwork.includes("AT")) dbNet = "AirtelTigo";
        else if (rawNetwork.includes("GLO")) dbNet = "GLO";

        const { data: pkgMappings } = await supabaseAdmin
          .from("provider_packages")
          .select("external_id, package_name, capacity_gb, cost_price, network, raw_data")
          .eq("provider_id", provider.id);

        if (pkgMappings && pkgMappings.length > 0) {
          const reqSize = String(data.package_size || data.plan || "").trim();
          const reqCapGb = parseCapacity(reqSize);
          const cleanReqSize = reqSize.replace(/\s+/g, "").toUpperCase();

          const netPkgs = pkgMappings.filter((p: any) => 
            p.network === dbNet || 
            p.network === rawNetwork || 
            p.network?.toUpperCase().includes(dbNet.toUpperCase()) ||
            p.network?.toUpperCase().includes(rawNetwork.toUpperCase()) ||
            (dbNet === "MTN" && (p.network === "MTN" || p.network === "YELLO"))
          );

          // Never search across other networks
          const searchPool = netPkgs;

          // 1. Exact match on external_id
          matchedPackage = searchPool.find((p: any) => p.external_id === reqSize);
          // 2. Exact match on package_name (ignoring spaces & case)
          if (!matchedPackage) {
            matchedPackage = searchPool.find((p: any) => String(p.package_name || "").replace(/\s+/g, "").toUpperCase() === cleanReqSize);
          }
          // 3. Match on raw_data product_id / bundle_id / name
          if (!matchedPackage) {
            matchedPackage = searchPool.find((p: any) => 
              String(p.raw_data?.product_id || "").toUpperCase() === cleanReqSize ||
              String(p.raw_data?.bundle_id || "").toUpperCase() === cleanReqSize ||
              String(p.raw_data?.name || "").replace(/\s+/g, "").toUpperCase() === cleanReqSize
            );
          }
          // 4. Match on capacity_gb
          if (!matchedPackage && reqCapGb > 0) {
            matchedPackage = searchPool.find((p: any) => Math.abs(Number(p.capacity_gb || 0) - reqCapGb) < 0.05);
          }
          // 5. Substring match in package_name or raw_data.name
          if (!matchedPackage) {
            matchedPackage = searchPool.find((p: any) => {
              const pName = String(p.package_name || "").replace(/\s+/g, "").toUpperCase();
              const rawName = String(p.raw_data?.name || "").replace(/\s+/g, "").toUpperCase();
              return pName.includes(cleanReqSize) || rawName.includes(cleanReqSize);
            });
          }

          if (matchedPackage?.external_id) {
            packageId = matchedPackage.external_id;
            console.log(`[korba-payload-resolve] Mapped ${rawNetwork} ${reqSize} -> Korba ID: ${packageId} (${matchedPackage.package_name})`);
          }
        }
      } catch (e: any) {
        console.error("[korba-payload-resolve] Error:", e?.message || e);
      }

      const isVodafone = rawNet.includes("TELECEL") || rawNet.includes("VODA");
      const isGlo = rawNet.includes("GLO");

      const korbaAmount = (matchedPackage?.raw_data?.amount !== undefined && Number(matchedPackage.raw_data.amount) > 0)
        ? Number(matchedPackage.raw_data.amount)
        : ((matchedPackage?.cost_price !== undefined && Number(matchedPackage.cost_price) > 0)
          ? Number(matchedPackage.cost_price)
          : Number(data.amount || 0));

      const reqCapGb = parseCapacity(data.package_size || data.plan);
      const reqCapMb = Math.round(reqCapGb * 1024);
      const safeCapacity = reqCapMb > 0 ? reqCapMb : (reqCapGb > 0 ? reqCapGb : 1);

      korbaPayload = {
        customer_number: recipient,
        client_id: parseInt(KORBA_CLIENT_ID) || 2419,
        amount: korbaAmount,
        transaction_id: transactionId,
        callback_url: callbackUrl,
        description: `${rawNet} ${data.package_size || ""}`,
        capacity: safeCapacity,
        capacity_mb: reqCapMb > 0 ? reqCapMb : undefined,
        capacity_gb: reqCapGb > 0 ? reqCapGb : undefined,
      };

      if (isVodafone || isGlo) {
        korbaPayload.bundle_id = packageId;
      } else {
        korbaPayload.product_id = packageId;
      }
    }

    const result = await this.executeRequest(supabaseAdmin, targetUrl, KORBA_CLIENT_KEY, KORBA_SECRET_KEY, korbaPayload, false);
    if (result.ok && !result.id) {
      result.id = transactionId;
    }
    return result;
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
        disableFallback: false,
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

    // Attempt 2: Direct HTTP Fetch Fallback
    if (!success) {
      console.log(`[KorbaAdapter] DB Proxy failed (${proxyError}). Falling back to Direct native fetch...`);
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
          raw: token ? { prepaid_token: token } : undefined,
          rawBody: resText
        };
      }
      return { ok: false, reason: semantic.reason || "Korba rejected this order.", rawBody: resText };
    }

    let parsedMsg = "";
    try { parsedMsg = JSON.parse(resText)?.message || JSON.parse(resText)?.error || ""; } catch { /* ignore */ }
    return { ok: false, reason: parsedMsg || `Korba returned status ${status}: ${resText.slice(0, 100)}`, rawBody: resText };
  }

  async checkStatus(
    supabaseAdmin: any,
    provider: any,
    providerOrderId: string,
    reference: string
  ): Promise<ProviderResponse> {
    const KORBA_CLIENT_ID = Deno.env.get("KORBA_CLIENT_ID") || provider?.settings?.client_id || "2419";
    const KORBA_CLIENT_KEY = Deno.env.get("KORBA_CLIENT_KEY") || provider?.api_key || provider?.settings?.client_key || "189eae68808be2089295211d065ecf14d4f34b3c";
    const KORBA_SECRET_KEY = Deno.env.get("KORBA_SECRET_KEY") || provider?.api_secret || provider?.settings?.secret_key || "bba479d442dadc39bd96f27c04cd43b5c5a4287fbfd19b7c82abc00df7660d8a";

    let txId = String(providerOrderId || reference || "").trim();
    if (txId && !txId.endsWith("_disb")) {
      txId = `${txId}_disb`;
    }
    if (!txId) return { ok: false, reason: "Missing transaction ID for status check." };

    const baseUrl = (provider?.base_url || Deno.env.get("KORBA_BASE_URL") || "https://xchange.korba365.com/api/v1.0").replace(/\/+$/, "");
    const targetUrl = `${baseUrl}/transaction_status/`;

    const payload = {
      client_id: parseInt(KORBA_CLIENT_ID) || 2419,
      transaction_id: txId,
    };

    const sortedKeys = Object.keys(payload).sort();
    const messageParts = [];
    for (const key of sortedKeys) {
      if ((payload as any)[key] !== undefined) {
        messageParts.push(`${key}=${(payload as any)[key]}`);
      }
    }
    const message = messageParts.join("&");
    
    const keyData = new TextEncoder().encode(KORBA_SECRET_KEY);
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

    try {
      console.log(`[KorbaAdapter] Checking status for ${txId} via ${targetUrl}...`);
      const res = await fetchViaDb(supabaseAdmin, targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `HMAC ${KORBA_CLIENT_KEY}:${signatureHex}`,
        },
        body: JSON.stringify(payload),
      });

      const resText = await res.text();
      let parsed: any = {};
      try { parsed = JSON.parse(resText); } catch { /* ignore text */ }

      if (res.ok) {
        const rawStatus = (parsed.status || parsed.status_code || parsed.code || "").toString().toUpperCase();
        const isDelivered = rawStatus === "000" || rawStatus === "SUCCESS" || rawStatus === "SUCCESSFUL" || rawStatus === "FULFILLED" || rawStatus === "COMPLETED" || rawStatus === "DELIVERED";
        const isFailed = rawStatus === "FAILED" || rawStatus === "ERROR" || rawStatus === "REJECTED" || rawStatus === "CANCELLED";

        const token: string | null = parsed.prepaid_token || parsed.prepaidToken || (parsed.data?.prepaid_token) || null;

        return {
          ok: true,
          status: isDelivered ? "delivered" : (isFailed ? "failed" : "processing"),
          id: txId,
          reason: parsed.message || parsed.description || "",
          raw: token ? { prepaid_token: token } : undefined,
          rawBody: resText
        };
      } else {
        return { ok: false, status: "processing", reason: `Korba HTTP ${res.status}` };
      }
    } catch (err: any) {
      console.error("[KorbaAdapter] Status check exception:", err);
      return { ok: false, status: "processing", reason: err?.message || String(err) };
    }
  }
}

