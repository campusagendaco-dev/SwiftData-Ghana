import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function check() {
  console.log("Checking MTN bundles...");
  const { data, error } = await supabase
    .from("global_package_settings")
    .select("package_size, public_price, agent_price, is_unavailable")
    .eq("network", "MTN");
  
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  console.log("Found bundles:", data?.length);
  data?.forEach(row => {
    console.log(`- ${row.package_size}: GH₵ ${row.public_price} (Unavailable: ${row.is_unavailable})`);
  });
}

check();
