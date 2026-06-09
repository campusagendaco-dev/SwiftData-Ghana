import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Core logic function shared between Cron and HTTP Trigger
async function runSalesPromoRecommender(supabase: any, isManualTrigger = false): Promise<{ success: boolean; sent: number; error?: string }> {
  // 1. Check if AI Recommender is enabled in system settings
  const { data: settings, error: settingsError } = await supabase
    .from("v_system_settings_with_secrets").select("ai_recommender_enabled")
    .eq("id", 1)
    .maybeSingle();

  if (settingsError) {
    console.error("Failed to fetch settings:", settingsError);
    return { success: false, sent: 0, error: "Failed to fetch system settings" };
  }

  // If it's a scheduled cron and it's disabled, skip
  if (!isManualTrigger && settings && settings.ai_recommender_enabled === false) {
    console.log("AI Sales Recommender is disabled by admin in system settings. Skipping scheduled run.");
    return { success: true, sent: 0 };
  }

  // 1. Get orders from the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: orders, error } = await supabase
    .from("orders")
    .select("customer_phone, amount, package_size, created_at")
    .eq("status", "fulfilled")
    .in("order_type", ["data", "api"])
    .gte("created_at", thirtyDaysAgo.toISOString());

  if (error || !orders) {
    console.error("Failed to fetch orders:", error);
    return { success: false, sent: 0, error: error?.message || "Failed to fetch orders" };
  }

  // Helper function to format the last delivery timestamp cleanly
  const formatLastDeliveryTime = (isoString: string): string => {
    try {
      const dateObj = new Date(isoString);
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const month = months[dateObj.getMonth()];
      const day = dateObj.getDate();
      let hours = dateObj.getHours();
      const minutes = String(dateObj.getMinutes()).padStart(2, "0");
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12;
      hours = hours ? hours : 12; // the hour '0' should be '12'
      return `${month} ${day} at ${hours}:${minutes} ${ampm}`;
    } catch (e) {
      console.error("Error formatting date:", e);
      return "";
    }
  };

  // 2. Aggregate purchase frequency and total spent per phone number
  const userStats = new Map<string, { count: number; totalSpent: number; sizes: Set<string>; lastOrderTime: string }>();
  
  for (const o of orders) {
    if (!o.customer_phone) continue;
    const phone = o.customer_phone;
    if (!userStats.has(phone)) {
      userStats.set(phone, { count: 0, totalSpent: 0, sizes: new Set(), lastOrderTime: "" });
    }
    const stat = userStats.get(phone)!;
    stat.count += 1;
    stat.totalSpent += Number(o.amount || 0);
    if (o.package_size) stat.sizes.add(o.package_size.trim().toUpperCase());
    if (o.created_at && (!stat.lastOrderTime || o.created_at > stat.lastOrderTime)) {
      stat.lastOrderTime = o.created_at;
    }
  }

  // 3. Identify and run personalized savings analysis for frequent, small-bundle buyers
  let recommendationsSent = 0;
  const SMS_LIMIT_PER_RUN = 50; // Prevent spamming and high SMS costs

  for (const [phone, stats] of userStats.entries()) {
    if (recommendationsSent >= SMS_LIMIT_PER_RUN) break;

    // AI Logic: Detect users who make >= 4 small package purchases and spend >= 20 GHS in 30 days
    if (stats.count >= 4 && stats.totalSpent >= 20) {
      const sizesArray = Array.from(stats.sizes);
      const mostlySmall = sizesArray.some(s => s.includes("MB") || s === "1GB" || s === "2GB" || s === "3GB");

      if (mostlySmall) {
        // Dynamic Segmented Recommendations based on actual customer spending tiers
        let recBundleName = "5GB Monthly Plan";
        let recBundleCost = 30;

        if (stats.totalSpent >= 120) {
          recBundleName = "20GB Monthly Plan";
          recBundleCost = 80;
        } else if (stats.totalSpent >= 40) {
          recBundleName = "10GB Monthly Plan";
          recBundleCost = 50;
        }

        // Calculate custom Projected Monthly Savings
        const projectedSavings = stats.totalSpent - recBundleCost;
        let message = "";

        if (projectedSavings > 5) {
          message = `SwiftData AI: We noticed you bought small packages ${stats.count} times this month, spending GH₵${stats.totalSpent.toFixed(2)}. Upgrading to our unified ${recBundleName} for just GH₵${recBundleCost} would save you roughly GH₵${projectedSavings.toFixed(0)}! Log in to save now.`;
        } else {
          const formattedTime = stats.lastOrderTime ? formatLastDeliveryTime(stats.lastOrderTime) : "";
          const timeSuffix = formattedTime ? ` (last active ${formattedTime})` : "";
          message = `SwiftData AI noticed you buy data frequently${timeSuffix}. Consolidating to our standard ${recBundleName} will give you uninterrupted data at a lower unit rate. Log in to check details!`;
        }
        
        // Push to internal SMS queue
        const { error: insertError } = await supabase.from("sms_logs").insert({
          phone_number: phone,
          message: message,
          status: 'pending'
        });

        if (!insertError) {
          recommendationsSent++;
          console.log(`Personalized recommendation sent to ${phone} (Savings: GH₵${projectedSavings.toFixed(2)})`);
        }
      }
    }
  }
  
  console.log(`Sales Promo Recommender finished. Sent ${recommendationsSent} recommendations.`);
  return { success: true, sent: recommendationsSent };
}

// Deno.cron allows edge functions to run on a schedule natively!
if (typeof (Deno as any).cron === "function") {
  (Deno as any).cron("Sales Promo Recommender", "0 2 * * *", async () => {
    console.log("Running AI Sales Promo Recommender (Cron)...");
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    await runSalesPromoRecommender(supabase, false);
  });
} else {
  console.warn("Deno.cron is not supported in this runtime environment. Falling back to HTTP manual trigger only.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // If manual trigger via POST
    if (req.method === "POST") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await anonClient.auth.getUser();

      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .limit(1);

      if (!roles || roles.length === 0) {
        return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await runSalesPromoRecommender(supabase, true);
      if (!result.success) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, sent: result.sent }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ status: "AI Sales Recommender is active." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
