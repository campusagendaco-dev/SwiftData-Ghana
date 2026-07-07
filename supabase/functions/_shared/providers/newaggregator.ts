import { fetchViaDb } from "../db_proxy.ts";
import { ProviderAdapter, ProviderResponse, PurchaseData } from "./types.ts";
import { normalizeRecipient } from "./utils.ts";

export class NewAggregatorAdapter implements ProviderAdapter {
  /**
   * Maps database network names to the New Aggregator's network codes.
   */
  mapNetwork(rawNetwork: string): string {
    const rawNet = (rawNetwork || "").toUpperCase().trim();
    if (rawNet.includes("TELECEL") || rawNet.includes("VODA") || rawNet.includes("RED")) return "VODAFONE";
    if (rawNet.includes("AIRTEL") || rawNet.includes("TIGO") || rawNet.includes("AT") || rawNet.includes("BLUE")) return "AIRTELTIGO";
    if (rawNet.includes("GLO")) return "GLO";
    return "MTN";
  }

  /**
   * Triggers a purchase (Data, Airtime, or Utility) via the New Aggregator API.
   */
  async purchase(
    supabaseAdmin: any,
    provider: any,
    data: PurchaseData
  ): Promise<ProviderResponse> {
    // 1. Fetch credentials from provider settings (can be defined in Admin panel JSON settings or env)
    const CLIENT_ID = provider?.settings?.client_id || Deno.env.get("NEW_AGGREGATOR_CLIENT_ID") || "";
    const API_KEY = provider?.api_key || provider?.settings?.api_key || Deno.env.get("NEW_AGGREGATOR_API_KEY") || "";
    const SECRET_KEY = provider?.api_secret || provider?.settings?.secret_key || Deno.env.get("NEW_AGGREGATOR_SECRET_KEY") || "";
    const baseUrl = (provider.base_url || "").replace(/\/+$/, "");

    if (!API_KEY) {
      return { ok: false, reason: "New Aggregator API key not configured (check database settings)." };
    }

    const rawNet = String(data.networkRaw || data.network || "").toUpperCase();
    const recipient = normalizeRecipient(String(data.recipient || data.phoneNumber || ""));
    const transactionId = `${data.reference || data.order_id || ""}_${String(Date.now()).slice(-6)}`;
    const callbackUrl = String(data.callback_url || `${Deno.env.get("SUPABASE_URL")}/functions/v1/provider-webhook`);

    const orderType = String(data.order_type || "data").toLowerCase();
    
    // Placeholder payload: Update this once the API specification is shared!
    let endpoint = `${baseUrl}/transaction/process`;
    let payload: Record<string, any> = {
      client_id: CLIENT_ID,
      transaction_ref: transactionId,
      recipient: recipient,
      amount: Number(data.amount || 0),
      network: this.mapNetwork(rawNet),
      callback_url: callbackUrl,
      order_type: orderType,
    };

    if (orderType === "data") {
      endpoint = `${baseUrl}/data/topup`;
      payload.package_size = data.package_size || data.plan;
    } else if (orderType === "airtime") {
      endpoint = `${baseUrl}/airtime/topup`;
    } else if (orderType === "utility") {
      endpoint = `${baseUrl}/utility/pay`;
      payload.utility_provider = data.utility_provider;
      payload.account_number = data.utility_account_number;
    }

    console.log(`[NewAggregatorAdapter] Dispatching ${orderType} request to: ${endpoint}`, payload);

    try {
      // Execute the request via fetch or db proxy if proxying is enabled
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`,
          "X-Signature": SECRET_KEY // if signing is required
        },
        body: JSON.stringify(payload)
      });

      const responseText = await response.text();
      let responseJson: any = {};
      try {
        responseJson = JSON.parse(responseText);
      } catch (_) {
        return { ok: false, reason: `Invalid JSON response: ${responseText.slice(0, 100)}` };
      }

      if (!response.ok) {
        return { 
          ok: false, 
          reason: responseJson.message || responseJson.error || `HTTP ${response.status}`,
          rawBody: responseText
        };
      }

      // Map New Aggregator's response structure to SwiftData's unified format
      // Modify this mapping to align with the actual API response keys!
      const success = responseJson.status === "success" || responseJson.success === true || responseJson.status === "processing";
      
      return {
        ok: success,
        id: responseJson.transaction_id || responseJson.id || transactionId,
        status: responseJson.status || "processing",
        reason: responseJson.message || responseJson.error,
        rawBody: responseText,
        raw: responseJson
      };

    } catch (error) {
      console.error("[NewAggregatorAdapter] Purchase failure:", error);
      return { ok: false, reason: error.message || "Network request failed." };
    }
  }

  /**
   * Queries the status of an ongoing transaction.
   */
  async checkStatus(
    supabaseAdmin: any,
    provider: any,
    providerOrderId: string,
    reference: string
  ): Promise<ProviderResponse> {
    const API_KEY = provider?.api_key || provider?.settings?.api_key || Deno.env.get("NEW_AGGREGATOR_API_KEY") || "";
    const baseUrl = (provider.base_url || "").replace(/\/+$/, "");

    if (!baseUrl || !API_KEY) {
      return { ok: false, reason: "Configuration missing for status check." };
    }

    const endpoint = `${baseUrl}/transaction/status?id=${providerOrderId || reference}`;
    console.log(`[NewAggregatorAdapter] Querying transaction status: ${endpoint}`);

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        }
      });

      const responseText = await response.text();
      let responseJson: any = {};
      try {
        responseJson = JSON.parse(responseText);
      } catch (_) {
        return { ok: false, reason: `Status invalid response: ${responseText.slice(0, 100)}` };
      }

      const isCompleted = responseJson.status === "success" || responseJson.status === "completed" || responseJson.status === "delivered";
      const isFailed = responseJson.status === "failed" || responseJson.status === "refunded";

      let status: any = "processing";
      if (isCompleted) status = "fulfilled";
      else if (isFailed) status = "fulfillment_failed";

      return {
        ok: response.ok,
        status,
        reason: responseJson.message || responseJson.error,
        rawBody: responseText,
        raw: responseJson
      };

    } catch (error) {
      console.error("[NewAggregatorAdapter] Status check failure:", error);
      return { ok: false, reason: error.message };
    }
  }
}
