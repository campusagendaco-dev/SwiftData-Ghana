# BundleZone REST API Integration Documentation

**Base URL**: `https://bundlezone.shop`  
**API Prefix**: `/api`  
**Latest Spec Revision**: October 2026

The BundleZone REST API enables automated telecom data fulfillment, MTN/Yello beneficiary verification, order placement (single & bulk), wallet balance queries, real-time status lookups, and asynchronous webhook callbacks.

---

## Important Usage Notes & Deduplication Rules

- **Phone Number Format**: Ghana local 10-digit format starting with `0` (e.g. `0551234567`). Digits with country code (e.g. `233551234567`) are automatically normalized.
- **Networks**:
  - `YELLO` or `MTN`: MTN Ghana Data Bundles.
  - `Telecel`: Telecel Ghana Data Bundles (formerly Vodafone).
  - `AT`: AirtelTigo Data Bundles.
- **Capacity**: Specified in Gigabytes (GB) as a number (e.g. `1` for 1GB, `2` for 2GB, `0.5` for 500MB, `10` for 10GB).
- **Anti-Duplicate Order Prevention (Idempotency)**:
  - **Always Provide a Unique Merchant `reference`**: In every order submission, include a unique `reference` (e.g. `"reference": "ORD_20261014_998822"`).
  - Alternatively, pass the `X-Idempotency-Key` header with your unique transaction ID.
  - **Deduplication Cooldown Window**: If an order with the same `reference` or an identical order for the same recipient, network, and capacity is submitted within the deduplication window (5–15 minutes), the server prevents double charges. It returns either the existing in-progress order details or HTTP `409 Conflict` with error code `DUPLICATE_ORDER`.
  - **Client Deduplication Handling**: If a duplicate response is returned, **DO NOT fail or cancel the customer's purchase** and **DO NOT cascade the order to another fulfillment provider**. Keep the order in `processing` state and query `/api/status.php` or await the webhook callback.
- **Beneficiary Verification Gate**:
  - Mandatory for **MTN / Yello** orders.
  - `AT` and `Telecel` skip beneficiary verification automatically (`not_required`).
  - Only an exact `VERIFIED` decision (`verification_status: "VERIFIED"`) is permitted to proceed to order creation.
  - Even if a precheck is performed via `/api/beneficiary-check.php`, beneficiary validation is re-checked automatically on the server when `/api/order.php` is called.
- **Wallet Debit**: The wallet balance is debited only after an order is verified and accepted into the processing queue.
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

### 1. Fetch Available Bundles

- **Method**: `GET`
- **Path**: `/api/bundles.php`
- **Description**: Retrieve active data bundles, capacity keys, and pricing for each network.

#### Bundles Request Example

