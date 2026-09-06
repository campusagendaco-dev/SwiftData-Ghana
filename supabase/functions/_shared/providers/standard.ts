import { fetchViaDb } from "../db_proxy.ts";
import { ProviderAdapter, ProviderResponse, PurchaseData } from "./types.ts";
import { 
  normalizeRecipient, 
  parseProviderResponse, 
  parseCapacity, 
  mapDataNetworkKey, 
  isHtmlResponse 
} from "./utils.ts";

export class StandardAdapter implements ProviderAdapter {
  mapNetwork(rawNetwork: string): string {
    return mapDataNetworkKey(rawNetwork);
  }

  // Build the target endpoint URL(s) for the provider
  buildProviderUrls(baseUrl: string, endpoint: string, handlerType: string, data: any): string[] {
    const clean = (baseUrl || "").trim().replace(/\/+$/, "");
    if (!clean) return [];

    if (handlerType === "datamart") {
      if (endpoint === "status") {
        const ref = String(data.transaction_id || data.reference || data.order_id || "");
        return [`${clean}/order-status/${ref}`, `${clean}/status/${ref}`];
      }
      return [`${clean}/purchase`, `${clean}/order`, clean];
    }
    if (handlerType === "skdataplug") {
      let cleanBase = clean.replace(/\/order\/?$/, "").replace(/\/status\/?$/, "").replace(/\/balance\/?$/, "").replace(/\/bundles\/?$/, "");
      if (!cleanBase.endsWith("/api/v1")) {
        if (cleanBase.endsWith("/api")) cleanBase += "/v1";
        else cleanBase += "/api/v1";
      }

      if (endpoint === "status") {
        const ref = String(data.transaction_id || data.reference || data.order_id || "");
        return [`${cleanBase}/status/${ref}/`, `${cleanBase}/status/${ref}`];
      }
      if (endpoint === "purchase") {
        return [`${cleanBase}/order/`, `${cleanBase}/order`];
      }
    }
    if (handlerType === "superbdatafy" && endpoint === "status") {
      const ref = String(data.transaction_id || data.reference || data.order_id || "");
      return [`${clean}/transaction/${ref}`];
    }
    if (handlerType === "xcel" && endpoint === "status") {
      const ref = String(data.transaction_id || data.reference || data.order_id || "");
      return [`${clean}/partners/momo/status/${ref}`];
    }
    if (handlerType === "qhowmenzconsult" && endpoint === "status") {
      const ref = String(data.transaction_id || data.reference || data.order_id || "");
      return [`${clean}/orders/${ref}`];
    }

    // Standard URL formatting fallback
    if (handlerType === "bossu" || handlerType === "superbdatafy" || handlerType === "xcel" || handlerType === "qhowmenzconsult") {
      return [clean];
    }

    if (handlerType === "datahub") {
      const alias = endpoint === "purchase" ? "data-purchase" : (endpoint === "status" ? "order-status" : endpoint);
      return [`${clean}/${alias}`];
    }
    if (handlerType === "spendless") {
      const alias = endpoint === "purchase" ? "purchase" : (endpoint === "status" ? "order-status" : endpoint);
      return [`${clean}/${alias}`];
    }

    // Generic fallback aliases
    const aliases = endpoint === "purchase"
      ? ["purchase", "order", "airtime", "buy", "topup", "recharge"]
      : (endpoint === "status" ? ["status", "query", "check", "query-order"] : [endpoint]);

    const urls = new Set<string>();
    let rootUrl = "";
    try {
      rootUrl = new URL(clean).origin;
    } catch { /* ignore */ }

    for (const alias of aliases) {
      if (clean.endsWith(`/${alias}`)) {
        urls.add(clean);
      } else {
        urls.add(`${clean}/${alias}`);
        if (rootUrl) {
          urls.add(`${rootUrl}/${alias}`);
          urls.add(`${rootUrl}/api/${alias}`);
        }
      }
    }

    return Array.from(urls);
  }

