import { describe, expect, it } from "vitest";
import {
  buildWebhookSignatureHeader,
  calculateCollectionAmounts,
  isAllowedClientIp,
  isAllowedRedirectUrl,
  isSafeGatewayWebhookUrl,
  isTimestampFresh,
  signGatewayRequest,
  timingSafeEqual,
  verifyGatewayRequestSignature,
} from "../../supabase/functions/_shared/gateway-security";

describe("Payment Gateway Security Helpers", () => {
  it("performs constant-time comparison accurately", () => {
    expect(timingSafeEqual("abcdef", "abcdef")).toBe(true);
    expect(timingSafeEqual("abcdef", "abcdeg")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("signs and verifies valid HMAC-SHA256 requests", async () => {
    const secret = "swft_whsec_test_secret_1234567890";
    const nowSec = 1_800_000_000;
    const timestamp = String(nowSec);
    const nonce = "nonce-12345678-abcd";
    const body = JSON.stringify({ amount: 50, client_reference: "ORD-1" });

    const sig = await signGatewayRequest(secret, timestamp, nonce, "POST", "/v1/initialize", body);
    const res = await verifyGatewayRequestSignature({
      secret,
      timestamp,
      nonce,
      method: "POST",
      path: "/v1/initialize",
      rawBody: body,
      providedSignature: sig,
      nowSec,
    });
    expect(res.valid).toBe(true);
  });

  it("rejects tampered body, wrong secret, expired timestamp, and short nonce", async () => {
    const secret = "swft_whsec_test_secret_1234567890";
    const nowSec = 1_800_000_000;
    const timestamp = String(nowSec);
    const nonce = "nonce-12345678-abcd";
    const body = JSON.stringify({ amount: 50 });

    const sig = await signGatewayRequest(secret, timestamp, nonce, "POST", "/v1/initialize", body);

    const tampered = await verifyGatewayRequestSignature({
      secret,
      timestamp,
      nonce,
      method: "POST",
      path: "/v1/initialize",
      rawBody: JSON.stringify({ amount: 500 }),
      providedSignature: sig,
      nowSec,
    });
    expect(tampered.valid).toBe(false);

    const wrongSecret = await verifyGatewayRequestSignature({
      secret: "swft_whsec_wrong",
      timestamp,
      nonce,
      method: "POST",
      path: "/v1/initialize",
      rawBody: body,
      providedSignature: sig,
      nowSec,
    });
    expect(wrongSecret.valid).toBe(false);

    const expired = await verifyGatewayRequestSignature({
      secret,
      timestamp: String(nowSec - 301),
      nonce,
      method: "POST",
      path: "/v1/initialize",
      rawBody: body,
      providedSignature: sig,
      nowSec,
    });
    expect(expired.valid).toBe(false);

    expect(isTimestampFresh(String(nowSec + 301), nowSec)).toBe(false);
    expect(isTimestampFresh(String(nowSec + 120), nowSec)).toBe(true);

    const shortNonce = await verifyGatewayRequestSignature({
      secret,
      timestamp,
      nonce: "short",
      method: "POST",
      path: "/v1/initialize",
      rawBody: body,
      providedSignature: sig,
      nowSec,
    });
    expect(shortNonce.valid).toBe(false);
  });

  it("enforces strict HTTPS domain allowlist for redirect URLs", () => {
    const allowed = ["myshop.com", "https://pay.partner.gh/"];
    expect(isAllowedRedirectUrl("https://myshop.com/checkout/done", allowed)).toBe(true);
    expect(isAllowedRedirectUrl("https://checkout.myshop.com/return", allowed)).toBe(true);
    expect(isAllowedRedirectUrl("https://pay.partner.gh/callback?ref=1", allowed)).toBe(true);

    // Attacks that must be blocked
    expect(isAllowedRedirectUrl("http://myshop.com/return", allowed)).toBe(false);
    expect(isAllowedRedirectUrl("https://evil-myshop.com/return", allowed)).toBe(false);
    expect(isAllowedRedirectUrl("https://myshop.com.evil.com/return", allowed)).toBe(false);
    expect(isAllowedRedirectUrl("https://user:pass@myshop.com/return", allowed)).toBe(false);
    expect(isAllowedRedirectUrl("https://localhost/return", allowed)).toBe(false);
    expect(isAllowedRedirectUrl("https://myshop.com/return", [])).toBe(false);
  });

  it("blocks SSRF and non-HTTPS webhook URLs", () => {
    expect(isSafeGatewayWebhookUrl("https://api.myshop.com/webhooks/swiftdata")).toBe(true);
    expect(isSafeGatewayWebhookUrl("http://api.myshop.com/webhooks")).toBe(false);
    expect(isSafeGatewayWebhookUrl("https://127.0.0.1/hook")).toBe(false);
    expect(isSafeGatewayWebhookUrl("https://localhost/hook")).toBe(false);
    expect(isSafeGatewayWebhookUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeGatewayWebhookUrl("https://10.0.0.5/hook")).toBe(false);
    expect(isSafeGatewayWebhookUrl("https://192.168.1.10/hook")).toBe(false);
    expect(isSafeGatewayWebhookUrl("https://api.myshop.com:8443/hook")).toBe(false);
    expect(isSafeGatewayWebhookUrl("https://user:pass@api.myshop.com/hook")).toBe(false);
  });

  it("enforces IP allowlist when configured", () => {
    expect(isAllowedClientIp("1.2.3.4", [])).toBe(true);
    expect(isAllowedClientIp("1.2.3.4", ["1.2.3.4", "5.6.7.8"])).toBe(true);
    expect(isAllowedClientIp("9.9.9.9", ["1.2.3.4"])).toBe(false);
    expect(isAllowedClientIp("", ["1.2.3.4"])).toBe(false);
  });

  it("computes customer-paid fee with GHS 100 cap and net settlement", () => {
    const standard = calculateCollectionAmounts({ baseAmount: 100, feePercent: 3, platformFeePercent: 0 });
    expect(standard).toEqual({
      baseAmount: 100,
      customerFee: 3,
      platformFee: 0,
      totalCharged: 103,
      netSettlement: 100,
    });

    const capped = calculateCollectionAmounts({ baseAmount: 5000, feePercent: 3, platformFeePercent: 0.5 });
    expect(capped).toEqual({
      baseAmount: 5000,
      customerFee: 100, // capped at GHS 100
      platformFee: 25,
      totalCharged: 5100,
      netSettlement: 4975,
    });
  });

  it("formats outbound webhook signature header with timestamp and v1 hex", async () => {
    const header = await buildWebhookSignatureHeader("swft_whsec_abc", '{"ok":true}', 1_800_000_000);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
  });
});
