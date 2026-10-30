# BundleZone REST API Integration Documentation

**Base URL**: `https://bundlezone.shop`  
**API Prefix**: `/api`  
**Latest Spec Revision**: October 2026

The BundleZone REST API enables automated telecom data fulfillment (`MTN_EXPRESS`, `Telecel`, `AT`), beneficiary verification, order placement (single & bulk), wallet balance queries, real-time status lookups, and asynchronous webhook callbacks.

---

## Network Guide: MTN Express (`MTN_EXPRESS`)

### Delivery & End-of-Day Refunds
- **No Beneficiary Verification Required**: `MTN_EXPRESS` orders are sent without a number-verification check. Valid orders are submitted directly for delivery after normal wallet and package checks.
- **Submission Does Not Guarantee Delivery**: BundleZone reviews failed orders and refunds their charges to the originating BundleZone wallet at the end of the day (a confirmed rejection may be refunded earlier).
- **Customer Confirmation Notice Requirement**: Before accepting an order, your website must show this notice and ask the customer to confirm. The customer should check the recipient carefully and avoid reordering while an order is processing. Resellers must pass any refund on to their own customer.
- **Reference & Reconciliation**:
  - Keep the original `client_reference` (8–100 characters: letters, digits, dots, underscores, colons, or hyphens).
  - Use the status endpoint (`/api/status.php`) or signed callbacks to distinguish `processing`, `completed`, `failed`, `submission_unknown`, and `refunded`.
  - **Do not treat HTTP 200 or `success: true` as delivery confirmation** (`processing` means delivery is pending; `completed` confirms fulfillment).
  - **Do not mark an order refunded until `refunded: true`**; a pending or `submission_unknown` order needs reconciliation, not a duplicate purchase.

| Requirement | `MTN_EXPRESS` Behaviour |
| :--- | :--- |
| **Catalogue** | `GET /api/bundles.php?network=MTN_EXPRESS&active=0` (`active=0` includes unavailable sizes so your site can show their prices; read `available` for each size — unavailable bundles cannot be purchased). Refresh availability before checkout; stock can change. |
| **Single / Bulk** | One recipient (`mode: "single"`) or a batch of 1–20 rows (`mode: "bulk"`). Remove duplicate recipient/bundle pairs. Every row must pass checks before funds are reserved. |
| **Order Reference** | Required: `client_reference` or `Idempotency-Key` (`X-Idempotency-Key`). Both must match if supplied together (8–100 chars `[A-Za-z0-9._:-]`). |
| **Retries** | Reuse the same `client_reference` and identical details. Changed details return HTTP `409 Conflict`. A no-order failure (`422` invalid details or `503` stock/pricing unavailability before reservation) can be retried with its original reference after the issue is resolved. |
| **Prechecks** | Accept up to 100 numbers and validate phone format only (`status: "not_required"`, `verification_status: "NOT_REQUIRED"`, `verification_required: false`). Do not require `VERIFIED` before submitting `MTN_EXPRESS`. |
| **Callbacks** | Use existing HTTPS callback settings, include a stable `event_id`, and retry failed delivery up to 8 times. Ignore duplicate events. The status endpoint remains the current source of truth. |

---

## Important Usage Notes & Deduplication Rules

- **Phone Number Format**: Ghana local 10-digit format starting with `0` (e.g. `0241234567`, `0551234567`). Digits with country code (e.g. `233551234567`) are automatically normalized.
- **Networks**:
  - `MTN_EXPRESS`: MTN Ghana Express Data Bundles (no beneficiary check required).
  - `YELLO` or `MTN`: Legacy MTN SME network code (routed as `MTN_EXPRESS`).
  - `Telecel`: Telecel Ghana Data Bundles (formerly Vodafone).
  - `AT`: AirtelTigo Data Bundles.
- **Capacity**: Specified in Gigabytes (GB) as a number (e.g. `1` for 1GB, `2` for 2GB, `10` for 10GB). Do not send a selling price; the server uses the price for your account.
- **Anti-Duplicate Order Prevention (Idempotency)**:
  - **Always Provide a Unique `client_reference`**: In every order submission, include a unique `client_reference` of 8–100 characters (`[A-Za-z0-9._:-]`, e.g. `"client_reference": "myshop-order-10001"`).
  - If supplying `Idempotency-Key` / `X-Idempotency-Key` headers alongside `client_reference`, both values must match exactly.
  - **Deduplication Cooldown Window**: If an order with the same `client_reference` or an identical order is submitted within the deduplication window, the server prevents double charges. Changed details with the same reference return HTTP `409 Conflict`.
  - **Client Deduplication & `submission_unknown` Handling**: For `submission_unknown` or duplicate responses, **keep the same reference and poll status**. **DO NOT create a new request or cascade to force another purchase**.