  // Build request payload dynamically based on the provider specifications
  async buildPayload(
    supabaseAdmin: any,
    provider: any,
    endpoint: string,
    data: PurchaseData
  ): Promise<any> {
    const handlerType = String(provider.handler_type || "standard").toLowerCase();

    if (endpoint === "status") {
      if (handlerType === "datahub") {
        return {
          reference: String(data.reference || data.transaction_id || data.order_id || ""),
        };
      }
      return null; // For status checks that use GET requests with URL params
    }

    // --- Purchase Payload Resolutions ---

    if (handlerType === "datamart") {
      const recipient = String(data.phoneNumber || data.recipient || data.phone || "");
      const rawNet = String(data.network || data.networkRaw || data.networkKey || "").toUpperCase();
      const datamartNet = (rawNet.includes("MTN") || rawNet === "YELLO")
        ? "YELLO"
        : ((rawNet.includes("TELECEL") || rawNet.includes("VODA")) ? "TELECEL" : "AT_PREMIUM");

      const pkgSize = String(data.package_size || data.plan || data.capacity || "");
      const capNum = parseCapacity(pkgSize);

      let externalId = data.planId || data.plan || data.bundle || pkgSize;

      if (!data.planId || data.planId === pkgSize) {
        try {
          const { data: pkgMapping } = await supabaseAdmin
            .from("provider_packages")
            .select("external_id")
            .eq("provider_id", provider.id)
            .eq("network", "MTN")
            .eq("package_name", pkgSize)
            .maybeSingle();
          if (pkgMapping?.external_id) {
            externalId = pkgMapping.external_id;
          } else if (capNum > 0) {
            externalId = `MTN_${capNum}`;
          }
        } catch (e) {
          console.error("[datamart-standard-resolve] Error:", e);
        }
      }

      return {
        phoneNumber: recipient,
        recipient: recipient,
        network: datamartNet,
        planId: String(externalId),
        plan: String(externalId),
        capacity: String(capNum > 0 ? capNum : pkgSize),
        orderReference: String(data.orderReference || data.reference || data.order_id || ""),
        reference: String(data.reference || data.orderReference || data.order_id || ""),
        gateway: "wallet",
        bypass_beneficiary: true
      };
    }

    if (handlerType === "datahub" || handlerType === "spendless") {
      const rawNet = String(data.networkKey || data.networkRaw || data.network || "").toUpperCase();
      const netKey = mapDataNetworkKey(rawNet);
      return {
        networkKey: netKey,
        recipient: String(data.recipient || data.phoneNumber || data.phone || ""),
        capacity: String(data.capacity || data.package_size || data.plan || ""),
        reference: String(data.reference || data.order_id || ""),
      };
    }
    
    if (handlerType === "qhowmenzconsult") {
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
        console.error("[qhowmenzconsult-payload-resolve] Error:", e);
      }

      return {
        plan_id: packageId,
        package_id: packageId,
        product_id: packageId,
        external_id: packageId,
        amount: Number(data.amount || 0),
        reference: String(data.reference || data.order_id || ""),
      };
    }

    if (handlerType === "skdataplug") {
      let providerNetwork = "MTN";
      let gbSize = String(parseCapacity(String(data.package_size || data.plan || "")));

      try {
        const { data: pkgMapping } = await supabaseAdmin
          .from("provider_packages")
          .select("raw_data")
          .eq("provider_id", provider.id)
          .eq("network", data.networkRaw || data.network || "")
          .eq("package_name", data.package_size || data.plan || "")
          .maybeSingle();

        if (pkgMapping?.raw_data) {
          providerNetwork = pkgMapping.raw_data.network || providerNetwork;
          gbSize = String(pkgMapping.raw_data.gb_size || gbSize);
        } else {
          const rawNet = (data.networkRaw || data.network || "").toUpperCase();
          if (rawNet.includes("VOD") || rawNet.includes("TELECEL")) {
            providerNetwork = "TELECEL";
          } else if (rawNet.includes("AT") || rawNet.includes("AIRTEL")) {
            const isNoExpiry = /no[- ]?expiry|non[- ]?expiry/i.test(String(data.package_size || data.plan || ""));
            providerNetwork = isNoExpiry ? "AT_NOEXPIRY" : "AT_EXPIRY";
          } else {
            providerNetwork = "MTN";
          }
        }
      } catch (e) {
        console.error("[skdataplug-payload-resolve] Error:", e);
      }

      return {
        recipient: String(data.recipient || data.phoneNumber || ""),
        network: providerNetwork,
        gb_size: gbSize,
        reference: String(data.reference || data.order_id || data.orderReference || "")
      };
    }

