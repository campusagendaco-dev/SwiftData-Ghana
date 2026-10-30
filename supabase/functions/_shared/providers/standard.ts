import { fetchViaDb } from "../db_proxy.ts";
import { ProviderAdapter, ProviderResponse, PurchaseData } from "./types.ts";
import { 
  normalizeRecipient, 
  parseProviderResponse, 
  parseCapacity, 
  mapDataNetworkKey, 
  isHtmlResponse,
  isDuplicateOrderError
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
        const candidates = Array.from(new Set([
          String(data.reference || "").trim(),
          String(data.transaction_id || "").trim(),
          String(data.order_id || "").trim()
        ].filter(Boolean)));
        return candidates.map(cand => `${clean}/order-status/${cand}`);
      }
      const rawNet = String(data.networkKey || data.networkRaw || data.network || "").toUpperCase();
      const pkgUpper = String(data.package_size || data.package_name || data.bundle || data.plan || data.capacity || "").toUpperCase();
      const isMashUp = 
        rawNet.includes("MASH") || 
        rawNet.includes("COMBO") || 
        data.category === "mashup" || 
        endpoint === "mashup" || 
        endpoint === "mashup_purchase" ||
        (data as any).comboCost !== undefined ||
        (pkgUpper.includes("MINS") && rawNet.includes("MTN"));
      if (isMashUp) {
        return [`${clean}/mashup/purchase`];
      }
      if (endpoint === "verify-number" || endpoint === "beneficiary") {
        return [`${clean}/verify-number`];
      }
      if (endpoint === "verify-number-bulk" || endpoint === "beneficiary-bulk") {
        return [`${clean}/verify-number/bulk`];
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

    if (handlerType === "bundlezone") {
      if (endpoint === "status") {
        const ref = String(data.transaction_id || data.reference || data.order_id || "");
        return [
          `${clean}/api/status.php?reference=${encodeURIComponent(ref)}`,
          `${clean}/api/status.php?order_id=${encodeURIComponent(ref)}`
        ];
      }
      if (endpoint === "beneficiary") {
        return [`${clean}/api/beneficiary-check.php`];
      }
      if (endpoint === "bundles") {
        return [
          `${clean}/api/bundles.php?network=MTN_EXPRESS&active=0`,
          `${clean}/api/bundles.php?active=0`
        ];
      }
      if (endpoint === "balance") {
        return [`${clean}/api/balance.php`];
      }
      return [`${clean}/api/order.php`];
    }

    // Standard URL formatting fallback
    if (handlerType === "bossu" || handlerType === "superbdatafy" || handlerType === "xcel" || handlerType === "qhowmenzconsult") {
      return [clean];
    }

    if (handlerType === "datahub") {
      const alias =
        endpoint === "purchase"
          ? "data-purchase"
          : endpoint === "status"
          ? "order-status"
          : endpoint === "refund" || endpoint === "order-refund"
          ? "order-refund"
          : endpoint;
      return [`${clean}/${alias}`];
    }
    if (handlerType === "spendless") {
      if (endpoint === "status") {
        const ref = String(data.transaction_id || data.reference || data.order_id || "");
        return [
          `${clean}/orders?reference=${ref}`,
          `${clean}/transactions`
        ];
      }
      if (endpoint === "afa" || endpoint === "afa-registration") {
        return [`${clean}/afa`];
      }
      if (endpoint === "balance") {
        return [`${clean}/balance`];
      }
      return [`${clean}/purchase`];
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
    const recipient = normalizeRecipient(String(data.recipient || data.phoneNumber || data.phone || data.customer_phone || data.phone_number || data.mobile || data.customerPhone || (data as any).metadata?.payment_phone || (data as any).metadata?.customer_phone || (data as any).metadata?.phone || (data as any).metadata?.recipient_phone || ""));
    const targetRef = String(data.reference || data.orderReference || data.order_id || data.id || "");
    const rawNet = String(data.networkKey || data.networkRaw || data.network || "").toUpperCase();
    const netKey = mapDataNetworkKey(rawNet);
    const pkgSize = String(data.capacity || data.package_size || data.plan || data.package || data.bundle || data.package_name || "");
    const capNum = parseCapacity(pkgSize);
    const capacityStr = String(capNum > 0 ? capNum : pkgSize);

    if (handlerType === "datamart") {
      const pkgUpper = String(data.package_size || data.package_name || data.bundle || data.plan || data.capacity || "").toUpperCase();
      const isMashUp = 
        rawNet.includes("MASH") || 
        rawNet.includes("COMBO") || 
        data.category === "mashup" || 
        endpoint === "mashup" || 
        endpoint === "mashup_purchase" ||
        (data as any).comboCost !== undefined ||
        (pkgUpper.includes("MINS") && rawNet.includes("MTN"));

      if (isMashUp) {
        let comboCost = Number((data as any).comboCost || 0);
        const cleanPkgKey = pkgSize.toLowerCase().replace(/[^a-z0-9.]/g, "");

        const VALID_COMBO_COSTS = new Set([10, 20, 30, 35, 40, 50, 55, 60, 75, 80, 85, 100]);

        // Normalized key map without spaces, hyphens, pluses
        const MASHUP_COMBO_MAP: Record<string, number> = {
          // Official DataMart packages
          "511mb176mins": 10,
          "511mb": 10,
          "1gb353mins": 20,
          "1015mb353mins": 20,
          "1015mb": 20,
          "2gb397mins": 30,
          "2013mb397mins": 30,
          "2013mb": 30,
          "3.5gb88mins": 35,
          "3530mb88mins": 35,
          "3530mb": 35,
          "4gb176mins": 40,
          "4043mb176mins": 40,
          "4043mb": 40,
          "3.5gb529mins": 50,
          "3545mb529mins": 50,
          "3545mb": 50,
          "5.5gb264mins": 55,
          "5556mb264mins": 55,
          "5556mb": 55,
          "6gb353mins": 60,
          "6066mb353mins": 60,
          "6066mb": 60,
          "7gb441mins": 75,
          "7100mb441mins": 75,
          "7100mb": 75,
          "6.5gb705mins": 80,
          "6630mb705mins": 80,
          "6630mb": 80,
          "8gb529mins": 85,
          "8074mb529mins": 85,
          "8074mb": 85,
          "8gb881mins": 100,
          "8079mb881mins": 100,
          "8079mb": 100,

          // Legacy backwards-compatible aliases
          "2.6gb1077mins": 20,
          "4.5gb1800mins": 30,
          "3.4gbonly": 35,
          "3.4gb": 35,
          "6gb700mins": 40,
          "10gb1800mins": 50,
          "5.1gbonly": 55,
          "5.1gb": 55,
          "6.8gbonly": 60,
          "6.8gb": 60,
          "8.5only": 75,
          "8.5gbonly": 75,
          "8.5gb": 75,
          "8.5": 75,
          "10gbonly": 80,
          "870mb360mins": 85,
          "3.5gb14500mins": 100,
          "3.5gb1450mins": 100,
        };

        if (!comboCost || !VALID_COMBO_COSTS.has(comboCost)) {
          if (MASHUP_COMBO_MAP[cleanPkgKey]) {
            comboCost = MASHUP_COMBO_MAP[cleanPkgKey];
          }
        }

        if (!comboCost || !VALID_COMBO_COSTS.has(comboCost)) {
          const external = String(data.planId || data.plan || data.package_size || (data as any).package || "").trim();
          const comboExplicit = external.match(/combo(?:cost)?[:_\s]*(\d+)/i) || external.match(/mashup[:_\s]*(\d+)/i);
          if (comboExplicit && VALID_COMBO_COSTS.has(Number(comboExplicit[1]))) {
            comboCost = Number(comboExplicit[1]);
          } else if (VALID_COMBO_COSTS.has(Number(external))) {
            comboCost = Number(external);
          }
        }

        if (!comboCost || !VALID_COMBO_COSTS.has(comboCost)) {
          try {
            const { data: pkgMapping } = await supabaseAdmin
              .from("provider_packages")
              .select("external_id, raw_data")
              .eq("provider_id", provider.id)
              .or("network.ilike.%MASH%,network.eq.MTN_COMBO")
              .or(`package_name.eq.${pkgSize},package_name.ilike.%${pkgSize.trim()}%`)
              .maybeSingle();

            const extId = Number(pkgMapping?.external_id);
            if (VALID_COMBO_COSTS.has(extId)) {
              comboCost = extId;
            } else if (VALID_COMBO_COSTS.has(Number(pkgMapping?.raw_data?.comboCost || pkgMapping?.raw_data?.capacity))) {
              comboCost = Number(pkgMapping.raw_data.comboCost || pkgMapping.raw_data.capacity);
            }
          } catch (e) {
            console.error("[datamart-mashup-resolve] Error:", e);
          }
        }

        if (!comboCost || !VALID_COMBO_COSTS.has(comboCost)) {
          if (cleanPkgKey.includes("10gb") && cleanPkgKey.includes("only")) comboCost = 80;
          else if (cleanPkgKey.includes("10gb")) comboCost = 50;
          else comboCost = 10;
        }

        return {
          phoneNumber: recipient,
          comboCost: comboCost,
          ref: targetRef,
          network: "MTN_COMBO"
        };
      }

      const datamartNet = (rawNet.includes("MTN") || rawNet === "YELLO")
        ? "YELLO"
        : ((rawNet.includes("TELECEL") || rawNet.includes("VODA")) ? "TELECEL" : "AT_PREMIUM");

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
        capacity: capacityStr,
        orderReference: targetRef,
        reference: targetRef,
        ref: targetRef,
        gateway: "wallet",
        bypass_beneficiary: true
      };
    }

    if (handlerType === "spendless") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const webhookUrl = supabaseUrl
        ? `${supabaseUrl}/functions/v1/provider-webhook`
        : undefined;

      if (endpoint === "afa" || endpoint === "afa-registration" || (data as any).order_type === "afa" || rawNet === "AFA") {
        const fullName = (data as any).full_name || (data as any).fullName || (data as any).afa_full_name || (data as any).name || "";
        const ghanaCard = (data as any).ghana_card || (data as any).ghanaCardNumber || (data as any).afa_ghana_card || "";
        const location = (data as any).location || (data as any).placeOfResidence || (data as any).afa_residence || (data as any).residence || "";
        const occupation = (data as any).occupation || (data as any).afa_occupation || "";
        const dob = (data as any).date_of_birth || (data as any).dateOfBirth || (data as any).afa_date_of_birth || (data as any).dob || "";
        const email = (data as any).email || (data as any).afa_email || "";

        const afaPayload: any = {
          full_name: fullName,
          fullName: fullName,
          phone: recipient,
          recipient: recipient,
          ghana_card: ghanaCard,
          ghanaCardNumber: ghanaCard,
          location: location,
          placeOfResidence: location,
          occupation: occupation,
          date_of_birth: dob,
          email: email,
          reference: targetRef,
        };
        if (webhookUrl) afaPayload.webhook_url = webhookUrl;
        return afaPayload;
      }

      const payloadObj: any = {
        networkKey: netKey,
        recipient: recipient,
        capacity: capNum > 0 ? capNum : (Number(capacityStr) || 1),
        reference: targetRef,
      };
      if (webhookUrl) {
        payloadObj.webhook_url = webhookUrl;
      }
      return payloadObj;
    }

    if (handlerType === "datahub") {
      const dhCapNum = capNum > 0 ? capNum : (parseFloat(capacityStr) || 0);
      const safeDhCapacity = dhCapNum > 0 ? String(dhCapNum) : (pkgSize.match(/(\d+(?:\.\d+)?)/)?.[1] || "1");
      return {
        networkKey: netKey,
        recipient: recipient,
        capacity: safeDhCapacity,
        reference: targetRef,
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
        recipient: recipient,
        plan_id: packageId,
        package_id: packageId,
        product_id: packageId,
        external_id: packageId,
        amount: Number(data.amount || 0),
        reference: targetRef,
      };
    }

    if (handlerType === "skdataplug") {
      let providerNetwork = "MTN";
      let gbSize = capacityStr;

      const rawPkgStr = String(data.package_size || data.plan || data.package || data.bundle || data.package_name || data.capacity || "").trim();
      const cleanPkgName = rawPkgStr.replace(/\s+/g, "");
      const mappedDbNet = mapDataNetworkKey(rawNet);

      try {
        const { data: pkgMapping } = await supabaseAdmin
          .from("provider_packages")
          .select("raw_data, capacity_gb")
          .eq("provider_id", provider.id)
          .or(`network.eq.${mappedDbNet},network.eq.${rawNet}`)
          .or(`package_name.eq.${rawPkgStr},package_name.eq.${cleanPkgName}`)
          .limit(1)
          .maybeSingle();

        if (pkgMapping?.raw_data) {
          providerNetwork = pkgMapping.raw_data.network || providerNetwork;
          gbSize = String(pkgMapping.raw_data.gb_size || pkgMapping.capacity_gb || gbSize);
        } else {
          if (rawNet.includes("VOD") || rawNet.includes("TELECEL")) {
            providerNetwork = "TELECEL";
          } else if (rawNet.includes("AT") || rawNet.includes("AIRTEL")) {
            const isNoExpiry = /no[- ]?expiry|non[- ]?expiry/i.test(rawPkgStr);
            providerNetwork = isNoExpiry ? "AT_NOEXPIRY" : "AT_EXPIRY";
          } else {
            providerNetwork = "MTN";
          }
        }
      } catch (e) {
        console.error("[skdataplug-payload-resolve] Error:", e);
      }

      // Mandatory Network Sanitization for SK Data Plug (Valid: "MTN", "TELECEL", "AT_EXPIRY", "AT_NOEXPIRY")
      let finalNetwork = String(providerNetwork || "").toUpperCase().trim();
      if (finalNetwork === "AT" || finalNetwork === "AIRTELTIGO" || finalNetwork === "AIRTEL" || finalNetwork === "TIGO" || finalNetwork === "AT_PREMIUM" || finalNetwork === "AT_BIGTIME") {
        const isNoExpiry = /no[- ]?expiry|non[- ]?expiry/i.test(rawPkgStr);
        finalNetwork = isNoExpiry ? "AT_NOEXPIRY" : "AT_EXPIRY";
      } else if (finalNetwork.includes("VOD") || finalNetwork.includes("TELECEL")) {
        finalNetwork = "TELECEL";
      } else if (finalNetwork.includes("MTN") || finalNetwork === "YELLO") {
        finalNetwork = "MTN";
      } else if (finalNetwork !== "AT_EXPIRY" && finalNetwork !== "AT_NOEXPIRY" && finalNetwork !== "TELECEL" && finalNetwork !== "MTN") {
        finalNetwork = "MTN";
      }

      // Mandatory gb_size Sanitization (strip "GB"/"MB", ensure valid non-empty numeric string)
      let cleanGbSize = String(gbSize).replace(/\s*(gb|mb|tb)\s*/gi, "").trim();
      if (!cleanGbSize || cleanGbSize === "0" || cleanGbSize === "0.0" || cleanGbSize === "undefined" || cleanGbSize === "null" || isNaN(Number(cleanGbSize))) {
        const parsedCap = parseCapacity(rawPkgStr);
        if (parsedCap > 0) {
          cleanGbSize = String(parsedCap);
        } else {
          const numMatch = rawPkgStr.match(/(\d+(?:\.\d+)?)/);
          cleanGbSize = numMatch ? numMatch[1] : "1";
        }
      }

      const cleanRecipient = normalizeRecipient(String(data.recipient || data.phoneNumber || data.phone || data.customer_phone || data.phone_number || data.mobile || data.customerPhone || (data as any).metadata?.payment_phone || (data as any).metadata?.customer_phone || (data as any).metadata?.phone || (data as any).metadata?.recipient_phone || ""));

      return {
        recipient: cleanRecipient || recipient,
        network: finalNetwork,
        gb_size: cleanGbSize,
        reference: targetRef
      };
    }

    if (handlerType === "bundlezone") {
      const isExpressMode = provider?.settings?.express_mode_enabled !== false;
      let bzNetwork = isExpressMode ? "MTN_EXPRESS" : "YELLO";
      if (rawNet.includes("VOD") || rawNet.includes("TELECEL")) {
        bzNetwork = "Telecel";
      } else if (rawNet.includes("AT") || rawNet.includes("AIRTEL") || rawNet.includes("TIGO")) {
        bzNetwork = "AT";
      } else {
        bzNetwork = isExpressMode ? "MTN_EXPRESS" : "YELLO";
      }

      if (endpoint === "beneficiary") {
        return {
          network: bzNetwork,
          phone_number: recipient
        };
      }

      // MTN Express client_reference requirement:
      // 8–100 letters, digits, dots, underscores, colons or hyphens.
      const rawClientRef = String(
        (data as any).client_reference ||
        (data as any).metadata?.client_reference ||
        targetRef ||
        `swiftdata-${Date.now()}`
      ).trim();
      let cleanClientRef = rawClientRef.replace(/[^A-Za-z0-9._:-]/g, "-");
      if (cleanClientRef.length < 8) {
        cleanClientRef = `swiftdata-${cleanClientRef}`;
      }
      if (cleanClientRef.length > 100) {
        cleanClientRef = cleanClientRef.slice(0, 100);
      }

      if (data.mode === "bulk" && Array.isArray((data as any).rows)) {
        // Remove duplicate recipient/bundle pairs and enforce 1–20 row limit per BundleZone MTN_EXPRESS spec
        const seenPairs = new Set<string>();
        const dedupedRows: Array<{ recipient: string; capacity: number }> = [];
        for (const r of (data as any).rows) {
          const rPhone = normalizeRecipient(String(r?.recipient || r?.phone || r?.phone_number || ""));
          const rCap = Number(r?.capacity || parseCapacity(String(r?.package_size || r?.capacity || "")) || 1);
          if (!rPhone || rCap <= 0) continue;
          const pairKey = `${rPhone}:${rCap}`;
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);
          dedupedRows.push({ recipient: rPhone, capacity: rCap });
          if (dedupedRows.length >= 20) break;
        }

        return {
          mode: "bulk",
          network: bzNetwork,
          client_reference: cleanClientRef,
          reference: cleanClientRef,
          rows: dedupedRows,
        };
      }

      const bzCapacity = capNum > 0 ? capNum : (parseFloat(capacityStr) || 1);

      return {
        mode: "single",
        network: bzNetwork,
        recipient: recipient,
        capacity: bzCapacity,
        client_reference: cleanClientRef,
        reference: cleanClientRef,
      };
    }

    if (handlerType === "superbdatafy") {
      const network = rawNet.toLowerCase();
      let sbNetwork = network;
      if (network === "yello") sbNetwork = "mtn";
      if (network === "vod" || network === "vodafone") sbNetwork = "telecel";
      if (network === "airteltigo" || network === "at_premium") sbNetwork = "at";
      
      const pkgKey = String(data.package_size || data.plan || data.package_key || "").replace(/\s+/g, "").toLowerCase();

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
          const match = bundles.find((b: any) => String(b.capacity).replace(/\s+/g, "").toLowerCase() === pkgKey);
          if (match) {
            return { bundle_id: match.id, phone_number: recipient };
          }
        }
      } catch (e: any) {
        console.error("SuperbDatafy payload resolve failed:", e.message);
      }
      
      // Fallback
      return { phone_number: recipient, bundle_id: pkgKey };
    }

    if (handlerType === "xcel") {
      const orderType = String(data.order_type || "data").toLowerCase();
      const amount = String(Number(data.amount || 0).toFixed(2));
      const extRef = targetRef;
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
      recipient: recipient,
      amount: Number(data.amount || 0),
      network: netKey,
      networkKey: netKey,
      package_size: capacityStr,
      capacity: capacityStr,
      reference: targetRef,
    };
  }

  async verifyDataHubBeneficiary(
    supabaseAdmin: any,
    provider: any,
    phone: string
  ): Promise<{ ok: boolean; reason?: string }> {
    const rawBaseUrl = Deno.env.get("DATAHUB_BASE_URL") || provider?.base_url || "https://user.datahubgh.com/api/external";
    const cleanUrl = rawBaseUrl.trim().replace(/\/+$/, "");
    const url = `${cleanUrl}/purchases/verify-number`;
    const apiKey = Deno.env.get("DATAHUB_API_KEY") || provider?.api_key || "";

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

    let errorMessage = `The recipient number ${phone} has reached its daily MTN data transfer limit, belongs to an unsupported plan (e.g. corporate SIM), or has promotional messages blocked. Please check the recipient or try another number.`;
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

  async verifyBundleZoneBeneficiary(
    supabaseAdmin: any,
    provider: any,
    phone: string,
    network: string
  ): Promise<{ ok: boolean; reason?: string }> {
    const rawBaseUrl = Deno.env.get("BUNDLEZONE_BASE_URL") || provider?.base_url || "https://bundlezone.shop";
    const cleanUrl = rawBaseUrl.trim().replace(/\/+$/, "");
    const url = `${cleanUrl}/api/beneficiary-check.php`;
    const apiKey = Deno.env.get("BUNDLEZONE_API_KEY") || provider?.api_key || "";

    const localPhone = normalizeRecipient(phone);

    const { data: hasHistory } = await supabaseAdmin
      .from("orders")
      .select("id")
      .in("status", ["fulfilled", "completed"])
      .eq("customer_phone", localPhone)
      .limit(1)
      .maybeSingle();

    if (hasHistory) {
      console.log(`[BundleZone-Verify-Beneficiary] Number ${localPhone} verified via previous order history.`);
      return { ok: true };
    }

    try {
      console.log(`[BundleZone-Verify-Beneficiary] Checking beneficiary status for ${localPhone}...`);
      const isExpressMode = provider?.settings?.express_mode_enabled !== false;
      const netUpper = String(network || "").toUpperCase();
      const bzNet = (netUpper === "MTN" || netUpper === "YELLO" || netUpper.includes("MTN") || !netUpper)
        ? (isExpressMode ? "MTN_EXPRESS" : "YELLO")
        : network;
      const res = await fetchViaDb(supabaseAdmin, url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          network: bzNet,
          phone_number: localPhone
        }),
        disableFallback: true,
      }, 15);

      const text = await res.text();
      console.log(`[BundleZone-Verify-Beneficiary] Response status ${res.status}: ${text}`);

      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch { /* ignore */ }

      if (res.ok && parsed.success) {
        if (
          parsed.data?.verification_required === false ||
          String(parsed.data?.status || "").toLowerCase() === "not_required" ||
          String(parsed.data?.verification_status || "").toUpperCase() === "NOT_REQUIRED"
        ) {
          return { ok: true };
        }
        const results = parsed.data?.results || [];
        const match = results.find((r: any) => r.phone_number === localPhone) || results[0];
        if (match) {
          const vStatus = String(match.verification_status || "").toUpperCase();
          const mStatus = String(match.status || "").toLowerCase();
          if (
            vStatus === "VERIFIED" ||
            vStatus === "NOT_REQUIRED" ||
            mStatus === "not_required" ||
            match.verification_required === false ||
            match.can_order === true
          ) {
            return { ok: true };
          }
          return {
            ok: false,
            reason: match.message || `MTN recipient ${localPhone} is not verified (${vStatus || "NOT_VERIFIED"}).`
          };
        }
        return { ok: true };
      }

      if (parsed.message) {
        return { ok: false, reason: parsed.message };
      }
    } catch (err: any) {
      console.error(`[BundleZone-Verify-Beneficiary] Check failed for ${localPhone}:`, err);
    }

    return { ok: true };
  }

  async verifyDataMartBeneficiary(
    supabaseAdmin: any,
    provider: any,
    phone: string
  ): Promise<{ ok: boolean; reason?: string; servable?: boolean; recommendation?: string }> {
    const localPhone = normalizeRecipient(phone);
    const apiKey = Deno.env.get("DATAMART_API_KEY") || provider?.api_key || "";
    const baseUrl = (Deno.env.get("DATAMART_BASE_URL") || provider?.base_url || "https://api.datamartgh.shop/api/developer").trim().replace(/\/+$/, "");
    const url = `${baseUrl}/verify-number`;

    if (!apiKey) return { ok: true };

    try {
      console.log(`[DataMart-Verify-Beneficiary] Checking ${localPhone}...`);
      const res = await fetchViaDb(supabaseAdmin, url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify({ phoneNumber: localPhone }),
        disableFallback: true,
      }, 10);

      const text = await res.text();
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch { /* ignore */ }

      if (res.ok && parsed.status === "success" && parsed.data) {
        if (parsed.data.servable === true) {
          return { ok: true, servable: true, recommendation: "sell_any" };
        }
        return {
          ok: false,
          servable: false,
          recommendation: parsed.data.recommendation,
          reason: parsed.data.message || `MTN number ${localPhone} cannot receive data yet (${parsed.data.recommendation || "activate_first"}).`
        };
      }
    } catch (err: any) {
      console.error(`[DataMart-Verify-Beneficiary] Check failed for ${localPhone}:`, err);
    }
    return { ok: true };
  }

  async refundDataHubOrder(
    supabaseAdmin: any,
    provider: any,
    params: { reference?: string; orderNumber?: string | number; method?: "GET" | "POST" }
  ): Promise<ProviderResponse> {
    const rawBaseUrl = Deno.env.get("DATAHUB_BASE_URL") || provider?.base_url || "https://user.datahubgh.com/api/external";
    const cleanUrl = rawBaseUrl.trim().replace(/\/+$/, "");
    const apiKey = Deno.env.get("DATAHUB_API_KEY") || provider?.api_key || "";
    const method = params.method === "GET" ? "GET" : "POST";

    const cleanRef = String(params.reference ?? "").trim();
    const rawOrderNum = params.orderNumber !== undefined && params.orderNumber !== null ? String(params.orderNumber).trim() : "";
    const cleanOrderNum = rawOrderNum && rawOrderNum !== "failed_api_call" && rawOrderNum !== "timeout" && rawOrderNum !== "manual_fulfillment_mode"
      ? rawOrderNum
      : "";

    if (!cleanRef && !cleanOrderNum) {
      return {
        ok: false,
        status: "bad_request",
        reason: "Either 'reference' or 'orderNumber' is required",
      };
    }

    const attempts: Array<{ type: "reference" | "orderNumber"; value: string | number }> = [];
    if (cleanRef) {
      attempts.push({ type: "reference", value: cleanRef });
    }
    if (cleanOrderNum && cleanOrderNum !== cleanRef) {
      const numVal = /^\d+$/.test(cleanOrderNum) ? Number(cleanOrderNum) : cleanOrderNum;
      attempts.push({ type: "orderNumber", value: numVal });
    }

    let lastStatus = "not_eligible";
    let lastReason = "Order is not eligible for refund";
    let lastRaw: any = null;

    for (const attempt of attempts) {
      try {
        const isGet = method === "GET";
        const targetUrl = isGet
          ? `${cleanUrl}/order-refund?${attempt.type}=${encodeURIComponent(String(attempt.value))}`
          : `${cleanUrl}/order-refund`;

        const headers: Record<string, string> = {
          "Accept": "application/json",
          "X-API-Key": apiKey,
        };
        if (!isGet) {
          headers["Content-Type"] = "application/json";
        }

        const bodyObj = attempt.type === "orderNumber"
          ? { orderNumber: attempt.value }
          : { reference: String(attempt.value) };

        console.log(`[DataHub-Order-Refund] Calling ${method} ${targetUrl} with ${attempt.type}=${attempt.value}`);
        const res = await fetchViaDb(
          supabaseAdmin,
          targetUrl,
          {
            method,
            headers,
            body: isGet ? undefined : JSON.stringify(bodyObj),
            disableFallback: false,
            allowMutationFallback: true,
          },
          20
        );

        const text = await res.text();
        let parsed: any = {};
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { rawText: text };
        }
        lastRaw = parsed;

        if (res.ok && (parsed.success === true || String(parsed?.data?.status || "").toUpperCase() === "REFUNDED")) {
          const dataObj = parsed.data || {};
          const newBal = Number(dataObj.newBalance);
          if (Number.isFinite(newBal) && provider?.id && supabaseAdmin) {
            await Promise.resolve(
              supabaseAdmin
                .from("providers")
                .update({
                  balance: newBal,
                  last_synced_at: new Date().toISOString(),
                })
                .eq("id", provider.id)
            ).catch((e: any) => console.warn("[DataHub-Order-Refund] Balance sync warning:", e?.message));
          }

          return {
            ok: true,
            status: String(dataObj.status || "REFUNDED").toLowerCase(),
            id: String(dataObj.orderNumber || dataObj.reference || attempt.value),
            reason: parsed.message || "Refund credited to your wallet",
            rawBody: text,
            raw: dataObj,
          };
        }

        const errMessage =
          parsed?.error ||
          parsed?.["Not eligible"]?.error ||
          parsed?.["Missing identifier"]?.error ||
          parsed?.message ||
          (res.status === 404 ? "Order not found" : res.status === 401 ? "Unauthorized" : "Order is not eligible for refund");

        lastReason = String(errMessage);
        if (res.status === 404) {
          lastStatus = "not_found";
          // Try next candidate (e.g. orderNumber if reference returned 404)
          continue;
        }
        if (res.status === 401) {
          return {
            ok: false,
            status: "unauthorized",
            reason: lastReason,
            rawBody: text,
            raw: parsed,
          };
        }

        lastStatus = "not_eligible";
        break;
      } catch (err: any) {
        console.error(`[DataHub-Order-Refund] Error for ${attempt.type}=${attempt.value}:`, err?.message || err);
        lastReason = err?.message || "Failed to communicate with DataHub refund endpoint";
        lastStatus = "error";
      }
    }

    return {
      ok: false,
      status: lastStatus,
      reason: lastReason,
      raw: lastRaw,
    };
  }

  async refundOrder(
    supabaseAdmin: any,
    provider: any,
    params: { reference?: string; orderNumber?: string | number; method?: "GET" | "POST" }
  ): Promise<ProviderResponse> {
    const handlerType = String(provider?.handler_type || "").toLowerCase();
    if (handlerType === "datahub") {
      return this.refundDataHubOrder(supabaseAdmin, provider, params);
    }
    return {
      ok: false,
      status: "not_eligible",
      reason: "Order is not eligible for refund",
    };
  }

  async purchase(
    supabaseAdmin: any,
    provider: any,
    data: PurchaseData
  ): Promise<ProviderResponse> {
    const handlerType = String(provider.handler_type || "").toLowerCase();
    const network = String(data.networkKey || data.networkRaw || data.network || "").toUpperCase();
    const rawCategory = String(data.category || (data as any).package_category || (data as any).metadata?.category || "").toLowerCase();
    const isMashUp = network.includes("MASH") || rawCategory.includes("mash");
    const isAffordable = (rawCategory === "affordable" || rawCategory === "affordable sme" || rawCategory.includes("sme")) && !isMashUp;

    if (handlerType === "datahub" && network.includes("MTN") && isAffordable && !isMashUp && data.bypass_beneficiary !== true && data.bypass_beneficiary !== "true") {
      const recipient = normalizeRecipient(String(data.recipient || data.phoneNumber || data.phone || data.customer_phone || data.phone_number || (data as any).metadata?.payment_phone || (data as any).metadata?.customer_phone || (data as any).metadata?.phone || (data as any).metadata?.recipient_phone || ""));
      const check = await this.verifyDataHubBeneficiary(supabaseAdmin, provider, recipient);
      if (!check.ok) {
        return {
          ok: false,
          reason: check.reason || `The recipient number ${recipient} has reached its daily MTN data transfer limit, belongs to an unsupported plan (e.g. corporate SIM), or has promotional messages blocked. Please check the recipient or try another number.`
        };
      }
    }

    // BundleZone: When Express Mode is enabled (default), MTN_EXPRESS orders skip number verification.
    // When Express Mode is explicitly disabled by admin, verify MTN beneficiary against YELLO.
    if (handlerType === "bundlezone" && provider?.settings?.express_mode_enabled === false && (network.includes("MTN") || network.includes("YELLO")) && !isMashUp && data.bypass_beneficiary !== true && data.bypass_beneficiary !== "true") {
      const recipient = normalizeRecipient(String(data.recipient || data.phoneNumber || data.phone || data.customer_phone || data.phone_number || (data as any).metadata?.payment_phone || (data as any).metadata?.customer_phone || (data as any).metadata?.phone || (data as any).metadata?.recipient_phone || ""));
      const check = await this.verifyBundleZoneBeneficiary(supabaseAdmin, provider, recipient, "YELLO");
      if (!check.ok) {
        return {
          ok: false,
          reason: check.reason || `MTN recipient ${recipient} is not verified on the BundleZone beneficiary list.`
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
    const handlerType = String(provider?.handler_type || "").toLowerCase();
    if (handlerType === "bundlezone") {
      try {
        const apiKey = Deno.env.get("BUNDLEZONE_API_KEY") || provider.api_key || "";
        const baseUrl = (Deno.env.get("BUNDLEZONE_BASE_URL") || provider.base_url || "https://bundlezone.shop").replace(/\/+$/, "");
        const candidates = Array.from(new Set([providerOrderId, reference].filter(Boolean)));
        
        for (const cand of candidates) {
          for (const param of ["reference", "order_id"]) {
            const res = await fetch(`${baseUrl}/api/status.php?${param}=${encodeURIComponent(cand)}`, {
              headers: {
                "X-API-KEY": apiKey,
                "x-api-key": apiKey,
                "Accept": "application/json"
              }
            });
            if (res.ok) {
              const json = await res.json().catch(() => ({}));
              const orderObj = json.data?.order || json.data;
              if (json.success && orderObj && (orderObj.status || json.data?.status)) {
                const s = String(orderObj.status || json.data?.status || "").toLowerCase().trim();
                const isDelivered = ["completed", "delivered", "fulfilled"].includes(s);
                const isPendingOrUnknown = ["processing", "pending", "queued", "submission_unknown"].includes(s);
                const isExplicitlyRefunded = s === "refunded" || s === "reversed" || orderObj.refunded === true;
                const isCharged = orderObj.charged !== false;
                const isFailedState = ["failed", "rejected", "cancelled"].includes(s);

                const resolvedId = String(orderObj.reference || orderObj.order_id || orderObj.id || json.data?.order_id || cand);

                if (isDelivered) {
                  return {
                    ok: true,
                    status: "fulfilled",
                    id: resolvedId,
                    raw: orderObj
                  };
                }

                if (isPendingOrUnknown) {
                  return {
                    ok: true,
                    status: "processing",
                    reason: s === "submission_unknown" ? "Order submission confirmation pending reconciliation" : undefined,
                    id: resolvedId,
                    raw: orderObj
                  };
                }

                if (isExplicitlyRefunded || (isFailedState && !isCharged)) {
                  return {
                    ok: false,
                    status: "refunded",
                    reason: orderObj.message || json.data?.message || json.message || "Provider refunded order",
                    id: resolvedId,
                    raw: orderObj
                  };
                }

                if (isFailedState) {
                  // MTN Express: Do not mark an order refunded until `refunded: true`.
                  // BundleZone reviews failed orders and refunds their charges at the end of the day (or earlier on confirmed rejection).
                  if (!isExplicitlyRefunded && isCharged) {
                    return {
                      ok: false,
                      status: "failed_pending_refund",
                      reason: orderObj.message || json.data?.message || json.message || "Carrier delivery failed; awaiting end-of-day settlement",
                      id: resolvedId,
                      raw: orderObj
                    };
                  }
                  return {
                    ok: false,
                    status: "fulfillment_failed",
                    reason: orderObj.message || json.data?.message || json.message || `Order ${s}`,
                    id: resolvedId,
                    raw: orderObj
                  };
                }

                return {
                  ok: true,
                  status: "processing",
                  id: resolvedId,
                  raw: orderObj
                };
              }
            }
          }
        }
      } catch (err: any) {
        console.warn("[BundleZone-checkStatus] Error:", err.message);
      }
      return { ok: false, status: "not_found", reason: "Order not found on BundleZone." };
    }
    if (handlerType === "spendless") {
      try {
        const apiKey = Deno.env.get("SPENDLESS_API_KEY") || provider.api_key || "";
        const pages = [1, 2, 3];
        for (const page of pages) {
          const txRes = await fetch(`https://spendless.top/api/transactions?page=${page}`, {
            method: "GET",
            headers: {
              "X-API-Key": apiKey,
              "Accept": "application/json"
            }
          });
          if (txRes.ok) {
            const txJson = await txRes.json();
            const txs = txJson?.data?.transactions || txJson?.transactions || [];
            const match = txs.find((t: any) =>
              String(t.orderId) === String(providerOrderId) ||
              String(t.reference) === String(providerOrderId) ||
              String(t.reference) === String(reference)
            );
            if (match) {
              const st = String(match.status || "").toLowerCase();
              if (st === "delivered" || st === "successful" || st === "completed") {
                return { ok: true, status: "delivered", id: String(match.reference || match.orderId), raw: match };
              }
              if (st === "failed" || st === "rejected" || st === "cancelled" || st === "reversed" || st === "refunded") {
                return { ok: false, status: "failed", reason: match.reason || `Spendless order ${st}`, raw: match };
              }
              return { ok: true, status: "processing", id: String(match.reference || match.orderId), raw: match };
            }
          }
        }
      } catch (err: any) {
        console.warn("[Spendless checkStatus] Fallback to /api/transactions error:", err?.message || err);
      }
      return { ok: false, status: "not_found", reason: "Order not found on Spendless." };
    }

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
    const apiKey = (
      handlerType === "datahub" ? (Deno.env.get("DATAHUB_API_KEY") || provider.api_key) :
      handlerType === "skdataplug" ? (Deno.env.get("SKDATAPLUG_API_KEY") || provider.api_key) :
      handlerType === "bundlezone" ? (Deno.env.get("BUNDLEZONE_API_KEY") || provider.api_key) :
      handlerType === "datamart" ? (Deno.env.get("DATAMART_API_KEY") || provider.api_key) :
      provider.api_key
    ) || "";
    const baseUrl = (
      handlerType === "datahub" ? (Deno.env.get("DATAHUB_BASE_URL") || provider.base_url || "https://user.datahubgh.com/api/external") :
      handlerType === "bundlezone" ? (Deno.env.get("BUNDLEZONE_BASE_URL") || provider.base_url || "https://bundlezone.shop") :
      handlerType === "datamart" ? (Deno.env.get("DATAMART_BASE_URL") || provider.base_url || "https://api.datamartgh.shop/api/developer") :
      provider.base_url
    ) || "";

    const urls = this.buildProviderUrls(baseUrl, endpoint, handlerType, data);
    let lastReason = "Provider communication failed";

    const isGet = (handlerType === "datamart" && (endpoint === "status" || endpoint === "mashup_packages")) || 
                  (handlerType === "superbdatafy" && endpoint === "status") || 
                  (handlerType === "xcel" && endpoint === "status") ||
                  (handlerType === "qhowmenzconsult" && endpoint === "status") ||
                  (handlerType === "skdataplug" && endpoint === "status") ||
                  (handlerType === "spendless" && endpoint === "status") ||
                  (handlerType === "bundlezone" && (endpoint === "status" || endpoint === "bundles" || endpoint === "balance"));

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
            delete headers["X-API-Key"];
            headers["x-api-key"] = apiKey;
            headers["x-merchant-id"] = String(provider.settings?.merchant_id || "");
          } else if (handlerType === "bundlezone") {
            const bzIdempKey = String(payload?.client_reference || payload?.reference || idempotencyKey || "").trim();
            headers["X-API-KEY"] = apiKey;
            headers["x-api-key"] = apiKey;
            if (bzIdempKey) {
              headers["Idempotency-Key"] = bzIdempKey;
              headers["X-Idempotency-Key"] = bzIdempKey;
            }
            headers["User-Agent"] = "BundleZone-Client/1.0";
          } else if (handlerType === "datamart") {
            // DataMart strictly expects only X-API-Key. Duplicate lowercase x-api-key or Authorization JWT breaks verification
            headers["X-API-Key"] = apiKey;
            delete headers["x-api-key"];
            delete headers["Authorization"];
            headers["User-Agent"] = "SwiftDataGH/2.0";
          } else if (handlerType === "skdataplug") {
            headers["Authorization"] = `Bearer ${apiKey}`;
            delete headers["X-API-Key"];
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

          // Same-Order Duplicate Guard (applies to HTTP 200 AND 409 replies):
          // If the provider says "duplicate" AND echoes back OUR OWN reference for this order,
          // this exact order was already accepted on an earlier attempt. Treat it as accepted and keep
          // the provider's real order ID. Failing it would put it into duplicate_cooldown and re-route it
          // to another provider after 60 mins => double data delivery.
          // Duplicates that echo a DIFFERENT reference (genuine repeat purchase for the same number) are
          // left to the existing cooldown flow so that second purchase still gets delivered.
          if (endpoint !== "status") {
            try {
              const dup = JSON.parse(text);
              const ourRef = String(payload?.client_reference || payload?.reference || data?.reference || data?.orderReference || data?.order_id || data?.id || "").trim();
              const echoedRef = String(
                dup?.data?.client_reference ??
                dup?.data?.order?.client_reference ??
                dup?.data?.reference ??
                dup?.data?.order?.reference ??
                ""
              ).trim();
              const dupText = [dup?.code, dup?.error_code, dup?.message, dup?.error]
                .filter((v: unknown) => typeof v === "string")
                .join(" ");
              if (ourRef && echoedRef && echoedRef === ourRef && isDuplicateOrderError(dupText)) {
                const existingId = String(
                  dup?.data?.order?.reference ??
                  dup?.data?.order_id ??
                  dup?.data?.order?.order_id ??
                  dup?.data?.order?.id ??
                  ourRef
                );
                console.warn(`[StandardAdapter] ${handlerType} reports order ${ourRef} already placed (provider id ${existingId}). Treating as accepted - NOT re-routing.`);
                return { ok: true, reason: `Already accepted by provider (${dupText})`, id: existingId, status: "processing" };
              }
            } catch { /* non-JSON body - fall through to normal handling */ }
          }

          if (res.ok) {
            const semantic = parseProviderResponse(text, contentType);
            if (semantic.ok) {
              const returnedId = semantic.id || String(payload?.client_reference || data.reference || data.orderReference || data.order_id || "");
              return { ok: true, reason: "", id: returnedId, status: semantic.status };
            }
            // For status checks, only surface a failure status when the provider EXPLICITLY reported one.
            // Anything else (e.g. success:false "order not found") stays inconclusive so callers never
            // fail + re-route an order that may already be delivering (double data).
            const explicitFail = ["failed", "refunded", "reversed", "rejected", "cancelled", "declined", "failed_pending_refund"];
            const semStatus = String(semantic.status || "").toLowerCase();
            return {
              ok: false,
              reason: semantic.reason || "Provider rejected this order.",
              status: endpoint === "status" ? (explicitFail.includes(semStatus) ? semStatus : "error") : semStatus || undefined,
            };
          }

          let parsedMsg = "";
          try { 
            const p = JSON.parse(text);
            const firstErr = Array.isArray(p?.errors) ? p.errors[0] : (p?.errors && typeof p.errors === "object" ? p.errors : null);
            const errStatus = String(firstErr?.status || p?.data?.order?.status || p?.data?.status || "").toLowerCase();
            if (errStatus === "submission_unknown" && endpoint !== "status") {
              const pendingId = String(
                firstErr?.reference ??
                p?.data?.order?.reference ??
                p?.data?.order?.order_id ??
                payload?.client_reference ??
                data?.reference ??
                data?.order_id ??
                ""
              );
              return {
                ok: true,
                id: pendingId,
                status: "processing",
                reason: firstErr?.message || p?.message || "Order status is submission_unknown; awaiting reconciliation."
              };
            }
            const code = firstErr?.code || p?.code || p?.error_code;
            const msg = firstErr?.message || p?.message || p?.error;
            parsedMsg = code && msg ? `${code}: ${msg}` : (msg || code || "");
          } catch { /* ignore */ }
          lastReason = parsedMsg || `Provider returned ${res.status}`;
          if (res.status === 404 && (/route not found|cannot (get|post)/i.test(lastReason))) {
            lastReason = "Order not found on provider";
          }

          const isAlreadyPlaced = /already placed/i.test(lastReason) || 
            /currently being processed/i.test(lastReason) || 
            /ORDER_ALREADY_PENDING/i.test(lastReason) ||
            /already pending/i.test(lastReason) ||
            /duplicate/i.test(lastReason) ||
            /cooldown/i.test(lastReason) ||
            /already exist/i.test(lastReason) ||
            /DUPLICATE_REFERENCE/i.test(lastReason);
          if (isAlreadyPlaced) {
            return { ok: true, reason: lastReason, status: "processing" };
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

    const isNotFound = /not found|cannot (get|post)/i.test(lastReason);
    // Transport/auth errors during a STATUS check are inconclusive ("error"), never "failed":
    // a timeout or 500 tells us nothing about whether the carrier delivered the order.
    return { ok: false, status: endpoint === "status" ? (isNotFound ? "not_found" : "error") : undefined, reason: lastReason };
  }
}
