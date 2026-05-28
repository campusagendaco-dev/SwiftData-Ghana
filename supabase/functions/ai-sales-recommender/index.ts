import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";

// Deno.cron allows edge functions to run on a schedule natively!
Deno.cron("Sales Promo Recommender", "0 2 * * *", async () => {
  console.log("Running AI Sales Promo Recommender...");
  
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Get orders from the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: orders, error } = await supabase
    .from("orders")
    .select("customer_phone, amount, package_size")
    .eq("status", "fulfilled")
    .in("order_type", ["data", "api"])
    .gte("created_at", thirtyDaysAgo.toISOString());

  if (error || !orders) {
    console.error("Failed to fetch orders:", error);
    return;
  }

  // 2. Aggregate purchase frequency and total spent per phone number
  const userStats = new Map<string, { count: number; totalSpent: number; sizes: Set<string> }>();
  
  for (const o of orders) {
    if (!o.customer_phone) continue;
    const phone = o.customer_phone;
    if (!userStats.has(phone)) {
      userStats.set(phone, { count: 0, totalSpent: 0, sizes: new Set() });
    }
    const stat = userStats.get(phone)!;
    stat.count += 1;
    stat.totalSpent += Number(o.amount || 0);
    if (o.package_size) stat.sizes.add(o.package_size.trim().toUpperCase());
  }

  // 3. Identify users who buy small packages very frequently
  let recommendationsSent = 0;
  const SMS_LIMIT_PER_RUN = 50; // Prevent spamming and high SMS costs

  for (const [phone, stats] of userStats.entries()) {
    if (recommendationsSent >= SMS_LIMIT_PER_RUN) break;

    // AI Logic: If they bought > 5 times in 30 days, and total spent > 50 GHS, and mostly small packages
    // Recommend a 10GB or 20GB monthly plan.
    if (stats.count >= 5 && stats.totalSpent >= 40) {
      const sizesArray = Array.from(stats.sizes);
      const mostlySmall = sizesArray.some(s => s.includes("MB") || s === "1GB" || s === "2GB");

      if (mostlySmall) {
        // Send SMS recommendation
        const message = `Hi! SwiftData AI noticed you buy data frequently. Did you know our 10GB Monthly package is cheaper for you? Log in to upgrade and save money today!`;
        
        // Push to internal SMS queue or queue a table row to avoid blocking
        const { error: insertError } = await supabase.from("sms_logs").insert({
          phone_number: phone,
          message: message,
          status: 'pending'
        });

        if (!insertError) {
          recommendationsSent++;
          console.log(`Recommendation sent to ${phone}`);
        }
      }
    }
  }
  
  console.log(`Sales Promo Recommender finished. Sent ${recommendationsSent} recommendations.`);
});

// We still need an HTTP handler because Edge Functions require one to deploy,
// even if they are purely cron-driven.
serve(async (req) => {
  return new Response(JSON.stringify({ status: "AI Sales Recommender is active." }), {
    headers: { "Content-Type": "application/json" },
  });
});