    if (handlerType === "superbdatafy") {
      const network = String(data.networkRaw || data.network || "").toLowerCase();
      let sbNetwork = network;
      if (network === "yello") sbNetwork = "mtn";
      if (network === "vod" || network === "vodafone") sbNetwork = "telecel";
      if (network === "airteltigo" || network === "at_premium") sbNetwork = "at";
      
      const pkgSize = String(data.package_size || data.plan || data.package_key || "").replace(/\s+/g, "").toLowerCase();
      const phone = String(data.recipient || data.phoneNumber || data.recipient_phone || "");

      try {
        const bundleRes = await fetch(`${provider.base_url}/bundles?network=${sbNetwork}`, {
          headers: { 
            "Authorization": `Bearer ${provider.api_key}`, 
            "Accept": "application/json" 
          }
        });
        if (bundleRes.ok) {
          const bData = await bundleRes.json();
          const bundles = bData?.bundles || [];
          const match = bundles.find((b: any) => String(b.capacity).replace(/\s+/g, "").toLowerCase() === pkgSize);
          if (match) {
            return { bundle_id: match.id, phone_number: phone };
          }
        }
      } catch (e: any) {
        console.error("SuperbDatafy payload resolve failed:", e.message);
      }
      
      // Fallback
      return { phone_number: phone, bundle_id: pkgSize };
    }

    if (handlerType === "xcel") {
      const orderType = String(data.order_type || "data").toLowerCase();
      const recipient = String(data.recipient || data.phoneNumber || data.recipient_phone || "");
      const amount = String(Number(data.amount || 0).toFixed(2));
      const extRef = String(data.orderReference || data.reference || "");
      const callbackUrl = String(data.callback_url || `${Deno.env.get("SUPABASE_URL")}/functions/v1/provider-webhook`);
      
      let productId = String(data.plan || data.package_size || data.productId || "");
      
      if (orderType === "utility") {
        const utilityProvider = String(data.utility_provider || "").toUpperCase();
        if (utilityProvider.includes("ECG")) {
          return {
            productId: "ECG_PREPAID",
            amount,
            meterNumber: data.utility_account_number || recipient,
            ext_transaction_id: extRef,
            callback_url: callbackUrl
          };
        } else {
          return {
            productId: data.utility_provider || productId,
            amount,
            smartCardNumber: data.utility_account_number || recipient,
            ext_transaction_id: extRef,
            callback_url: callbackUrl
          };
        }
      } else {
        // Airtime / Data
        if (orderType === "data") {
          try {
            const { data: pkgMapping } = await supabaseAdmin
              .from("provider_packages")
              .select("external_id")
              .eq("provider_id", provider.id)
              .eq("network", data.networkRaw || data.network || "")
              .eq("package_name", data.package_size || data.plan || "")
              .maybeSingle();
            if (pkgMapping?.external_id) {
              productId = pkgMapping.external_id;
            }
          } catch (e) {
            console.error("[xcel-payload-resolve] Error:", e);
          }
        } else if (orderType === "airtime") {
          try {
            const { data: pkgMapping } = await supabaseAdmin
              .from("provider_packages")
              .select("external_id")
              .eq("provider_id", provider.id)
              .eq("network", data.networkRaw || data.network || "")
              .ilike("package_name", "%Airtime%")
              .limit(1)
              .maybeSingle();
            if (pkgMapping?.external_id) {
              productId = pkgMapping.external_id;
            }
          } catch (e) {
            console.error("[xcel-payload-resolve-airtime] Error:", e);
          }
        }
        
        return {
          productId,
          amount,
          recipient,
          ext_transaction_id: extRef,
          callback_url: callbackUrl
        };
      }
    }

