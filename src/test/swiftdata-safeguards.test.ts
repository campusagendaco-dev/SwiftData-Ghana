import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db_proxy before importing Deno edge modules that reference it
const { mockFetchViaDb } = vi.hoisted(() => ({
  mockFetchViaDb: vi.fn(),
}));

vi.mock("../../supabase/functions/_shared/db_proxy.ts", () => ({
  fetchViaDb: mockFetchViaDb,
}));

// Set up Mock Deno.env in global scope for Edge Function shared utilities
const envStore = new Map<string, string>();
(globalThis as any).Deno = {
  env: {
    get: (key: string) => envStore.get(key),
    set: (key: string, value: string) => envStore.set(key, value),
    delete: (key: string) => envStore.delete(key),
  },
};

import { resolveProvidersForOrder } from "../../supabase/functions/_shared/providers.ts";
import { KorbaAdapter } from "../../supabase/functions/_shared/providers/korba.ts";
import { getFirstEnv } from "../../supabase/functions/_shared/providers/utils.ts";
import { generateSlug } from "@/lib/data";

// Helper to create a mock Supabase Admin client for provider routing tests
function createMockSupabase(providers: any[], korbaPackages: any[] = []) {
  const korbaProvider = providers.find((p) => p.handler_type === "korba" && p.is_active) || null;

  return {
    from: (table: string) => {
      if (table === "providers") {
        let filtered = [...providers];
        const chain: any = {
          select: () => chain,
          eq: (col: string, val: any) => {
            filtered = filtered.filter((row) => row[col] === val);
            return chain;
          },
          in: (col: string, vals: any[]) => {
            filtered = filtered.filter((row) => vals.includes(row[col]));
            return chain;
          },
          or: (expr: string) => {
            if (expr.includes("provider_type.eq.data")) {
              filtered = filtered.filter(
                (row) => row.provider_type === "data" || row.handler_type === "korba"
              );
            } else if (expr.includes("provider_type.eq.airtime")) {
              filtered = filtered.filter(
                (row) => row.provider_type === "airtime" || row.handler_type === "korba"
              );
            } else if (expr.includes("datamart")) {
              filtered = filtered.filter(
                (row) =>
                  row.handler_type === "datamart" ||
                  String(row.name || "").toLowerCase().includes("datamart")
              );
            }
            return chain;
          },
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({
            data: filtered[0] ?? (korbaProvider && filtered.includes(korbaProvider) ? korbaProvider : null),
            error: null,
          }),
          then: (resolve: any) => resolve({ data: filtered, error: null }),
        };
        return chain;
      }

      if (table === "provider_packages") {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          then: (resolve: any) => resolve({ data: korbaPackages, error: null }),
        };
        return chain;
      }

      const emptyChain: any = {
        select: () => emptyChain,
        eq: () => emptyChain,
        limit: () => emptyChain,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      return emptyChain;
    },
  };
}

// Helper reproducing Korba _disb candidate ID generation invariant
function buildKorbaCandidateIds(providerOrderId?: string | null, reference?: string | null): string[] {
  const isSentinel = (val: string) => !val || val === "timeout" || val === "failed_api_call";
  const cleanRef = String(reference || "").trim().replace(/_disb$/, "");
  const rawProvId = String(providerOrderId || "").trim();
  const cleanProvId = isSentinel(rawProvId) ? "" : rawProvId.replace(/_disb$/, "");
  return Array.from(
    new Set(
      [
        !isSentinel(cleanRef) ? `${cleanRef}_disb` : "",
        !isSentinel(cleanRef) ? cleanRef : "",
        cleanProvId ? `${cleanProvId}_disb` : "",
        cleanProvId,
      ].filter(Boolean)
    )
  );
}

// Helper reproducing credential resolution priority (Deno.env -> DB provider fallback)
function resolveProviderApiKey(
  envKeys: string[],
  providerRow?: { api_key?: string | null; settings?: Record<string, any> | null } | null
): string {
  const fromEnv = getFirstEnv(...envKeys);
  if (fromEnv) return fromEnv;
  return (
    providerRow?.api_key?.trim() ||
    providerRow?.settings?.client_key?.trim() ||
    ""
  );
}

// Helper reproducing Storefront Agent vs Direct Reseller onboarding store mapping
interface AgentProfileInput {
  user_id: string;
  full_name: string;
  is_agent: boolean;
  store_name: string | null;
}

interface ResellerStoreRow {
  user_id: string;
  store_name: string;
  slug: string;
  store_primary_color: string;
}

function mapProfilesToStorefrontRows(profiles: AgentProfileInput[]): ResellerStoreRow[] {
  const stores: ResellerStoreRow[] = [];
  for (const profile of profiles) {
    const trimmedStoreName = profile.store_name?.trim() || "";
    if (profile.is_agent && trimmedStoreName.length > 0) {
      const slug = generateSlug(trimmedStoreName);
      if (slug) {
        stores.push({
          user_id: profile.user_id,
          store_name: trimmedStoreName,
          slug,
          store_primary_color: "#fbbf24",
        });
      }
    }
  }
  return stores;
}