```bash
curl "https://bundlezone.shop/api/bundles.php" \
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
        "network": "YELLO",
        "capacity": 1,
        "capacity_label": "1GB",
        "price": 4.50,
        "active": true
      },
      {
        "id": 102,
        "network": "YELLO",
        "capacity": 2,
        "capacity_label": "2GB",
        "price": 9.00,
        "active": true
      },
      {
        "id": 201,
        "network": "Telecel",
        "capacity": 5,
        "capacity_label": "5GB",
        "price": 18.00,
        "active": true
      },
      {
        "id": 301,
        "network": "AT",
        "capacity": 10,
        "capacity_label": "10GB",
        "price": 35.00,
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
- **Description**: Precheck whether an MTN recipient number is verified and ready to receive SME data bundles. AT and Telecel numbers do not require verification and return `not_required`. This check does not debit the wallet or create an order.

#### A. Single Recipient Request

```json
{
  "network": "YELLO",
  "phone_number": "0551234567"
}
```

#### B. Bulk Recipients Request (Up to 1,000 Numbers)

```json
{
  "network": "YELLO",
  "phone_numbers": [
    "0551234567",
    "0598458971",
    "0241234567"
  ]
}
```

#### Verified Response (HTTP 200)

```json
{
  "success": true,
  "data": {
    "request_id": "REQ-CHK-99120",
    "network": "YELLO",
    "count": 1,
    "results": [
      {
        "phone_number": "0551234567",
        "status": "verified",
        "verification_status": "VERIFIED",
        "verification_request_id": "8fd7a5f4-05ef-4aa8-a44e-8da58f50ef11",
        "can_order": true,
        "retryable": false,
        "estimated_delivery": "30 minutes to 6 hours",
        "message": "The number is verified and ready for ordering."
      }
    ]
  }
}
```

#### Unverified Beneficiary Response (HTTP 200)

```json
{
  "success": true,
  "data": {
    "request_id": "REQ-CHK-99120",
    "network": "YELLO",
    "count": 1,
    "results": [
      {
        "phone_number": "0551234567",
        "status": "unverified",
        "verification_status": "NOT_VERIFIED",
        "verification_request_id": "8fd7a5f4-05ef-4aa8-a44e-8da58f50ef11",
        "can_order": false,
        "retryable": false,
        "message": "This number is not verified on the carrier beneficiary list."
      }
    ]
  }
}
```

---

### 3. Place Order (Single Order)

- **Method**: `POST`
- **Path**: `/api/order.php`
- **Description**: Place a single data bundle order. Always supply your merchant `reference` to guarantee duplicate protection.

#### Request Headers

```http
X-API-KEY: YOUR_API_KEY
X-Idempotency-Key: API123456789
Content-Type: application/json
Accept: application/json
```

#### Single Order Request Body

```json
{
  "mode": "single",
  "network": "YELLO",
  "recipient": "0551234567",
  "capacity": 1,
  "reference": "API123456789"
}
```

#### Order Accepted Response (HTTP 200)

```json
{
  "success": true,
  "data": {
    "request_id": "REQ-ABC123",
    "order_id": 12345,
    "reference": "API123456789",
    "mode": "single",
    "order": {
      "id": 12345,
      "order_id": 12345,
      "reference": "API123456789",
      "success": true,
      "status": "processing",
      "message": "Order accepted and queued for carrier delivery.",
      "estimated_delivery": "30 minutes to 6 hours"
    }
  }
}
```

#### Duplicate Order Rejection Response (HTTP 409 or HTTP 200)

When an identical order or duplicate reference is submitted during an active order cycle:

```json
{
  "success": false,
  "code": "DUPLICATE_ORDER",
  "message": "Duplicate order detected. An order with this reference has already been placed or is currently being processed.",
  "data": {
    "order_id": 12345,
    "reference": "API123456789",
    "status": "processing"
  }
}
```

#### Beneficiary Not Verified Response (HTTP 422 or HTTP 200)

```json
{
  "success": false,
  "code": "BENEFICIARY_NOT_VERIFIED",
  "message": "This MTN/Yello number is not verified. No order was created and the wallet was not charged.",
  "data": {
    "request_id": "REQ-ABC123",
    "mode": "single",
    "order": {
      "success": false,
      "code": "BENEFICIARY_NOT_VERIFIED",
      "verification_status": "NOT_VERIFIED",
      "order_created": false,
      "charged": false,
      "retryable": false
    }
  }
}
```

---

### 4. Place Bulk Order

- **Method**: `POST`
- **Path**: `/api/order.php`
- **Description**: Submit a batch of data orders in one HTTP request (up to 1,000 rows).
- **All-or-Nothing Rule**: For MTN/Yello batches, every recipient must be `VERIFIED`. If any recipient fails verification, the complete batch is held (`BULK_VERIFICATION_HELD`), no rows are dispatched, and no funds are charged.

#### Bulk Order Request Body

```json
{
  "mode": "bulk",
  "network": "YELLO",
  "reference": "BATCH-20261014-001",
  "rows": [
    {
      "recipient": "0551234567",
      "capacity": 1,
      "reference": "BATCH-ROW-001"
    },
    {
      "recipient": "0557654321",
      "capacity": 2,
      "reference": "BATCH-ROW-002"
    }
  ]
}
```

#### Bulk Accepted Response (HTTP 200)

```json
{
  "success": true,
  "data": {
    "batch_id": "BATCH-20261014-001",
    "mode": "bulk",
    "count": 2,
    "status": "processing",
    "message": "All 2 rows accepted."
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
  - `reference`: Your merchant reference (e.g. `?reference=API123456789`)
  - `order_id`: The BundleZone numeric order ID (e.g. `?order_id=12345`)

#### Status Query Request

```bash
curl "https://bundlezone.shop/api/status.php?reference=API123456789" \
  -H "X-API-KEY: YOUR_API_KEY" \
  -H "Accept: application/json"
```

#### Status Query Response (HTTP 200)

```json
{
  "success": true,
  "data": {
    "order_id": 12345,
    "reference": "API123456789",
    "network": "YELLO",
    "recipient": "0551234567",
    "capacity": 1,
    "price": 4.50,
    "currency": "GHS",
    "status": "completed",
    "source": "api",
    "created_at": "2026-08-23 07:50:00",
    "updated_at": "2026-08-23 08:00:00"
  }
}
```

---

## Webhooks & Status Callbacks

When an order reaches a terminal state (`completed`, `failed`), BundleZone sends an asynchronous HTTP POST callback to your registered webhook URL.

### Delivery Specifications

| Parameter | Value |
| :--- | :--- |
| **HTTP Method** | `POST` |
| **Content-Type** | `application/json` |
| **User-Agent** | `BundleZone-Webhook/1.0` |
| **Event Name** | `order.status_changed` |
| **Expected Response** | HTTP `200 OK` with JSON `{"success": true}` or `{"received": true}` |
| **Timeout** | 25 seconds |
| **Retries** | Exponential backoff (retries at 1m, 5m, 15m if receiver returns 5xx or times out) |

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
  "event": "order.status_changed",
  "timestamp": "2026-08-23T08:00:00+00:00",
  "data": {
    "order_id": 12345,
    "reference": "API123456789",
    "network": "YELLO",
    "recipient": "0551234567",
    "capacity": 1,
    "price": 5.00,
    "status": "completed",
    "source": "api",
    "created_at": "2026-08-23 07:50:00",
    "updated_at": "2026-08-23 08:00:00"
  },
  "client": {
    "api_client_id": 1,
    "client_name": "My API App"
  }
}
```

### Webhook Idempotency Best Practice

Because webhooks may be redelivered if a network hiccup delays your HTTP 200 response:

- Inspect your database before processing.
- If the order is already marked as `fulfilled` or `completed`, immediately acknowledge with `HTTP 200` without triggering secondary wallet credits, commissions, or customer SMS.

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

### PHP

```php
<?php
$rawBody = file_get_contents('php://input');
$timestamp = $_SERVER['HTTP_X_BUNDLEZONE_TIMESTAMP'] ?? null;
$signature = $_SERVER['HTTP_X_BUNDLEZONE_SIGNATURE'] ?? '';
$secretKey = getenv('BUNDLEZONE_WEBHOOK_SECRET');

if (!$signature || !$secretKey) {
    http_response_code(401);
    exit(json_encode(['error' => 'Missing signature']));
}

// Replay protection (5 minutes)
if ($timestamp && abs(time() - (int)$timestamp) > 300) {
    http_response_code(401);
    exit(json_encode(['error' => 'Expired timestamp']));
}

$signedPayload = $timestamp ? "{$timestamp}.{$rawBody}" : $rawBody;
$expectedSignature = 'sha256=' . hash_hmac('sha256', $signedPayload, $secretKey);

if (!hash_equals($expectedSignature, $signature)) {
    http_response_code(401);
    exit(json_encode(['error' => 'Invalid signature']));
}

// Idempotent processing
$payload = json_decode($rawBody, true);
$reference = $payload['data']['reference'] ?? $payload['data']['order_id'];
$status = strtolower($payload['data']['status'] ?? '');

// Update order status in your database...

http_response_code(200);
echo json_encode(['success' => true]);
?>
```

### Python (FastAPI / Flask)

```python
import hmac
import hashlib
import time

def verify_bundlezone_webhook(raw_body: bytes, timestamp: str, signature: str, secret: str) -> bool:
    if not signature or not secret:
        return False

    # Check 5-minute replay window
    if timestamp:
        try:
            ts = int(timestamp)
            if abs(int(time.time()) - ts) > 300:
                return False
        except ValueError:
            return False

    signed_payload = f"{timestamp}.".encode('utf-8') + raw_body if timestamp else raw_body
    computed = "sha256=" + hmac.new(secret.encode('utf-8'), signed_payload, hashlib.sha256).hexdigest()
    
    return hmac.compare_digest(computed.lower(), signature.lower().strip())
```

## Developer Support & Inquiries

For technical assistance, API key provisioning, balance adjustments, or order query escalations:
- **Phone / Support Helpline**: [`0256702995`](tel:+233256702995) (`+233 25 670 2995`)
- **WhatsApp Support**: [`0256702995`](https://wa.me/233256702995)
- **Support Desk Hours**: Daily 7:00 AM – 10:00 PM GMT