    // Default Generic Payload Fallback
    return {
      recipient: String(data.recipient || data.phoneNumber || ""),
      amount: Number(data.amount || 0),
      network: String(data.networkKey || data.networkRaw || ""),
      package_size: String(data.package_size || data.plan || ""),
      reference: String(data.reference || data.order_id || ""),
    };
  }

  async verifyDataHubBeneficiary(
    supabaseAdmin: any,
    provider: any,
    phone: string
  ): Promise<{ ok: boolean; reason?: string }> {
    const cleanUrl = (provider.base_url || "").trim().replace(/\/+$/, "");
    const url = `${cleanUrl}/purchases/verify-number`;
    const apiKey = provider.api_key || "";

    const cleanDigits = phone.replace(/\D/g, "");
    let localFormat = cleanDigits;
    let intlFormat = cleanDigits;

    if (cleanDigits.startsWith("233") && cleanDigits.length === 12) {
      localFormat = "0" + cleanDigits.slice(3);
    } else if (cleanDigits.length === 9) {
      localFormat = "0" + cleanDigits;
      intlFormat = "233" + cleanDigits;
    } else if (cleanDigits.startsWith("0") && cleanDigits.length === 10) {
      intlFormat = "233" + cleanDigits.slice(1);
    }

    const formatsToTest = [...new Set([localFormat, intlFormat])];

    // Check if the number has any successful order history (means it is already verified)
    const { data: hasHistory } = await supabaseAdmin
      .from("orders")
      .select("id")
      .in("status", ["fulfilled", "completed"])
      .or(`customer_phone.eq.${localFormat},customer_phone.eq.${intlFormat}`)
      .limit(1)
      .maybeSingle();

    if (hasHistory) {
      console.log(`[DataHub-Verify-Beneficiary] Number ${localFormat} verified via order history.`);
      return { ok: true };
    }

    let exists = false;
    let text = "";

    for (const testPhone of formatsToTest) {
      console.log(`[DataHub-Verify-Beneficiary] Verifying ${testPhone}...`);
      try {
        const res = await fetchViaDb(supabaseAdmin, url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            phone: testPhone,
            is_ported_number: true
          }),
          disableFallback: true,
        }, 12);

        text = await res.text();
        console.log(`[DataHub-Verify-Beneficiary] Response for ${testPhone} status ${res.status}: ${text}`);

        if (res.ok) {
          let parsed: any = {};
          try { parsed = JSON.parse(text); } catch { /* ignore */ }
          if (parsed.success || parsed.data?.exists) {
            exists = true;
            break;
          }
        }
      } catch (err) {
        console.error(`[DataHub-Verify-Beneficiary] Test failed for ${testPhone}:`, err);
      }
    }

    if (exists) {
      return { ok: true };
    }

    let errorMessage = `${phone} is not added to our beneficiary list`;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error && parsed.message) {
        errorMessage = parsed.message;
      } else if (parsed["Not on beneficiary list"]?.message) {
        errorMessage = parsed["Not on beneficiary list"].message;
      } else if (parsed["Not on beneficiary list"]?.error) {
        errorMessage = parsed["Not on beneficiary list"].error;
      } else if (parsed.message) {
        errorMessage = parsed.message;
      }
    } catch { /* ignore */ }

    return { ok: false, reason: errorMessage };
  }

  async purchase(
    supabaseAdmin: any,
    provider: any,
    data: PurchaseData
  ): Promise<ProviderResponse> {
    const handlerType = String(provider.handler_type || "").toLowerCase();
    const network = String(data.networkKey || data.networkRaw || "").toUpperCase();
    const category = String(data.category || "").toLowerCase();
    const isAffordable = category === "affordable" || category === "affordable sme" || category.includes("sme");

    if (handlerType === "datahub" && network.includes("MTN") && isAffordable && data.bypass_beneficiary !== true && data.bypass_beneficiary !== "true") {
      const recipient = String(data.recipient || data.phoneNumber || "");
      const check = await this.verifyDataHubBeneficiary(supabaseAdmin, provider, recipient);
      if (!check.ok) {
        return {
          ok: false,
          reason: check.reason || `${recipient} is not added to our beneficiary list`
        };
      }
    }

    const payload = await this.buildPayload(supabaseAdmin, provider, "purchase", data);
    return this.executeRequest(supabaseAdmin, provider, "purchase", payload, data);
  }

  async checkStatus(
    supabaseAdmin: any,
    provider: any,
    providerOrderId: string,
    reference: string
  ): Promise<ProviderResponse> {
    const activeProviderOrderId = (providerOrderId && providerOrderId !== "timeout" && providerOrderId !== "failed_api_call") ? providerOrderId : reference;
    const data: PurchaseData = {
      recipient: "",
      amount: 0,
      reference,
      networkRaw: "",
      networkKey: "",
      transaction_id: activeProviderOrderId,
      order_id: activeProviderOrderId
    };

    const payload = await this.buildPayload(supabaseAdmin, provider, "status", data);
    return this.executeRequest(supabaseAdmin, provider, "status", payload, data);
  }

  private async executeRequest(
    supabaseAdmin: any,
    provider: any,
    endpoint: string,
    payload: any,
    data: any
  ): Promise<ProviderResponse> {
    const handlerType = String(provider.handler_type || "standard").toLowerCase();
    const apiKey = (handlerType === "skdataplug" ? (Deno.env.get("SKDATAPLUG_API_KEY") || provider.api_key) : provider.api_key) || "";
    const baseUrl = provider.base_url || "";

    const urls = this.buildProviderUrls(baseUrl, endpoint, handlerType, data);
    let lastReason = "Provider communication failed";

    const isGet = (handlerType === "datamart" && endpoint === "status") || 
                  (handlerType === "superbdatafy" && endpoint === "status") || 
                  (handlerType === "xcel" && endpoint === "status") ||
                  (handlerType === "qhowmenzconsult" && endpoint === "status") ||
                  (handlerType === "skdataplug" && endpoint === "status");

    const maxAttempts = (endpoint === "status") ? 2 : 1;

    for (const url of urls) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Accept": "application/json",
          };

          headers["X-API-Key"] = apiKey;
          const idempotencyKey = String(data.orderReference || data.reference || data.order_id || "");
          if (idempotencyKey) {
            headers["X-Idempotency-Key"] = idempotencyKey;
          }

          if (handlerType === "xcel") {
            headers["x-api-key"] = apiKey;
            headers["x-merchant-id"] = String(provider.settings?.merchant_id || "");
          } else if (handlerType === "skdataplug" || handlerType === "datamart") {
            headers["Authorization"] = `Bearer ${apiKey}`;
            headers["x-api-key"] = apiKey;
            headers["User-Agent"] = "SwiftDataGH/2.0";
          } else if (handlerType !== "spendless" && handlerType !== "qhowmenzconsult") {
            headers["Authorization"] = `Bearer ${apiKey}`;
            headers["User-Agent"] = "SwiftDataGH/2.0";
          }

          console.log(`[StandardAdapter] calling URL: ${url} (${isGet ? "GET" : "POST"})`);
          const isStatus = endpoint === "status";
          const res = await fetchViaDb(supabaseAdmin, url, {
            method: isGet ? "GET" : "POST",
            headers,
            body: isGet ? undefined : JSON.stringify(payload),
            disableFallback: false,
            allowMutationFallback: isStatus,
          }, isStatus ? 25 : 35);

          const contentType = res.headers.get("content-type");
          const text = await res.text();

          if (res.ok) {
            const semantic = parseProviderResponse(text, contentType);
            if (semantic.ok) {
              const returnedId = semantic.id || String(data.reference || data.orderReference || data.order_id || "");
              return { ok: true, reason: "", id: returnedId, status: semantic.status };
            }
            return { ok: false, reason: semantic.reason || "Provider rejected this order." };
          }

          let parsedMsg = "";
          try { parsedMsg = JSON.parse(text)?.message || JSON.parse(text)?.error || ""; } catch { /* ignore */ }
          lastReason = parsedMsg || `Provider returned ${res.status}`;

          const isAlreadyPlaced = /already placed/i.test(lastReason) || /currently being processed/i.test(lastReason);
          if (isAlreadyPlaced) {
            return { ok: true, reason: "", status: "processing" };
          }

          if (res.status === 401 || res.status === 403) return { ok: false, reason: lastReason };
          if (res.status === 404 || isHtmlResponse(contentType, text)) break;

          if (res.status >= 500 && attempt < 2) {
            await new Promise((r) => setTimeout(r, 300));
            continue;
          }

          break;
        } catch (e: any) {
          lastReason = e?.message || "Network communication error";
          if (attempt < 2) await new Promise((r) => setTimeout(r, 300));
        }
      }
    }

    return { ok: false, reason: lastReason };
  }
}
