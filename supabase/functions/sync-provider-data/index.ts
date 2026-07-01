import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { fetchViaDb } from "../_shared/db_proxy.ts";

serve(async (req) => {
  // 1. Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { 
      status: 200, 
      headers: corsHeaders 
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // SECURITY: Require admin or service-role authentication
  const authHeader = req.headers.get("Authorization");
  const userToken = req.headers.get("x-user-access-token");
  const token = userToken || authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
  if (!isServiceRole) {
    const authResult = await verifyAdmin(req, supabaseAdmin);
    if (!authResult.success) {
      return new Response(JSON.stringify({ success: false, error: authResult.error }), {
        status: authResult.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const { provider_id } = await req.json();
    if (!provider_id) throw new Error("Missing provider_id");

    const { data: provider, error: providerError } = await supabaseAdmin
      .from("providers")
      .select("*")
      .eq("id", provider_id)
      .single();

    if (providerError || !provider) throw new Error("Provider not found");

    const handlerType = provider.handler_type || "standard";
    const apiKey = provider.api_key;
    const baseUrl = provider.base_url?.replace(/\/+$/, "");

    if (!apiKey || !baseUrl) throw new Error("Provider API key or Base URL missing");

    let packagesSynced = 0;
    let balance = provider.balance;

    if (handlerType === "datamart" || handlerType === "standard") {
      console.log(`Syncing ${handlerType} provider: ${provider.name}`);

      const cleanBase = baseUrl.trim().replace(/\/+$/, "");

      // 1. Sync Packages
      const packageUrlVariations = [
        `${cleanBase}/data-packages`,
        `${cleanBase}/api/data-packages`,
        `${cleanBase}/developer/data-packages`,
        `${cleanBase}/api/developer/data-packages`,
        `${cleanBase}/packages`
      ];

      let res;
      for (const url of packageUrlVariations) {
        console.log(`[sync] Trying package URL: ${url}`);
        const response = await fetch(url, {
          headers: { "X-API-Key": apiKey, "Accept": "application/json" }
        });
        if (response.ok) {
          res = response;
          break;
        }
      }

      if (res) {
        const result = await res.json();
        const rawData = result.data || result.packages || result;
        if (rawData && typeof rawData === "object") {
          const allPackages = [];

          // Handle both DataMart (nested by network) and Standard (array or object)
          const networks = handlerType === "datamart" ? Object.keys(rawData) : ["MTN", "Telecel", "AirtelTigo"];

          for (const netKey of networks) {
            const netPackages = handlerType === "datamart" ? rawData[netKey] : (Array.isArray(rawData) ? rawData : []);
            if (!Array.isArray(netPackages)) continue;

            let dbNetwork = netKey;
            if (netKey === "YELLO") dbNetwork = "MTN";

            for (const pkg of netPackages) {
              // Skip if package doesn't match network for standard array
              if (handlerType === "standard" && pkg.network && pkg.network !== netKey) continue;

              allPackages.push({
                provider_id: provider.id,
                network: dbNetwork,
                package_name: pkg.capacity >= 1 ? `${pkg.capacity}GB` : (pkg.package_name || `${pkg.mb || 0}MB`),
                capacity_gb: pkg.capacity || ((pkg.mb || 0) / 1024),
                cost_price: pkg.price || pkg.amount,
                external_id: String(pkg.id || pkg.package_id || `${dbNetwork}_${pkg.capacity}`),
                raw_data: pkg,
                is_active: true
              });
            }
          }

          if (allPackages.length > 0) {
            const { error: upsertError } = await supabaseAdmin
              .from("provider_packages")
              .upsert(allPackages, { onConflict: "provider_id,network,package_name" });
            if (upsertError) console.error("Package upsert error:", upsertError);
            packagesSynced = allPackages.length;
          }
        }
      }

      // 2. Sync Balance
      const balanceUrlVariations = [
        `${cleanBase}/balance`,
        `${cleanBase}/api/balance`,
        `${cleanBase}/developer/balance`,
        `${cleanBase}/api/developer/balance`
      ];

      for (const url of balanceUrlVariations) {
        console.log(`[sync] Trying balance URL: ${url}`);
        const balanceRes = await fetch(url, {
          headers: { "X-API-Key": apiKey, "Accept": "application/json" }
        });

        if (balanceRes.ok) {
          const bResult = await balanceRes.json();
          const rawBal = bResult.data?.rawBalance || bResult.data?.balance || bResult.balance;
          if (rawBal !== undefined) {
            // Clean currency symbols if it's a string
            balance = typeof rawBal === "string" ? parseFloat(rawBal.replace(/[^\d.]/g, "")) : Number(rawBal);
            console.log(`[sync] Found balance: ${balance}`);
            break;
          }
        }
      }
    } else if (handlerType === "datahub") {
      console.log(`Syncing DataHub Ghana provider: ${provider.name}`);

      // DataHub bundles live at /api/bundles (not under /api/external)
      const origin = new URL(baseUrl).origin;
      const bundlesUrl = `${origin}/api/bundles`;

      console.log(`[sync:datahub] Fetching bundles from: ${bundlesUrl}`);
      const bundlesRes = await fetch(bundlesUrl, {
        headers: { "X-API-Key": apiKey, "Accept": "application/json" }
      });

      if (bundlesRes.ok) {
        const result = await bundlesRes.json();
        const networks: any[] = result.networks || [];
        const allPackages = [];

        const networkKeyToDb: Record<string, string> = {
          YELLO: "MTN",
          TELECEL: "Telecel",
          AT_PREMIUM: "AirtelTigo",
          AT_BIGTIME: "AirtelTigo",
        };

        for (const network of networks) {
          if (!network.isActive) continue;
          const dbNetwork = networkKeyToDb[network.networkKey] || network.networkKey;
          const bundles: any[] = network.bundles || [];

          for (const bundle of bundles) {
            if (!bundle.isActive) continue;
            const capacityGb = (bundle.sizeInMB || 0) / 1024;

            allPackages.push({
              provider_id: provider.id,
              network: dbNetwork,
              package_name: bundle.size,
              capacity_gb: capacityGb,
              cost_price: bundle.price,
              external_id: bundle.id,
              raw_data: { ...bundle, networkKey: network.networkKey },
              is_active: true,
            });
          }
        }

        if (allPackages.length > 0) {
          const { error: upsertError } = await supabaseAdmin
            .from("provider_packages")
            .upsert(allPackages, { onConflict: "provider_id,network,package_name" });
          if (upsertError) console.error("[sync:datahub] Package upsert error:", upsertError);
          packagesSynced = allPackages.length;
          console.log(`[sync:datahub] Synced ${packagesSynced} packages`);
        }
      } else {
        console.error(`[sync:datahub] Bundles fetch failed: ${bundlesRes.status}`);
      }

      // Sync Balance — GET /api/external/balance
      const balanceRes = await fetch(`${baseUrl}/balance`, {
        headers: { "X-API-Key": apiKey, "Accept": "application/json" }
      });

      if (balanceRes.ok) {
        const bResult = await balanceRes.json();
        const rawBal = bResult.data?.balance ?? bResult.balance;
        if (rawBal !== undefined) {
          balance = typeof rawBal === "string" ? parseFloat(rawBal.replace(/[^\d.]/g, "")) : Number(rawBal);
          console.log(`[sync:datahub] Balance: GHS ${balance}`);
        }
      } else {
        console.warn(`[sync:datahub] Balance fetch failed: ${balanceRes.status}`);
      }
    } else if (handlerType === "superbdatafy") {
      console.log(`Syncing SuperbDatafy provider: ${provider.name}`);

      const allPackages = [];
      const networks = ["mtn", "telecel", "at"];

      const parseCapacity = (packageSize: string): number => {
        if (!packageSize) return 0;
        const match = packageSize.toString().replace(/\s+/g, "").toLowerCase().match(/(\d+(?:\.\d+)?)\s*(gb|mb)/);
        if (match) {
          const val = parseFloat(match[1]);
          const unit = match[2];
          return unit === "gb" ? val : val / 1024;
        }
        const fallbackMatch = packageSize.toString().replace(/\s+/g, "").match(/(\d+(?:\.\d+)?)/);
        return fallbackMatch ? parseFloat(fallbackMatch[1]) : 0;
      };

      // 1. Sync Packages
      for (const net of networks) {
        try {
          const res = await fetch(`${baseUrl}/bundles?network=${net}`, {
            method: "GET",
            headers: {
              "Accept": "application/json",
              "Authorization": `Bearer ${apiKey}`
            }
          });

          if (!res.ok) {
            const bodyText = await res.text().catch(() => "");
            throw new Error(`HTTP ${res.status}: ${bodyText || res.statusText}`);
          }
          const result = await res.json();
          const pkgs = result.bundles || result.data || result || [];
          
          if (Array.isArray(pkgs)) {
            for (const pkg of pkgs) {
              const dbNetwork = net === "mtn" ? "MTN" : (net === "telecel" ? "Telecel" : "AirtelTigo");
              const capacityStr = pkg.capacity || pkg.name || pkg.bundle_name || "";
              const capacityGb = Number(parseCapacity(capacityStr));
              
              allPackages.push({
                provider_id: provider.id,
                network: dbNetwork,
                package_name: capacityStr || `${capacityGb}GB`,
                capacity_gb: capacityGb,
                cost_price: Number(pkg.price || pkg.amount || pkg.cost || 0),
                external_id: String(pkg.id || pkg.bundle_id),
                raw_data: pkg,
                is_active: true
              });
            }
          }
        } catch (err: any) {
          console.error(`[sync:superbdatafy] Error fetching packages for ${net}:`, err);
          throw err;
        }
      }

      if (allPackages.length > 0) {
        const { error: upsertError } = await supabaseAdmin
          .from("provider_packages")
          .upsert(allPackages, { onConflict: "provider_id,network,package_name" });
        if (upsertError) console.error("[sync:superbdatafy] Package upsert error:", upsertError);
        packagesSynced = allPackages.length;
        console.log(`[sync:superbdatafy] Synced ${packagesSynced} packages`);
      }

      // 2. Sync Balance
      try {
        const balanceRes = await fetch(`${baseUrl}/wallet`, {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Authorization": `Bearer ${apiKey}`
          }
        });

        if (balanceRes.ok) {
          const bResult = await balanceRes.json();
          const rawBal = bResult.balance ?? bResult.data?.balance ?? bResult.wallet_balance;
          if (rawBal !== undefined) {
            balance = typeof rawBal === "string" ? parseFloat(rawBal.replace(/[^\d.]/g, "")) : Number(rawBal);
            console.log(`[sync:superbdatafy] Balance: GHS ${balance}`);
          }
        }
      } catch (err) {
        console.error("[sync:superbdatafy] Balance fetch error:", err);
      }
    } else if (handlerType === "spendless") {
      console.log(`Syncing Spendless provider: ${provider.name}`);

      const cleanBase = baseUrl.trim().replace(/\/+$/, "");
      const spendlessHeaders = { "X-API-Key": apiKey, "Accept": "application/json" };

      // 1. Sync Packages — try /packages and /data-packages
      const packageUrls = [
        `${cleanBase}/packages`,
        `${cleanBase}/data-packages`,
        `${cleanBase}/api/packages`,
        `${cleanBase}/api/data-packages`,
      ];

      const networkKeyToDb: Record<string, string> = {
        YELLO: "MTN",
        MTN: "MTN",
        TELECEL: "Telecel",
        AT_PREMIUM: "AirtelTigo",
        AT_BIGTIME: "AirtelTigo",
      };

      let pkgRes;
      for (const url of packageUrls) {
        console.log(`[sync:spendless] Trying package URL: ${url}`);
        const r = await fetch(url, { headers: spendlessHeaders });
        if (r.ok) { pkgRes = r; break; }
      }

      if (pkgRes) {
        const result = await pkgRes.json();
        const allPackages = [];
        // Handle nested-by-network object or flat array
        const rawData = result.data || result.packages || result;

        if (Array.isArray(rawData)) {
          for (const pkg of rawData) {
            const netKey = String(pkg.network || pkg.networkKey || "").toUpperCase();
            const dbNetwork = networkKeyToDb[netKey] || netKey;
            const capacityGb = Number(pkg.capacity || (pkg.sizeInMB ? pkg.sizeInMB / 1024 : 0));
            allPackages.push({
              provider_id: provider.id,
              network: dbNetwork,
              package_name: pkg.name || pkg.package_name || (capacityGb >= 1 ? `${capacityGb}GB` : `${(capacityGb * 1024).toFixed(0)}MB`),
              capacity_gb: capacityGb,
              cost_price: Number(pkg.price || pkg.amount || 0),
              external_id: String(pkg.id || pkg.planId || `${dbNetwork}_${capacityGb}`),
              raw_data: pkg,
              is_active: true,
            });
          }
        } else if (rawData && typeof rawData === "object") {
          for (const [netKey, pkgs] of Object.entries(rawData)) {
            if (!Array.isArray(pkgs)) continue;
            const dbNetwork = networkKeyToDb[netKey.toUpperCase()] || netKey;
            for (const pkg of pkgs as any[]) {
              const capacityGb = Number(pkg.capacity || (pkg.sizeInMB ? pkg.sizeInMB / 1024 : 0));
              allPackages.push({
                provider_id: provider.id,
                network: dbNetwork,
                package_name: pkg.name || pkg.package_name || (capacityGb >= 1 ? `${capacityGb}GB` : `${(capacityGb * 1024).toFixed(0)}MB`),
                capacity_gb: capacityGb,
                cost_price: Number(pkg.price || pkg.amount || 0),
                external_id: String(pkg.id || pkg.planId || `${dbNetwork}_${capacityGb}`),
                raw_data: pkg,
                is_active: true,
              });
            }
          }
        }

        if (allPackages.length > 0) {
          const { error: upsertError } = await supabaseAdmin
            .from("provider_packages")
            .upsert(allPackages, { onConflict: "provider_id,network,package_name" });
          if (upsertError) console.error("[sync:spendless] Package upsert error:", upsertError);
          packagesSynced = allPackages.length;
          console.log(`[sync:spendless] Synced ${packagesSynced} packages`);
        } else {
          console.warn("[sync:spendless] No packages parsed from response");
        }
      } else {
        console.warn("[sync:spendless] Could not fetch packages from any URL");
      }

      // 2. Sync Balance
      const balanceUrls = [
        `${cleanBase}/balance`,
        `${cleanBase}/api/balance`,
      ];

      for (const url of balanceUrls) {
        console.log(`[sync:spendless] Trying balance URL: ${url}`);
        const bRes = await fetch(url, { headers: spendlessHeaders });
        if (bRes.ok) {
          const bResult = await bRes.json();
          const rawBal = bResult.data?.balance ?? bResult.data?.rawBalance ?? bResult.balance;
          if (rawBal !== undefined) {
            balance = typeof rawBal === "string" ? parseFloat(rawBal.replace(/[^\d.]/g, "")) : Number(rawBal);
            console.log(`[sync:spendless] Balance: GHS ${balance}`);
            break;
          }
        }
      }
    } else if (handlerType === "xcel") {
      console.log(`Syncing XCEL provider: ${provider.name}`);
      const merchantId = String(provider.settings?.merchant_id || "");

      // 1. Fetch Products
      const productsUrl = `${baseUrl}/partners/vas/products?country=GH`;
      console.log(`[sync:xcel] Fetching products from: ${productsUrl}`);
      const productsRes = await fetch(productsUrl, {
        headers: {
          "x-api-key": apiKey,
          "x-merchant-id": merchantId,
          "Accept": "application/json"
        }
      });

      if (productsRes.ok) {
        const result = await productsRes.json();
        const products = result.data || [];
        const allPackages = [];

        const networkMap: Record<string, string> = {
          MTN: "MTN",
          TELECEL: "Telecel",
          VODAFONE: "Telecel",
          AIRTELTIGO: "AirtelTigo",
          AT: "AirtelTigo"
        };

        const parseCapacity = (packageSize: string): number => {
          if (!packageSize) return 0;
          const match = packageSize.toString().replace(/\s+/g, "").toLowerCase().match(/(\d+(?:\.\d+)?)\s*(gb|mb)/);
          if (match) {
            const val = parseFloat(match[1]);
            const unit = match[2];
            return unit === "gb" ? val : val / 1024;
          }
          const fallbackMatch = packageSize.toString().replace(/\s+/g, "").match(/(\d+(?:\.\d+)?)/);
          return fallbackMatch ? parseFloat(fallbackMatch[1]) : 0;
        };

        for (const prod of products) {
          const rawNet = String(prod.provider || "MTN").toUpperCase();
          const dbNetwork = networkMap[rawNet] || prod.provider || "MTN";
          const capacityGb = parseCapacity(prod.name);

          allPackages.push({
            provider_id: provider.id,
            network: dbNetwork,
            package_name: prod.name,
            capacity_gb: capacityGb,
            cost_price: 0,
            external_id: prod.productId,
            raw_data: prod,
            is_active: true
          });
        }

        if (allPackages.length > 0) {
          const { error: upsertError } = await supabaseAdmin
            .from("provider_packages")
            .upsert(allPackages, { onConflict: "provider_id,network,package_name" });
          if (upsertError) console.error("[sync:xcel] Package upsert error:", upsertError);
          packagesSynced = allPackages.length;
          console.log(`[sync:xcel] Synced ${packagesSynced} products/packages`);
        }
      } else {
        const errorText = await productsRes.text().catch(() => "");
        console.error(`[sync:xcel] Failed to fetch products (HTTP ${productsRes.status}):`, errorText);
        throw new Error(`XCEL API products fetch failed: HTTP ${productsRes.status}`);
      }

      balance = provider.balance || 0;
    } else if (handlerType === "qhowmenzconsult") {
      console.log(`Syncing QHowMenzConsult provider: ${provider.name}`);

      const cleanBase = baseUrl.trim().replace(/\/+$/, "");

      // 1. Sync Packages
      const productsUrl = `${cleanBase}/products`;
      console.log(`[sync:qhowmenzconsult] Fetching products from: ${productsUrl}`);
      const res = await fetch(productsUrl, {
        headers: { "X-API-Key": apiKey, "Accept": "application/json" }
      });

      if (res.ok) {
        const result = await res.json();
        const rawData = result.products || result.data || result;
        if (rawData && (Array.isArray(rawData) || typeof rawData === "object")) {
          const allPackages = [];
          const items = Array.isArray(rawData) ? rawData : Object.values(rawData).flat();

          const parseCapacity = (packageSize: string): number => {
            if (!packageSize) return 0;
            const match = packageSize.toString().replace(/\s+/g, "").toLowerCase().match(/(\d+(?:\.\d+)?)\s*(gb|mb)/);
            if (match) {
              const val = parseFloat(match[1]);
              const unit = match[2];
              return unit === "gb" ? val : val / 1024;
            }
            const fallbackMatch = packageSize.toString().replace(/\s+/g, "").match(/(\d+(?:\.\d+)?)/);
            return fallbackMatch ? parseFloat(fallbackMatch[1]) : 0;
          };

          for (const pkg of items) {
            if (!pkg) continue;

            const rawNet = String(pkg.network || pkg.networkKey || pkg.provider || "MTN").toUpperCase();
            let dbNetwork = "MTN";
            if (rawNet.includes("MTN") || rawNet === "YELLO") dbNetwork = "MTN";
            else if (rawNet.includes("TELECEL") || rawNet.includes("VODA")) dbNetwork = "Telecel";
            else if (rawNet.includes("AIRTEL") || rawNet.includes("TIGO") || rawNet === "AT") dbNetwork = "AirtelTigo";
            else dbNetwork = pkg.network || "MTN";

            const capacityStr = pkg.name || pkg.package_name || pkg.capacity || "";
            const capacityGb = Number(pkg.capacity_gb || pkg.size || parseCapacity(capacityStr));

            allPackages.push({
              provider_id: provider.id,
              network: dbNetwork,
              package_name: capacityStr || `${capacityGb}GB`,
              capacity_gb: capacityGb,
              cost_price: Number(pkg.price || pkg.amount || pkg.cost || 0),
              external_id: String(pkg.id || pkg.product_id || pkg.package_id || pkg.external_id),
              raw_data: pkg,
              is_active: true
            });
          }

          if (allPackages.length > 0) {
            const { error: upsertError } = await supabaseAdmin
              .from("provider_packages")
              .upsert(allPackages, { onConflict: "provider_id,network,package_name" });
            if (upsertError) console.error("[sync:qhowmenzconsult] Package upsert error:", upsertError);
            packagesSynced = allPackages.length;
            console.log(`[sync:qhowmenzconsult] Synced ${packagesSynced} packages`);
          }
        }
      } else {
        const errorText = await res.text().catch(() => "");
        console.error(`[sync:qhowmenzconsult] Failed to fetch products (HTTP ${res.status}):`, errorText);
      }

      // 2. Sync Balance
      const balanceUrl = `${cleanBase}/balance`;
      console.log(`[sync:qhowmenzconsult] Fetching balance from: ${balanceUrl}`);
      const balanceRes = await fetch(balanceUrl, {
        headers: { "X-API-Key": apiKey, "Accept": "application/json" }
      });

      if (balanceRes.ok) {
        const bResult = await balanceRes.json();
        const rawBal = bResult.balance ?? bResult.data?.balance ?? bResult.wallet_balance;
        if (rawBal !== undefined) {
          balance = typeof rawBal === "string" ? parseFloat(rawBal.replace(/[^\d.]/g, "")) : Number(rawBal);
          console.log(`[sync:qhowmenzconsult] Balance: GHS ${balance}`);
        }
      } else {
        console.warn(`[sync:qhowmenzconsult] Balance fetch failed: ${balanceRes.status}`);
      }
    } else if (handlerType === "skdataplug") {
      console.log(`Syncing SKPlug provider: ${provider.name}`);

      const bundlesUrl = `${baseUrl}/bundles/`;
      console.log(`[sync:skdataplug] Fetching bundles from: ${bundlesUrl}`);
      const bundlesRes = await fetch(bundlesUrl, {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Accept": "application/json"
        }
      });

      if (bundlesRes.ok) {
        const bundles = await bundlesRes.json();
        const allPackages = [];

        const networkMap: Record<string, string> = {
          MTN: "MTN",
          TELECEL: "Telecel",
          AT_EXPIRY: "AirtelTigo",
          AT_NOEXPIRY: "AirtelTigo"
        };

        for (const bundle of bundles) {
          if (!bundle) continue;
          
          const rawNet = String(bundle.network).toUpperCase();
          const dbNetwork = networkMap[rawNet] || rawNet;
          
          let pkgName = `${bundle.gb_size}GB`;
          if (rawNet === "AT_EXPIRY") {
            pkgName = `${bundle.gb_size}GB Expiry`;
          }

          allPackages.push({
            provider_id: provider.id,
            network: dbNetwork,
            package_name: pkgName,
            capacity_gb: Number(bundle.gb_size),
            cost_price: 0,
            external_id: String(bundle.id),
            raw_data: bundle,
            is_active: true
          });
        }

        if (allPackages.length > 0) {
          const { error: upsertError } = await supabaseAdmin
            .from("provider_packages")
            .upsert(allPackages, { onConflict: "provider_id,network,package_name" });
          if (upsertError) console.error("[sync:skdataplug] Package upsert error:", upsertError);
          packagesSynced = allPackages.length;
          console.log(`[sync:skdataplug] Synced ${packagesSynced} packages`);
        }
      } else {
        const errText = await bundlesRes.text().catch(() => "");
        console.error(`[sync:skdataplug] Bundles fetch failed (HTTP ${bundlesRes.status}):`, errText);
        throw new Error(`SKPlug bundles fetch failed: HTTP ${bundlesRes.status}`);
      }

      balance = provider.balance || 0;
    } else if (handlerType === "korba") {
      console.log(`Syncing Korba provider: ${provider.name}`);

      const KORBA_CLIENT_ID = Deno.env.get("KORBA_CLIENT_ID") || "2419";
      const KORBA_CLIENT_KEY = Deno.env.get("KORBA_CLIENT_KEY") || "";
      const KORBA_SECRET_KEY = Deno.env.get("KORBA_SECRET_KEY") || "";

      if (!KORBA_CLIENT_KEY || !KORBA_SECRET_KEY) {
        throw new Error("Korba credentials not configured in edge functions.");
      }

      // Helper to query Korba API via DB proxy
      const queryKorba = async (endpoint: string, payload: any) => {
        const sortedKeys = Object.keys(payload).sort();
        const messageParts = [];
        for (const key of sortedKeys) {
          messageParts.push(`${key}=${payload[key]}`);
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

        const targetUrl = `${baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
        console.log(`[sync:korba] Calling: ${targetUrl}`);

        const res = await fetchViaDb(supabaseAdmin, targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `HMAC ${KORBA_CLIENT_KEY}:${signatureHex}`,
          },
          body: JSON.stringify(payload),
          disableFallback: true,
        }, 25);

        const resText = await res.text();
        if (!res.ok || resText.includes("Gateway Timeout") || resText.includes("canceling statement")) {
          throw new Error(`Korba API request failed: ${resText || `HTTP ${res.status}`}`);
        }

        try {
          return JSON.parse(resText);
        } catch {
          throw new Error(`Korba API returned non-JSON: ${resText}`);
        }
      };

      // 1. Sync Balance
      try {
        const balancePayload = { client_id: parseInt(KORBA_CLIENT_ID) || 2419 };
        const balanceData = await queryKorba("get_ova_balance/", balancePayload);
        if (balanceData && balanceData.ova_balance !== undefined) {
          balance = Number(balanceData.ova_balance);
          console.log(`[sync:korba] Synced Balance: GHS ${balance}`);
        } else {
          console.error("[sync:korba] Balance response missing ova_balance:", balanceData);
        }
      } catch (err: any) {
        console.error("[sync:korba] Balance sync failed:", err.message || err);
      }

      // 2. Sync Packages (MTN, Telecel, AirtelTigo)
      const allPackages = [];
      const packageEndpoints = [
        { path: "get_mtndata_product_id/", network: "MTN" },
        { path: "get_vodafonedata_product_id/", network: "Telecel" },
        { path: "get_airteltigodata_product_id/", network: "AirtelTigo" }
      ];

      const parseCapacity = (packageSize: string): number => {
        if (!packageSize) return 0;
        const match = packageSize.toString().replace(/\s+/g, "").toLowerCase().match(/(\d+(?:\.\d+)?)\s*(gb|mb)/);
        if (match) {
          const val = parseFloat(match[1]);
          const unit = match[2];
          return unit === "gb" ? val : val / 1024;
        }
        const fallbackMatch = packageSize.toString().replace(/\s+/g, "").match(/(\d+(?:\.\d+)?)/);
        return fallbackMatch ? parseFloat(fallbackMatch[1]) : 0;
      };

      for (const endpoint of packageEndpoints) {
        try {
          const payload = { client_id: parseInt(KORBA_CLIENT_ID) || 2419 };
          const responseData = await queryKorba(endpoint.path, payload);
          if (responseData && (responseData.success || responseData.error_code === null)) {
            const bundles = responseData.bundles || [];
            for (const item of bundles) {
              if (item.bundles && Array.isArray(item.bundles)) {
                // MTN categories
                for (const subBundle of item.bundles) {
                  const capacityGb = parseCapacity(subBundle.name || subBundle.bundle_size || "");
                  allPackages.push({
                    provider_id: provider.id,
                    network: endpoint.network,
                    package_name: subBundle.name || subBundle.bundle_size || `${capacityGb}GB`,
                    capacity_gb: capacityGb,
                    cost_price: Number(subBundle.amount || 0),
                    external_id: String(subBundle.product_id || subBundle.bundle_id),
                    raw_data: { ...subBundle, category: item.name },
                    is_active: true
                  });
                }
              } else {
                // Telecel or AirtelTigo flat bundles
                const name = item.name || item.bundle_size || "";
                const capacityGb = parseCapacity(name);
                allPackages.push({
                  provider_id: provider.id,
                  network: endpoint.network,
                  package_name: name || `${capacityGb}GB`,
                  capacity_gb: capacityGb,
                  cost_price: Number(item.amount || 0),
                  external_id: String(item.product_id || item.bundle_id),
                  raw_data: item,
                  is_active: true
                });
              }
            }
          } else {
            console.error(`[sync:korba] Failed response for ${endpoint.network}:`, responseData);
          }
        } catch (err: any) {
          console.error(`[sync:korba] Error syncing packages for ${endpoint.network}:`, err.message || err);
        }
      }

      // Add Airtime fallback packages if needed (like in system-payout-v1)
      const airtimePackages = [
        {
          provider_id: provider.id,
          network: "MTN",
          package_name: "MTN Airtime",
          capacity_gb: 0,
          cost_price: 0,
          external_id: "MTN_AIRTIME",
          raw_data: { category: "Airtime" },
          is_active: true
        },
        {
          provider_id: provider.id,
          network: "Telecel",
          package_name: "Telecel Airtime",
          capacity_gb: 0,
          cost_price: 0,
          external_id: "TELECEL_AIRTIME",
          raw_data: { category: "Airtime" },
          is_active: true
        },
        {
          provider_id: provider.id,
          network: "AirtelTigo",
          package_name: "AirtelTigo Airtime",
          capacity_gb: 0,
          cost_price: 0,
          external_id: "AIRTELTIGO_AIRTIME",
          raw_data: { category: "Airtime" },
          is_active: true
        }
      ];

      allPackages.push(...airtimePackages);

      if (allPackages.length > airtimePackages.length) {
        const { error: upsertError } = await supabaseAdmin
          .from("provider_packages")
          .upsert(allPackages, { onConflict: "provider_id,network,package_name" });
        if (upsertError) {
          console.error("[sync:korba] Package upsert error:", upsertError);
          throw upsertError;
        }
        packagesSynced = allPackages.length;
        console.log(`[sync:korba] Synced ${packagesSynced} packages`);
      } else {
        console.warn("[sync:korba] No packages fetched from Korba API (only added airtime fallback packages).");
      }
    } else {
      throw new Error(`Sync not implemented for handler type: ${handlerType}`);
    }

    // Update last sync time
    await supabaseAdmin
      .from("providers")
      .update({ 
        last_synced_at: new Date().toISOString(),
        balance: balance
      })
      .eq("id", provider.id);

    return new Response(JSON.stringify({ 
      success: true, 
      packages_synced: packagesSynced,
      balance: balance 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("[sync-provider-data] Error:", error.message);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