- **Payment & Refund State (`charged` and `refunded`)**:
  - Read `charged` and `refunded` on status and callback payloads to determine payment state.
  - A `failed` status alone does **not** confirm a refund until `refunded: true` (or `charged: false`).
- **Security**: Never expose API keys or webhook secrets in client-side applications.

---

## Authentication

Every API request requires an authentication header with your secret API key:

```http
X-API-KEY: YOUR_API_KEY
Content-Type: application/json
Accept: application/json
```

*(Note: `x-api-key: YOUR_API_KEY` in lowercase is also accepted.)*

---

## Endpoints

### 1. Check Available Sizes and Prices

- **Method**: `GET`
- **Path**: `/api/bundles.php?network=MTN_EXPRESS&active=0` (or `/api/bundles.php?active=0` for all networks)
- **Description**: Retrieve data bundles, capacity keys, pricing, and live availability (`available`). Passing `active=0` includes unavailable sizes so your site can display their prices while preventing checkout of unavailable bundles.

#### Bundles Request Example

```bash
curl "https://bundlezone.shop/api/bundles.php?network=MTN_EXPRESS&active=0" \
  -H "X-API-KEY: YOUR_API_KEY" \
  -H "Accept: application/json"
```

#### Bundles Response (HTTP 200)

```json
{
  "success": true,
  "data": {
    "bundles": [
      {
        "id": 101,
        "network": "MTN_EXPRESS",
        "capacity": 1,
        "capacity_label": "1GB",
        "price": 4.50,
        "available": true,
        "active": true
      },
      {
        "id": 102,
        "network": "MTN_EXPRESS",
        "capacity": 10,
        "capacity_label": "10GB",
        "price": 42.00,
        "available": false,
        "active": false
      },
      {
        "id": 201,
        "network": "Telecel",
        "capacity": 5,
        "capacity_label": "5GB",
        "price": 18.00,
        "available": true,
        "active": true
      },
      {
        "id": 301,
        "network": "AT",
        "capacity": 10,
        "capacity_label": "10GB",
        "price": 35.00,
        "available": true,
        "active": true
      }
    ]
  }
}
```

---

### 2. Beneficiary Check (Precheck)

- **Method**: `POST`
- **Path**: `/api/beneficiary-check.php`
- **Description**: Express prechecks (`MTN_EXPRESS`) accept up to 100 numbers and validate phone format only. They return `status: "not_required"`, `verification_status: "NOT_REQUIRED"`, and `verification_required: false`. Do not require `VERIFIED` before submitting `MTN_EXPRESS`. `AT` and `Telecel` numbers also return `not_required`.

#### A. Single Recipient Request

```json
{
  "network": "MTN_EXPRESS",
  "phone_number": "0241234567"
}
```

#### B. Bulk Recipients Request (Up to 100 Numbers for Express Precheck)

```json
{
  "network": "MTN_EXPRESS",
  "phone_numbers": [
    "0241234567",
    "0551234567",
    "0598458971"
  ]
}
```

#### Express Precheck Response (HTTP 200)

```json
{
  "success": true,
  "data": {
    "request_id": "REQ-CHK-99120",
    "network": "MTN_EXPRESS",
    "count": 1,
    "results": [
      {
        "phone_number": "0241234567",
        "status": "not_required",
        "verification_status": "NOT_REQUIRED",
        "verification_required": false,
        "can_order": true,
        "message": "Number verification is not required for MTN Express."
      }
    ]
  }
}
```

---

### 3. Place Order (Single Order)

- **Method**: `POST`
- **Path**: `/api/order.php`
- **Description**: Place a single data bundle order. Use a `client_reference` of 8–100 letters, digits, dots, underscores, colons, or hyphens. Capacity is in GB; do not send a selling price.

#### Request Headers

```http
X-API-KEY: YOUR_API_KEY
Idempotency-Key: myshop-order-10001
X-Idempotency-Key: myshop-order-10001
Content-Type: application/json
Accept: application/json
```

#### Single Order Request Body

```json
{
  "mode": "single",
  "network": "MTN_EXPRESS",
  "recipient": "0241234567",
  "capacity": 10,
  "client_reference": "myshop-order-10001"
}
```

#### Order Accepted Response (HTTP 200)

Single-order results are returned under `data.order`. Remember: HTTP 200 or `success: true` means the order was accepted for processing, **not** that carrier delivery is complete.

