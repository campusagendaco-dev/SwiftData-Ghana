# BundleZone REST API Integration Documentation

Base URL: `https://bundlezone.shop`

Use the API to retrieve available bundles, verify beneficiary numbers, place single or bulk orders, check balances, and receive status updates through webhooks.

---

## Important Usage Notes

- **Phone Number Format**: Use Ghana local phone number format, for example `0551234567` (10 digits starting with `0`).
- **Capacity**: Measured in GB. For example, `1` means 1GB, `2` means 2GB, `0.5` means 500MB.
- **Fetch Bundles**: Always fetch current bundles from `/api/bundles.php` before placing an order. Use the exact network and capacity returned by the bundles endpoint.
- **Bulk Requests**: For bulk requests, every row uses the network supplied in the request body. Authenticated API clients may submit up to 1,000 rows in one bulk-order request.
- **Beneficiary Verification**: Applies only to MTN and Yello orders. AT and Telecel orders are not blocked by beneficiary verification.
- **Verification Rule**: Only an exact `VERIFIED` decision (`verification_status: "VERIFIED"`) may continue to an MTN or Yello purchase.
- **Precheck Reliability**: A beneficiary precheck is only a convenience. Every MTN or Yello number is checked again automatically when an order is submitted. The final server-side check cannot be bypassed.
- **Pricing & Debit**: API pricing follows the current account role and pricing tier. The wallet is debited only after an order is accepted for processing.
- **Security**: Keep API keys and webhook secrets private. Never expose them in frontend JavaScript.

---

## Authentication

Send your API key in every request using the configured API-key header:

```http
x-api-key: YOUR_API_KEY
Content-Type: application/json
```

---

## Endpoints

### 1. Bundles

- **Method**: `GET`
- **Path**: `/api/bundles.php`
- **Description**: Fetch available bundles before placing an order. Use the exact network and capacity values returned by this endpoint.

**Example Request:**

```bash
curl "https://bundlezone.shop/api/bundles.php" \
  -H "x-api-key: YOUR_API_KEY"
```

---

### 2. Beneficiary Check

- **Method**: `POST`
- **Path**: `/api/beneficiary-check.php`
- **Description**: Check whether one or more MTN or Yello numbers are ready before placing an order. AT and Telecel do not require this check. A maximum of 1,000 unique phone numbers is accepted per authenticated precheck request. A precheck never creates an order and never changes the wallet balance.

**Single Number Request:**

```json
{
  "network": "MTN",
  "phone_number": "0551234567"
}
```

**Multiple Numbers Request:**

```json
{
  "network": "MTN",
  "phone_numbers": [
    "0551234567",
    "0598458971",
    "0241234567"
  ]
}
```

**Verified Response:**

```json
{
  "success": true,
  "data": {
    "request_id": "REQ-ABC123",
    "network": "MTN",
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

**Unverified Response:**

```json
{
  "success": true,
  "data": {
    "request_id": "REQ-ABC123",
    "network": "MTN",
    "count": 1,
    "results": [
      {
        "phone_number": "0551234567",
        "status": "unverified",
        "verification_status": "NOT_VERIFIED",
        "verification_request_id": "8fd7a5f4-05ef-4aa8-a44e-8da58f50ef11",
        "can_order": false,
        "retryable": false,
        "message": "This number is not verified and cannot be ordered."
      }
    ]
  }
}
```

#### Status Meaning

| Status | Meaning | Action |
| :--- | :--- | :--- |
| **VERIFIED** | Can proceed to order | Safe to place order |
| **NOT_VERIFIED** | Not eligible for ordering | Do not submit |
| **PENDING** | Decision still processing | Retry later |
| **UNAVAILABLE** | Trustworthy decision not obtained | Retry later with backoff |
| **INVALID** | Invalid phone number | Correct number |
| **NOT REQUIRED** | AT / Telecel networks | No precheck required |

---

### 3. Single Order

- **Method**: `POST`
- **Path**: `/api/order.php`

**Request:**

```json
{
  "mode": "single",
  "network": "MTN",
  "recipient": "0551234567",
  "capacity": 1
}
```

**Accepted Response:**

```json
{
  "success": true,
  "data": {
    "request_id": "REQ-ABC123",
    "mode": "single",
    "order": {
      "success": true,
      "status": "processing",
      "message": "Order accepted.",
      "estimated_delivery": "30 minutes to 6 hours"
    }
  }
}
```

**Unverified Beneficiary Response:**

```json
{
  "success": false,
  "message": "This MTN/Yello number is not verified. No order was created and the wallet was not charged.",
  "data": {
    "request_id": "REQ-ABC123",
    "mode": "single",
    "code": "BENEFICIARY_NOT_VERIFIED",
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

### 4. Bulk Order

- **Method**: `POST`
- **Path**: `/api/order.php`

All rows in a bulk request use the network supplied at the top level. Authenticated API clients may submit a maximum of 1,000 rows per request.

**Request:**

```json
{
  "mode": "bulk",
  "network": "MTN",
  "rows": [
    {
      "recipient": "0551234567",
      "capacity": 1
    },
    {
      "recipient": "0598458971",
      "capacity": 2
    }
  ]
}
```

*Note: MTN and Yello bulk orders are all-or-nothing. Every recipient must return `VERIFIED`. If any result is not verified, the complete batch is held (`BULK_VERIFICATION_HELD`), no order rows are created, and the wallet is not charged.*

---

## Webhooks

Webhooks provide asynchronous status updates for orders created through the API. When an eligible order changes status, the platform sends an HTTP POST request containing JSON to the configured callback URL.

### Delivery Details

- **HTTP Method**: `POST`
- **Content-Type**: `application/json`
- **Event Name**: `order.status_changed`
- **Response**: Any `2xx` HTTP status
- **Timeout**: 25 seconds

### Headers

```http
Content-Type: application/json
Accept: application/json
User-Agent: BundleZone-Webhook/1.0
X-BundleZone-Timestamp: 1786949700
X-BundleZone-Signature: sha256=HMAC_HEX_DIGEST
```

### Signature Verification

The signed value is constructed from the timestamp header, a full stop (`.`), and the raw HTTP body:

```text
signed_payload = X-BundleZone-Timestamp + "." + raw_request_body
expected_signature = "sha256=" + HMAC_SHA256_HEX(signed_payload, WEBHOOK_SECRET)
```

### Example Payload

```json
{
  "event": "order.status_changed",
  "timestamp": "2026-08-17T08:15:00+00:00",
  "data": {
    "order_id": 1842,
    "reference": "BZ-20260817-ABC123",
    "network": "MTN",
    "recipient": "0551234567",
    "capacity": 5,
    "capacity_label": "5GB",
    "price": 19.5,
    "currency": "GHS",
    "status": "completed",
    "source": "api",
    "created_at": "2026-08-17 08:04:31",
    "updated_at": "2026-08-17 08:15:00"
  },
  "client": {
    "api_client_id": 26,
    "client_name": "Example Merchant"
  }
}
```
