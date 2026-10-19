import { fetchViaDb } from "./db_proxy.ts";

declare const Deno: any;

export function normalizeGhanaPhone(phone: string): { normalized: string; isValid: boolean; isMtn: boolean; raw: string } {
  const raw = String(phone || "").trim();
  const digits = raw.replace(/\D/g, "");

  let normalized = "";
  if (digits.startsWith("233") && digits.length === 12) {
    normalized = "0" + digits.slice(3);
  } else if (digits.length === 9) {
    normalized = "0" + digits;
  } else if (digits.startsWith("0") && digits.length === 10) {
    normalized = digits;
  }

  const isValid = /^0(23|24|25|53|54|55|59|20|50|27|57|26|56)\d{7}$/.test(normalized);
  const isMtn = /^0(24|25|53|54|55|59)\d{7}$/.test(normalized);

  return {
    normalized: isValid ? normalized : raw,
    isValid,
    isMtn,
    raw,
  };
}

/**
 * Automatically submits one or multiple phone numbers for MTN carrier beneficiary verification.
 * 1. Upserts into beneficiary_submissions table in database.
 * 2. Proxies the numbers to DataHub /purchases/submit-numbers endpoint.
 * Fire-and-forget safe — never throws unhandled errors.
 */
export async function autoSubmitBeneficiaryNumbers(
  supabaseAdmin: any,
  phones: string | string[],
  source: string = "auto_verifier",
  orderId?: string
): Promise<{ success: boolean; submittedCount: number; numbers: string[]; error?: string }> {
  try {
    const rawList = Array.isArray(phones) ? phones : String(phones).split(/[\n,\s]+/);
    const validMtnNumbers: string[] = [];

    for (const p of rawList) {
      const parsed = normalizeGhanaPhone(p);
      if (parsed.isValid && parsed.isMtn) {
        if (!validMtnNumbers.includes(parsed.normalized)) {
          validMtnNumbers.push(parsed.normalized);
        }
      }
    }

    if (validMtnNumbers.length === 0) {
      return { success: false, submittedCount: 0, numbers: [], error: "No valid MTN phone numbers to submit." };
    }

    console.log(`[BeneficiaryAutoSubmit] Auto-submitting ${validMtnNumbers.length} number(s) from source: ${source} (Order: ${orderId || 'none'})...`);

    // 1. Upsert into database beneficiary_submissions
    try {
      const records = validMtnNumbers.map((num) => ({
        phone_number: num,
        network: "MTN",
        status: "submitted",
        source: source,
        submitted_by: "System Auto-Submitter",
        notes: orderId 
          ? `Auto-submitted for order ${orderId.slice(0, 8)} after unverified status or carrier rejection` 
          : "Auto-submitted by system after unverified beneficiary detection",
      }));

      await supabaseAdmin.from("beneficiary_submissions").upsert(records, { onConflict: "phone_number" });
    } catch (dbErr) {
      console.warn("[BeneficiaryAutoSubmit] Database log warning:", dbErr);
    }

    // 2. Fetch DataHub credentials (env first, then db)
    const { data: provider } = await supabaseAdmin
      .from("providers")
      .select("api_key, base_url")
      .eq("handler_type", "datahub")
      .eq("is_active", true)
      .maybeSingle();

    const apiKey = Deno.env.get("DATAHUB_API_KEY") || provider?.api_key || "";
    const rawBaseUrl = Deno.env.get("DATAHUB_BASE_URL") || provider?.base_url || "https://user.datahubgh.com/api/external";
    const cleanUrl = rawBaseUrl.trim().replace(/\/+$/, "");
    const targetUrl = cleanUrl.endsWith("/purchases/submit-numbers")
      ? cleanUrl
      : cleanUrl.includes("/purchases")
      ? `${cleanUrl}/submit-numbers`
      : `${cleanUrl}/purchases/submit-numbers`;

    if (!apiKey) {
      console.warn("[BeneficiaryAutoSubmit] DATAHUB_API_KEY missing. Number logged in DB only.");
      return { success: true, submittedCount: validMtnNumbers.length, numbers: validMtnNumbers };
    }

    // Submit in batches of 30
    const BATCH_SIZE = 30;
    for (let i = 0; i < validMtnNumbers.length; i += BATCH_SIZE) {
      const batch = validMtnNumbers.slice(i, i + BATCH_SIZE);
      try {
        const response = await fetchViaDb(
          supabaseAdmin,
          targetUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": apiKey,
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ numbers: batch.join(", ") }),
            disableFallback: true,
          },
          10
        );

        const resText = await response.text();
        console.log(`[BeneficiaryAutoSubmit] DataHub response for ${batch.length} number(s) (Status ${response.status}):`, resText.slice(0, 150));
      } catch (postErr) {
        console.error(`[BeneficiaryAutoSubmit] Failed to dispatch batch to DataHub:`, postErr);
      }
    }

    return { success: true, submittedCount: validMtnNumbers.length, numbers: validMtnNumbers };
  } catch (err: any) {
    console.error("[BeneficiaryAutoSubmit] Unexpected error:", err);
    return { success: false, submittedCount: 0, numbers: [], error: err?.message || String(err) };
  }
}

/**
 * Convenience single-number auto-submitter
 */
export async function autoSubmitBeneficiaryNumber(
  supabaseAdmin: any,
  phone: string,
  source: string = "auto_verifier",
  orderId?: string
): Promise<{ success: boolean; error?: string }> {
  const res = await autoSubmitBeneficiaryNumbers(supabaseAdmin, [phone], source, orderId);
  return { success: res.success, error: res.error };
}
