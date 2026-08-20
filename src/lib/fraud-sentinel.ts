import { supabase } from "@/integrations/supabase/client";

export const KNOWN_SCAMMER_PHONES = [
  "0557061663", "233557061663", "557061663",
  "0544447965", "233544447965", "544447965",
  "0554634611", "233554634611", "554634611",
  "0559352100", "233559352100", "559352100"
];

export interface FraudCheckResult {
  allowed: boolean;
  reason?: string;
  threatLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

/**
 * Autonomous Anti-Fraud Sentinel Pre-Flight Check
 * Runs before any payment gateway or wallet deduction is initiated.
 */
export async function runFraudSentinelCheck(params: {
  phone: string;
  amount: number;
  orderType?: string;
  network?: string;
}): Promise<FraudCheckResult> {
  const { phone, amount, orderType } = params;
  const cleanPhone = (phone || "").replace(/\D+/g, "");
  const clean9 = cleanPhone.slice(-9);

  // 1. Blacklist Check
  if (clean9 && KNOWN_SCAMMER_PHONES.some(p => p.endsWith(clean9))) {
    console.warn(`[FRAUD_SENTINEL] Blocked blacklisted phone: ${cleanPhone}`);
    return {
      allowed: false,
      threatLevel: "CRITICAL",
      reason: "This phone number has been restricted due to suspicious activity. Please contact customer support."
    };
  }

  // 2. Airtime Purchase Cap (Max GHS 200)
  if (orderType === "airtime" && amount > 200) {
    return {
      allowed: false,
      threatLevel: "MEDIUM",
      reason: "Maximum single airtime purchase is GH₵200.00. Please enter a lower amount."
    };
  }

  // 3. Escalating Amount Spammer Shield (Airtime > 500 GHS)
  if (orderType === "airtime" && amount > 500) {
    return {
      allowed: false,
      threatLevel: "HIGH",
      reason: "Security Guard: Large airtime amounts require an authenticated account. Please log in or enter an amount under GH₵200.00."
    };
  }

  // 4. 3-Strike Unpaid Order Throttling (15-minute velocity window)
  if (clean9.length >= 9) {
    try {
      const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data: recentFailures } = await supabase
        .from("orders")
        .select("id, amount, status")
        .or(`customer_phone.ilike.%${clean9},metadata->>payment_phone.ilike.%${clean9}`)
        .eq("status", "fulfillment_failed")
        .gte("created_at", fifteenMinsAgo);

      if (recentFailures && recentFailures.length >= 3) {
        console.warn(`[FRAUD_SENTINEL] 3-Strike rule triggered for ${cleanPhone} (${recentFailures.length} recent failures)`);
        return {
          allowed: false,
          threatLevel: "HIGH",
          reason: "Your phone number has been temporarily restricted due to repeated uncompleted transactions. Please try again after 15 minutes."
        };
      }
    } catch (err) {
      console.warn("[FRAUD_SENTINEL] Velocity check error:", err);
    }
  }

  return { allowed: true, threatLevel: "LOW" };
}
