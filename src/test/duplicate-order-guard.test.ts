import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_DUPLICATE_WINDOW_MS,
  DELIVERED_ORDER_STATUSES,
  DUPLICATE_PROCESSING_ERROR_CODE,
  IN_FLIGHT_ORDER_STATUSES,
  TERMINAL_ORDER_STATUSES,
  checkActiveProcessingDuplicate,
  findBlockingProcessingOrder,
  formatDuplicateProcessingMessage,
  getPhoneLookupVariants,
  isDeliveredOrTerminalStatus,
  isInFlightOrderStatus,
  normalizeDuplicatePhone,
} from "../../supabase/functions/_shared/duplicate_order_guard";

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Duplicate Purchase Rule (allow delivered, block & inform processing)", () => {
  const now = Date.parse("2026-11-26T10:00:00.000Z");
  const fiveMinsAgo = new Date(now - 5 * 60 * 1000).toISOString();
  const fortyFiveMinsAgo = new Date(now - 45 * 60 * 1000).toISOString();
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();

  it("normalizes Ghana phone numbers and builds lookup variants", () => {
    expect(normalizeDuplicatePhone("054 123 4567")).toBe("0541234567");
    expect(normalizeDuplicatePhone("233541234567")).toBe("0541234567");
    expect(normalizeDuplicatePhone("+233541234567")).toBe("0541234567");
    expect(normalizeDuplicatePhone("541234567")).toBe("0541234567");

    const variants = getPhoneLookupVariants("+233541234567");
    expect(variants).toContain("0541234567");
    expect(variants).toContain("233541234567");
    expect(variants).toContain("+233541234567");
    expect(variants).toContain("541234567");
  });

  it("blocks and informs for every in-flight / processing status", () => {
    for (const status of IN_FLIGHT_ORDER_STATUSES) {
      expect(isInFlightOrderStatus(status)).toBe(true);
      const blocking = findBlockingProcessingOrder(
        [
          {
            id: "a1b2c3d4-1111-2222-3333-444455556666",
            status,
            network: "MTN",
            package_size: "5GB",
            customer_phone: "233541234567",
            order_type: "data",
            created_at: fiveMinsAgo,
          },
        ],
        {
          phone: "0541234567",
          network: "MTN",
          packageSize: "5 GB",
          orderType: "data",
          nowMs: now,
        },
      );

      expect(blocking).not.toBeNull();
      const msg = formatDuplicateProcessingMessage(blocking!);
      expect(msg).toContain("You already have a processing MTN 5GB order for 0541234567 (Order #A1B2C3D4)");
      expect(msg).toContain("Please wait for it to be delivered before placing another order.");
    }
  });

  it("blocks processing orders within the 60-minute active window (e.g. 45 mins ago)", () => {
    const blocking = findBlockingProcessingOrder(
      [
        {
          id: "deadbeef-0000-0000-0000-000000000000",
          status: "processing",
          network: "Telecel",
          package_size: "10GB",
          customer_phone: "0201112222",
          order_type: "data",
          created_at: fortyFiveMinsAgo,
        },
      ],
      {
        phone: "+233201112222",
        network: "Telecel",
        packageSize: "10GB",
        orderType: "data",
        nowMs: now,
      },
    );
    expect(blocking?.id).toBe("deadbeef-0000-0000-0000-000000000000");
  });

  it("ALLOWS duplicate purchase for every delivered status (fulfilled, completed, delivered)", () => {
    for (const status of DELIVERED_ORDER_STATUSES) {
      expect(isInFlightOrderStatus(status)).toBe(false);
      expect(isDeliveredOrTerminalStatus(status)).toBe(true);
      const blocking = findBlockingProcessingOrder(
        [
          {
            id: "11111111-1111-1111-1111-111111111111",
            status,
            network: "MTN",
            package_size: "5GB",
            customer_phone: "0541234567",
            order_type: "data",
            created_at: fiveMinsAgo,
          },
        ],
        {
          phone: "0541234567",
          network: "MTN",
          packageSize: "5GB",
          orderType: "data",
          nowMs: now,
        },
      );
      expect(blocking).toBeNull();
    }
  });

  it("ALLOWS duplicate purchase for all terminal / failed / refunded / cancelled / awaiting_payment statuses", () => {
    for (const status of TERMINAL_ORDER_STATUSES) {
      expect(isInFlightOrderStatus(status)).toBe(false);
      expect(isDeliveredOrTerminalStatus(status)).toBe(true);
      const blocking = findBlockingProcessingOrder(
        [
          {
            id: "22222222-2222-2222-2222-222222222222",
            status,
            network: "MTN",
            package_size: "5GB",
            customer_phone: "0541234567",
            order_type: "data",
            created_at: fiveMinsAgo,
          },
        ],
        {
          phone: "0541234567",
          network: "MTN",
          packageSize: "5GB",
          orderType: "data",
          nowMs: now,
        },
      );
      expect(blocking).toBeNull();
    }
  });

  it("ALLOWS purchase when previous processing order is older than the active window or for a different package/phone", () => {
    const orders = [
      {
        id: "old-order",
        status: "processing",
        network: "MTN",
        package_size: "5GB",
        customer_phone: "0541234567",
        order_type: "data",
        created_at: twoHoursAgo,
      },
      {
        id: "diff-pkg",
        status: "processing",
        network: "MTN",
        package_size: "2GB",
        customer_phone: "0541234567",
        order_type: "data",
        created_at: fiveMinsAgo,
      },
      {
        id: "diff-phone",
        status: "processing",
        network: "MTN",
        package_size: "5GB",
        customer_phone: "0559998888",
        order_type: "data",
        created_at: fiveMinsAgo,
      },
    ];

    const blocking = findBlockingProcessingOrder(orders, {
      phone: "0541234567",
      network: "MTN",
      packageSize: "5GB",
      orderType: "data",
      windowMs: ACTIVE_DUPLICATE_WINDOW_MS,
      nowMs: now,
    });
    expect(blocking).toBeNull();
  });

  it("checkActiveProcessingDuplicate queries in-flight statuses and returns structured 409 info", async () => {
    let queriedStatuses: string[] = [];
    const mockSupabase = {
      from: () => ({
        select: () => ({
          in: (col: string, vals: string[]) => {
            if (col === "status") queriedStatuses = vals;
            return {
              in: (col2: string, vals2: string[]) => {
                if (col2 === "status") queriedStatuses = vals2;
                return {
                  gte: () => ({
                    order: () => ({
                      limit: async () => ({
                        data: [
                          {
                            id: "99aabbcc-1234-5678-9012-abcdefabcdef",
                            status: "processing",
                            network: "MTN",
                            package_size: "5GB",
                            customer_phone: "0541234567",
                            order_type: "data",
                            created_at: fiveMinsAgo,
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                };
              },
            };
          },
        }),
      }),
    };

    const res = await checkActiveProcessingDuplicate(mockSupabase, {
      phone: "233541234567",
      network: "MTN",
      packageSize: "5GB",
      orderType: "data",
      nowMs: now,
    });

    expect(queriedStatuses).toEqual(["pending", "paid", "processing", "queued", "initiated"]);
    expect(res.blocked).toBe(true);
    expect(res.code).toBe(DUPLICATE_PROCESSING_ERROR_CODE);
    expect(res.message).toContain("Order #99AABBCC");
    expect(res.message).toContain("0541234567");
  });

  it("wires duplicate-order guard across all backend purchase functions and frontend checkout UIs", () => {
    const initPayment = read("supabase/functions/initialize-payment/index.ts");
    const walletBuy = read("supabase/functions/wallet-buy-data/index.ts");
    const devApi = read("supabase/functions/developer-api/index.ts");
    const momoCheckout = read("src/components/PaystackMomoCheckout.tsx");
    const buyData = read("src/pages/BuyData.tsx");
    const dashBuy = read("src/pages/DashboardBuyDataNetwork.tsx");
    const agentStore = read("src/pages/AgentStore.tsx");

    expect(initPayment).toContain("checkActiveProcessingDuplicate");
    expect(initPayment).toContain("DUPLICATE_PROCESSING_ERROR_CODE");
    expect(walletBuy).toContain("checkActiveProcessingDuplicate");
    expect(walletBuy).toContain("DUPLICATE_PROCESSING_ERROR_CODE");
    expect(devApi).toContain("checkActiveProcessingDuplicate");
    expect(devApi).toContain("DUPLICATE_PROCESSING_ERROR_CODE");

    expect(momoCheckout).toContain("Order Already Processing");
    expect(buyData).toContain("duplicateOrderNotice");
    expect(dashBuy).toContain("duplicateOrderNotice");
    expect(agentStore).toContain("duplicateOrderNotice");
  });
});