```json
{
  "success": true,
  "data": {
    "request_id": "REQ-ABC123",
    "order_id": 12345,
    "reference": "BZ-ORD-12345",
    "client_reference": "myshop-order-10001",
    "mode": "single",
    "order": {
      "id": 12345,
      "order_id": 12345,
      "reference": "BZ-ORD-12345",
      "client_reference": "myshop-order-10001",
      "success": true,
      "status": "processing",
      "charged": true,
      "refunded": false,
      "message": "Order accepted and queued for carrier delivery."
    }
  }
}
```

#### Duplicate / Conflict Response (HTTP 409)

When retrying, reuse the same `client_reference` and identical details. Changed details return `409`.

```json
{
  "success": false,
  "code": "DUPLICATE_ORDER",
  "message": "Duplicate order detected. An order with this reference has already been placed or is currently being processed.",
  "data": {
    "order_id": 12345,
    "reference": "BZ-ORD-12345",
    "client_reference": "myshop-order-10001",
    "status": "processing"
  }
}
```

---

### 4. Place Bulk Order

- **Method**: `POST`
- **Path**: `/api/order.php`
- **Description**: Submit a batch of 1–20 recipients in one HTTP request for `MTN_EXPRESS`. Remove duplicate recipient/bundle pairs before submission. The batch is checked before funds are reserved, and results under `data.result` identify each BundleZone order separately.

#### Bulk Order Request Body (1–20 Recipients)

```json
{
  "mode": "bulk",
  "network": "MTN_EXPRESS",
  "client_reference": "myshop-batch-10001",
  "rows": [
    {
      "recipient": "0241234567",
      "capacity": 1
    },
    {
      "recipient": "0551234567",
      "capacity": 2
    }
  ]
}
```

#### Bulk Accepted Response (HTTP 200)

```json
{
  "success": true,
  "data": {
    "batch_id": "myshop-batch-10001",
    "client_reference": "myshop-batch-10001",
    "mode": "bulk",
    "count": 2,
    "status": "processing",
    "result": [
      {
        "order_id": 12345,
        "reference": "BZ-ORD-12345",
        "recipient": "0241234567",
        "capacity": 1,
        "status": "processing"
      },
      {
        "order_id": 12346,
        "reference": "BZ-ORD-12346",
        "recipient": "0551234567",
        "capacity": 2,
        "status": "processing"
      }
    ]
  }
}
```

---

### 5. Check Wallet Balance

- **Method**: `GET`
- **Path**: `/api/balance.php`
- **Description**: Check your real-time available API wallet balance.

#### Balance Check Request

```bash
curl "https://bundlezone.shop/api/balance.php" \
  -H "X-API-KEY: YOUR_API_KEY" \
  -H "Accept: application/json"
```

#### Balance Check Response (HTTP 200)

```json
{
  "success": true,
  "data": {
    "balance": 1425.50,
    "currency": "GHS"
  }
}
```

---

### 6. Check Order Status

- **Method**: `GET`
- **Path**: `/api/status.php`
- **Query Parameters**:
  - `reference`: The BundleZone reference returned by the order endpoint (or `client_reference`).
  - `order_id`: Alternatively supply the numeric BundleZone `order_id`.

#### Status Query Request

```bash
curl "https://bundlezone.shop/api/status.php?reference=YOUR_ORDER_REFERENCE" \
  -H "X-API-KEY: YOUR_API_KEY" \
  -H "Accept: application/json"
```

#### Status Query Response (HTTP 200)

The response is under `data.order` and contains `status`, `network`, `recipient`, `capacity`, and `price`. For `MTN_EXPRESS`, the response also includes `client_reference`, `charged`, and `refunded`.

```json
{
  "success": true,
  "data": {
    "order": {
      "order_id": 12345,
      "reference": "BZ-ORD-12345",
      "client_reference": "myshop-order-10001",
      "network": "MTN_EXPRESS",
      "recipient": "0241234567",
      "capacity": 10,
      "price": 42.00,
      "currency": "GHS",
      "status": "completed",
      "charged": true,
      "refunded": false,
      "source": "api",
      "created_at": "2026-10-28 07:50:00",
      "updated_at": "2026-10-28 08:00:00"
    }
  }
}
```

#### Status Interpretation Table

| `status` | `charged` | `refunded` | Required Action |
| :--- | :--- | :--- | :--- |
| `processing` | `true` | `false` | Delivery is pending. Keep polling or wait for callback. |
| `submission_unknown` | `true` / `null` | `false` | Keep the same reference and poll status. **Do not create a new request to force another purchase.** |
| `completed` | `true` | `false` | Fulfillment confirmed. Mark order as `fulfilled`. |
| `failed` | `true` | `false` | Delivery failed; awaiting end-of-day (or earlier rejection) wallet refund from BundleZone. **Do not mark refunded until `refunded: true`.** |
| `failed` / `refunded` | `true` / `false` | `true` | Refund confirmed on BundleZone wallet. Safe to refund customer/agent wallet. |