describe("SwiftData Critical Business & Security Invariants", () => {
  const baseProviders = [
    {
      id: "prov-datahub",
      name: "DataHub",
      handler_type: "datahub",
      provider_type: "data",
      priority: 1,
      is_active: true,
      api_key: "db-datahub-key",
      base_url: "https://user.datahubgh.com/api/external",
    },
    {
      id: "prov-datamart",
      name: "DataMart",
      handler_type: "datamart",
      provider_type: "data",
      priority: 2,
      is_active: true,
      api_key: "db-datamart-key",
      base_url: "https://api.datamartgh.shop",
    },
    {
      id: "prov-korba",
      name: "Korba",
      handler_type: "korba",
      provider_type: "airtime",
      priority: 1,
      is_active: true,
      api_key: "db-korba-key",
      api_secret: "db-korba-secret",
      base_url: "https://xchange.korba365.com/api/v1.0",
      settings: { client_id: "2419" },
    },
  ];

  beforeEach(() => {
    envStore.clear();
    mockFetchViaDb.mockReset();
  });

  describe("1. SME Bundle Korba Exclusion", () => {
    it("excludes MTN, Telecel, and AirtelTigo/AT SME data bundles from routing to Korba", async () => {
      const supabaseAdmin = createMockSupabase(baseProviders);

      const smeOrders = [
        { id: "ord-mtn-1", order_type: "data", network: "MTN", package_size: "5GB" },
        { id: "ord-telecel-1", order_type: "data", network: "Telecel", package_size: "10GB" },
        { id: "ord-at-1", order_type: "data", network: "AirtelTigo", package_size: "3GB" },
        { id: "ord-at-short", order_type: "sme", network: "AT", package_size: "2GB" },
      ];

      for (const order of smeOrders) {
        const resolved = await resolveProvidersForOrder(supabaseAdmin, order);
        expect(resolved.length).toBeGreaterThan(0);
        expect(resolved.some((p) => p.handler_type === "korba" || p.name === "Korba")).toBe(false);
        expect(resolved.map((p) => p.handler_type)).toContain("datahub");
      }
    });

    it("excludes SME data bundles from Korba even if payment_method === 'korba' or metadata passes is_korba: true", async () => {
      const supabaseAdmin = createMockSupabase(baseProviders);

      const spoofedOrders = [
        {
          id: "ord-spoof-1",
          order_type: "data",
          network: "MTN",
          package_size: "5GB",
          payment_method: "korba",
          metadata: { is_korba: true, category: "sme", provider_type: "korba" },
        },
        {
          id: "ord-spoof-2",
          order_type: "data",
          network: "Telecel",
          package_size: "15GB",
          payment_method: "korba",
          provider_id: "prov-korba",
          metadata: { is_korba: true, package_category: "affordable" },
        },
        {
          id: "ord-spoof-3",
          order_type: "data",
          network: "AirtelTigo",
          package_size: "4GB",
          payment_method: "korba",
          metadata: { is_korba: "true", category: "sme_bundle" },
        },
      ];

      for (const order of spoofedOrders) {
        const resolved = await resolveProvidersForOrder(supabaseAdmin, order);
        expect(resolved.some((p) => p.handler_type === "korba" || p.name === "Korba")).toBe(false);
      }
    });

    it("allows Airtime and Utilities orders to route to Korba as primary provider", async () => {
      const supabaseAdmin = createMockSupabase(baseProviders);

      const airtimeOrder = {
        id: "ord-airtime-1",
        order_type: "airtime",
        network: "MTN",
        package_size: "AIRTIME",
        amount: 10,
      };
      const airtimeProviders = await resolveProvidersForOrder(supabaseAdmin, airtimeOrder);
      expect(airtimeProviders[0]?.handler_type).toBe("korba");

      const utilityOrder = {
        id: "ord-utility-1",
        order_type: "utility",
        network: "ECG",
        utility_provider: "ECG_PREPAID",
        amount: 50,
      };
      const utilityProviders = await resolveProvidersForOrder(supabaseAdmin, utilityOrder);
      expect(utilityProviders[0]?.handler_type).toBe("korba");
    });
  });

  describe("2. Korba _disb Transaction Status Candidate IDs & Status Codes", () => {
    it("generates deduplicated [${cleanId}_disb, ${cleanId}] candidate IDs whether input has _disb or not", () => {
      const fromPlain = buildKorbaCandidateIds("ord_abc123", "ord_abc123");
      expect(fromPlain).toEqual(["ord_abc123_disb", "ord_abc123"]);

      const fromDisb = buildKorbaCandidateIds("ord_abc123_disb", "ord_abc123_disb");
      expect(fromDisb).toEqual(["ord_abc123_disb", "ord_abc123"]);
      expect(fromDisb.some((id) => id.endsWith("_disb_disb"))).toBe(false);

      const withSentinel = buildKorbaCandidateIds("timeout", "ord_xyz789");
      expect(withSentinel).toEqual(["ord_xyz789_disb", "ord_xyz789"]);
    });

    it("recognizes both '000' and '0000' status codes in KorbaAdapter.checkStatus", async () => {
      envStore.set("KORBA_CLIENT_KEY", "test_client_key");
      envStore.set("KORBA_SECRET_KEY", "test_secret_key");

      const adapter = new KorbaAdapter();
      const korbaProvider = baseProviders[2];

      // 1. Test status code "000"
      mockFetchViaDb.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status_code: "000", message: "Transaction successful" }),
        headers: new Headers({ "content-type": "application/json" }),
      });

      const res000 = await adapter.checkStatus({}, korbaProvider, "tx_100", "tx_100");
      expect(res000.ok).toBe(true);
      expect(res000.status).toBe("delivered");
      expect(res000.id).toBe("tx_100_disb");

      // 2. Test status code "0000" on second candidate fallback (when first candidate is still processing)
      mockFetchViaDb
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ status: "PENDING", message: "Still processing" }),
          headers: new Headers({ "content-type": "application/json" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ code: "0000", message: "Delivered", prepaid_token: "1234-5678-9012" }),
          headers: new Headers({ "content-type": "application/json" }),
        });

      const res0000 = await adapter.checkStatus({}, korbaProvider, "tx_200_disb", "tx_200_disb");
      expect(res0000.ok).toBe(true);
      expect(res0000.status).toBe("delivered");
      expect(res0000.id).toBe("tx_200");
      expect(res0000.raw).toEqual({ prepaid_token: "1234-5678-9012" });
    });
  });

  describe("3. Environment Secrets Priority", () => {
    it("prioritizes Deno.env secrets over database provider.api_key values", () => {
      envStore.set("DATAHUB_API_KEY", "env-priority-secret-key");

      const resolved = resolveProviderApiKey(["DATAHUB_API_KEY"], {
        api_key: "db-fallback-key",
      });

      expect(resolved).toBe("env-priority-secret-key");
    });

    it("falls back to database provider.api_key only when Deno.env is unset or blank", () => {
      envStore.delete("DATAHUB_API_KEY");
      expect(
        resolveProviderApiKey(["DATAHUB_API_KEY"], { api_key: "db-fallback-key" })
      ).toBe("db-fallback-key");

      envStore.set("DATAHUB_API_KEY", "   ");
      expect(
        resolveProviderApiKey(["DATAHUB_API_KEY"], { api_key: "db-fallback-key" })
      ).toBe("db-fallback-key");
    });

    it("uses Deno.env KORBA_CLIENT_KEY in Authorization header before provider.api_key", async () => {
      envStore.set("KORBA_CLIENT_KEY", "env_korba_client_key");
      envStore.set("KORBA_SECRET_KEY", "env_korba_secret_key");

      mockFetchViaDb.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: "000", message: "OK" }),
        headers: new Headers({ "content-type": "application/json" }),
      });

      const adapter = new KorbaAdapter();
      await adapter.checkStatus(
        {},
        { api_key: "db_korba_client_key", api_secret: "db_korba_secret_key" },
        "ord_env_test",
        "ord_env_test"
      );

      expect(mockFetchViaDb).toHaveBeenCalledTimes(1);
      const callOptions = mockFetchViaDb.mock.calls[0][2];
      expect(callOptions.headers.Authorization).toMatch(/^HMAC env_korba_client_key:[a-f0-9]{64}$/);
    });
  });

  describe("4. Storefront vs Direct Reseller Routing", () => {
    it("maps storefront agents (is_agent = true and non-empty store_name) to 1 store config with a valid slug", () => {
      const storefrontAgent: AgentProfileInput = {
        user_id: "eba7b377-1111-2222-3333-444455556666",
        full_name: "Kwame Asante",
        is_agent: true,
        store_name: "Kwame's Data Hub!",
      };

      const rows = mapProfilesToStorefrontRows([storefrontAgent]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        user_id: "eba7b377-1111-2222-3333-444455556666",
        store_name: "Kwame's Data Hub!",
        slug: "kwames-data-hub",
        store_primary_color: "#fbbf24",
      });
      expect(rows[0].slug).toMatch(/^[a-z0-9-]+$/);
    });

    it("does not generate a storefront row for direct resellers (is_agent = true and store_name = null)", () => {
      const directResellers: AgentProfileInput[] = [
        {
          user_id: "ca6b5122-aaaa-bbbb-cccc-ddddeeeeffff",
          full_name: "Direct Reseller One",
          is_agent: true,
          store_name: null,
        },
        {
          user_id: "99887766-aaaa-bbbb-cccc-ddddeeeeffff",
          full_name: "Direct Reseller Whitespace",
          is_agent: true,
          store_name: "   ",
        },
      ];

      const rows = mapProfilesToStorefrontRows(directResellers);
      expect(rows).toHaveLength(0);
    });
  });
});
