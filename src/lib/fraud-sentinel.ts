import { supabase } from "@/integrations/supabase/client";

export const KNOWN_SCAMMER_PHONES = [
  "0557061663", "233557061663", "557061663",
  "0544447965", "233544447965", "544447965",
  "0554634611", "233554634611", "554634611",
  "0559352100", "233559352100", "559352100",
  "0548823936", "233548823936", "548823936",
  "0554634636", "233554634636", "554634636"
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

  // 2. 🌙 Night Guard Rule: Restrict guest airtime purchases between 11:00 PM and 6:00 AM (Ghana Time / UTC)
  if (orderType === "airtime") {
    const currentUtcHour = new Date().getUTCHours();
    const isNightHours = currentUtcHour >= 23 || currentUtcHour < 6;
    
    try {
      const { data: authData } = await supabase.auth.getSession();
      const isAuthenticated = !!authData?.session?.user;

      if (!isAuthenticated && isNightHours) {
        return {
          allowed: false,
          threatLevel: "HIGH",
          reason: "Night Guard Protection: Guest airtime purchases are restricted between 11:00 PM and 6:00 AM. Please log in or create an account to purchase airtime during night hours."
        };
      }
    } catch {
      // ignore auth check error
    }
  }

  // 3. Airtime Purchase Cap (Max GHS 200)
  if (orderType === "airtime" && amount > 200) {
    return {
      allowed: false,
      threatLevel: "MEDIUM",
      reason: "Maximum single airtime purchase is GH₵200.00. Please enter a lower amount."
    };
  }

  // 4. Rate Limiter (Targeted at Airtime, High-Volume Bot Flooding & Swarms)
  if (clean9.length >= 9) {
    try {
      // Local session rapid checkout cooldown
      const lastCheckoutTime = Number(sessionStorage.getItem("last_checkout_timestamp") || "0");
      const now = Date.now();
      if (now - lastCheckoutTime < 3500) {
        return {
          allowed: false,
          threatLevel: "MEDIUM",
          reason: "Please wait a moment before submitting another checkout."
        };
      }
      sessionStorage.setItem("last_checkout_timestamp", String(now));

      const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      // Check recent pending unpaid orders across the system in the last 5 minutes
      const { data: recentPending } = await supabase
        .from("orders")
        .select("id, customer_phone, amount, status, order_type")
        .or(`customer_phone.ilike.%${clean9},metadata->>payment_phone.ilike.%${clean9}`)
        .in("status", ["pending", "awaiting_payment"])
        .gte("created_at", fiveMinsAgo);

      if (recentPending && recentPending.length >= 2) {
        return {
          allowed: false,
          threatLevel: "HIGH",
          reason: "You already have a pending uncompleted order. Please complete or cancel your existing order before placing a new one."
        };
      }

      const query = supabase
        .from("orders")
        .select("id, amount, status, order_type")
        .or(`customer_phone.ilike.%${clean9},metadata->>payment_phone.ilike.%${clean9}`)
        .eq("status", "fulfillment_failed")
        .gte("created_at", fifteenMinsAgo);

      const { data: recentFailures } = await query;

      if (recentFailures) {
        const airtimeFailures = recentFailures.filter((o: any) => o.order_type === "airtime").length;
        const totalFailures = recentFailures.length;

        // Strict limit for custom airtime orders (3+), higher tolerance for catalog data orders (6+)
        if ((orderType === "airtime" && airtimeFailures >= 3) || totalFailures >= 5) {
          console.warn(`[FRAUD_SENTINEL] Rate limit triggered for ${cleanPhone} (${totalFailures} failures)`);
          return {
            allowed: false,
            threatLevel: "HIGH",
            reason: "Security Alert: Your phone number has been temporarily restricted due to repeated uncompleted transactions. Please try again after 15 minutes."
          };
        }
      }
    } catch (err) {
      console.warn("[FRAUD_SENTINEL] Velocity check error:", err);
    }
  }

  return { allowed: true, threatLevel: "LOW" };
}