---

## Webhooks & Status Callbacks

Express callbacks use your existing HTTPS callback settings, include a stable `event_id`, and retry failed delivery up to **8 times**. Ignore duplicate events (`event_id`). The `/api/status.php` endpoint remains the current source of truth.

### Delivery Specifications

| Parameter | Value |
| :--- | :--- |
| **HTTP Method** | `POST` |
| **Content-Type** | `application/json` |
| **User-Agent** | `BundleZone-Webhook/1.0` |
| **Event Name** | `order.status_changed` |
| **Deduplication Key** | `event_id` (stable across all 8 retry attempts) |
| **Expected Response** | HTTP `200 OK` with JSON `{"success": true}` or `{"received": true}` |
| **Timeout** | 25 seconds |
| **Retries** | Up to 8 times if receiver returns non-2xx or times out |

### Callback Request Headers

```http
Content-Type: application/json
Accept: application/json
User-Agent: BundleZone-Webhook/1.0
X-BundleZone-Timestamp: 1787472000
X-BundleZone-Signature: sha256=17df56c342f02f9c3eb738f6d...
```

### Signature Computation & Verification

To verify that the webhook genuinely originated from BundleZone and has not been tampered with:

1. Retrieve the `X-BundleZone-Timestamp` and `X-BundleZone-Signature` headers.
2. Ensure the timestamp is within 300 seconds (5 minutes) of current server time to prevent replay attacks.
3. Concatenate the timestamp, a dot (`.`), and the **exact raw request body string**:

   ```text
   signed_payload = timestamp + "." + raw_body
   ```

4. Compute the HMAC-SHA256 hex digest using your `WEBHOOK_SECRET`:

   ```text
   expected_signature = "sha256=" + HMAC_SHA256_HEX(signed_payload, WEBHOOK_SECRET)
   ```

5. Perform a constant-time / timing-safe string comparison between `expected_signature` and the header.

### Example Webhook Payload

```json
{
  "event_id": "evt_9988776655443322",
  "event": "order.status_changed",
  "timestamp": "2026-10-28T08:00:00+00:00",
  "data": {
    "order": {
      "order_id": 12345,
      "reference": "BZ-ORD-12345",
      "client_reference": "myshop-order-10001",
      "network": "MTN_EXPRESS",
      "recipient": "0241234567",
      "capacity": 10,
      "price": 42.00,
      "status": "completed",
      "charged": true,
      "refunded": false,
      "source": "api",
      "created_at": "2026-10-28 07:50:00",
      "updated_at": "2026-10-28 08:00:00"
    }
  }
}
```

### Webhook Idempotency Best Practice

- Record `event_id` in your order metadata and ignore duplicate `event_id` deliveries.
- If the order is already marked as `fulfilled` or `completed`, immediately acknowledge with `HTTP 200` without triggering secondary wallet credits, commissions, or customer SMS.
- For `MTN_EXPRESS`, do not refund the customer on a `failed` webhook unless `refunded: true` (or `charged: false`) is present.

---

## Webhook Verification Code Examples

### Node.js / TypeScript (Express or Edge Runtime)

```typescript
import crypto from "node:crypto";

function verifyBundleZoneWebhook(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  secretKey: string
): boolean {
  if (!signatureHeader || !secretKey) return false;

  // Verify timestamp within 5 minutes
  if (timestampHeader) {
    const ts = parseInt(timestampHeader, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > 300) return false; // Replay attack protection
  }

  // Construct signed payload
  const signedPayload = timestampHeader ? `${timestampHeader}.${rawBody}` : rawBody;
  const hmac = crypto.createHmac("sha256", secretKey).update(signedPayload).digest("hex");
  const expectedSignature = `sha256=${hmac}`;

  const cleanProvided = signatureHeader.toLowerCase().trim();
  const cleanExpected = expectedSignature.toLowerCase();

  return crypto.timingSafeEqual(
    Buffer.from(cleanProvided),
    Buffer.from(cleanExpected)
  );
}
```

## Developer Support & Inquiries

For technical assistance, API key provisioning, balance adjustments, or order query escalations:
- **Phone / Support Helpline**: [`0256702995`](tel:+233256702995) (`+233 25 670 2995`)
- **WhatsApp Support**: [`0256702995`](https://wa.me/233256702995)
- **Support Desk Hours**: Daily 7:00 AM – 10:00 PM GMT
