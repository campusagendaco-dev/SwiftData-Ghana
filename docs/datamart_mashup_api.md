# DataMart MTN MashUp REST API Integration Guide

**Base URL**: `https://api.datamartgh.shop`  
**API Prefix**: `/api/developer`  
**Protocol Revision**: October 2026  

---

## 1. Overview & Core Rules

The **MTN MashUp API** allows you to sell MTN Ghana combo packages directly from your own application. Each package is a **30-day combo plan** containing:
- High-speed Internet Data (MB / GB)
- MTN-to-MTN Voice Minutes (`onnetMins`)
- Other-Network Voice Minutes (`offnetMins`)
- SMS Messages (`sms`)

All purchases are debited from your existing DataMart API wallet using your standard API key.

### Essential Rules & Gotchas

1. **Account Enablement Gate (`403 MASHUP_NOT_ENABLED`)**:
   - MashUp is a restricted carrier product. Your API account must be explicitly enabled by support before these endpoints answer.
   - Until enabled, both `/mashup/packages` and `/mashup/purchase` return HTTP 403 `MASHUP_NOT_ENABLED`.
   - **Do not poll these endpoints in a tight loop** when disabled.
2. **Pricing Tier vs. Combo Cost**:
   - `comboCost` is the **package identifier** you send in the purchase payload. It is **not** the price you pay.
   - Your account is assigned to a `pricingTier` (e.g. `official`). The `price` returned by `/mashup/packages` is your actual wholesale debit amount.
   - Always query `/mashup/packages` dynamically rather than hardcoding prices.
3. **Data vs. Voice Trade-Off**:
   - The price list is **not in strict data-size order**. For example, the ₵50 combo carries less data than the ₵40 one because it offers significantly higher voice minutes.
   - Always display the full contents of the package to your customers (data, on-net mins, off-net mins, SMS), not just the data size.
4. **Lane Open / Closed Status (`open: false`)**:
   - When `"open": false`, the carrier lane is temporarily suspended.
   - Purchases during lane closure are immediately refused with HTTP 503 `MASHUP_UNAVAILABLE` and your wallet is **not** charged. Do not queue or spam orders when `open` is false.
5. **Deduplication & Unique Reference**:
   - Provide a unique `ref` in every purchase payload to prevent accidental double-billing and duplicate delivery.
   - If a duplicate `ref` is submitted, the API rejects it with HTTP 400 `DUPLICATE_REFERENCE`.
6. **Order Cancellation**:
   - While an order is still `pending`, it can be cancelled via `/cancel-order` for a 100% full wallet refund.

---

## 2. Authentication

Authenticate all API requests by providing your API key in the `X-API-Key` HTTP header:

```http
X-API-Key: YOUR_DATAMART_API_KEY
Content-Type: application/json
Accept: application/json
```

---

## 3. Endpoints

### 1. Fetch MashUp Catalogue

Retrieve active MashUp packages, your tier pricing, and current lane status.

- **Method**: `GET`
- **Path**: `/api/developer/mashup/packages`

#### Request Example

```bash
curl -X GET "https://api.datamartgh.shop/api/developer/mashup/packages" \
  -H "X-API-Key: YOUR_DATAMART_API_KEY" \
  -H "Accept: application/json"
```

#### Successful Response (HTTP 200)

```json
{
  "status": "success",
  "open": true,
  "currency": "GHS",
  "pricingTier": "official",
  "data": [
    {
      "comboCost": 10,
      "price": 13,
      "title": "MTN MashUp ₵13",
      "mb": 511,
      "capacity": 0.5,
      "onnetMins": 176,
      "offnetMins": 22,
      "sms": 45,
      "validityDays": 30
    },
    {
      "comboCost": 15,
      "price": 19,
      "title": "MTN MashUp ₵19",
      "mb": 767,
      "capacity": 0.75,
      "onnetMins": 264,
      "offnetMins": 33,
      "sms": 67,
      "validityDays": 30
    },
    {
      "comboCost": 20,
      "price": 25,
      "title": "MTN MashUp ₵25",
      "mb": 1023,
      "capacity": 1.0,
      "onnetMins": 352,
      "offnetMins": 44,
      "sms": 90,
      "validityDays": 30
    },
    {
      "comboCost": 30,
      "price": 38,
      "title": "MTN MashUp ₵38",
      "mb": 1535,
      "capacity": 1.5,
      "onnetMins": 528,
      "offnetMins": 66,
      "sms": 135,
      "validityDays": 30
    },
    {
      "comboCost": 40,
      "price": 50,
      "title": "MTN MashUp ₵50",
      "mb": 2047,
      "capacity": 2.0,
      "onnetMins": 704,
      "offnetMins": 88,
      "sms": 180,
      "validityDays": 30
    },
    {
      "comboCost": 50,
      "price": 63,
      "title": "MTN MashUp ₵63",
      "mb": 1535,
      "capacity": 1.5,
      "onnetMins": 1056,
      "offnetMins": 132,
      "sms": 270,
      "validityDays": 30
    },
    {
      "comboCost": 100,
      "price": 125,
      "title": "MTN MashUp ₵125",
      "mb": 8080,
      "capacity": 7.89,
      "onnetMins": 1760,
      "offnetMins": 220,
      "sms": 450,
      "validityDays": 30
    }
  ]
}
```

---

### 2. Purchase MashUp Package

Place a combo package order for a recipient phone number.

- **Method**: `POST`
- **Path**: `/api/developer/mashup/purchase`

#### Request Payload Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `phoneNumber` | string | **Yes** | 10-digit MTN Ghana number (e.g. `"0241234567"`). |
| `comboCost` | number | **Yes** | The package identifier from the catalogue (e.g. `10`, `15`, `20`). Do **not** send the price. |
| `ref` | string | Optional | Unique merchant tracking reference. Required to prevent duplicate dispatches. |

#### Purchase Request Example

```bash
curl -X POST "https://api.datamartgh.shop/api/developer/mashup/purchase" \
  -H "X-API-Key: YOUR_DATAMART_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "phoneNumber": "0241234567",
    "comboCost": 10,
    "ref": "SWIFT-MASH-1728980001"
  }'
```

#### Successful Purchase Response (HTTP 200)

```json
{
  "status": "success",
  "message": "Order placed — the package is on its way.",
  "data": {
    "orderId": "66f1e5b3e6b39812345678",
    "reference": "SWIFT-MASH-1728980001",
    "phoneNumber": "0241234567",
    "network": "MTN_COMBO",
    "orderStatus": "pending",
    "comboCost": 10,
    "price": 13,
    "title": "MTN MashUp ₵13",
    "mb": 511,
    "capacity": 0.5,
    "onnetMins": 176,
    "offnetMins": 22,
    "sms": 45,
    "validityDays": 30,
    "balanceAfter": 179.50,
    "trackWith": "/api/developer/order-status/SWIFT-MASH-1728980001"
  }
}
```

---

### 3. Check Order Status

Query real-time delivery status using your merchant reference or order ID.

- **Method**: `GET`
- **Path**: `/api/developer/order-status/:reference`

#### Status Request Example

```bash
curl -X GET "https://api.datamartgh.shop/api/developer/order-status/SWIFT-MASH-1728980001" \
  -H "X-API-Key: YOUR_DATAMART_API_KEY" \
  -H "Accept: application/json"
```

#### Status Response (HTTP 200)

```json
{
  "status": "success",
  "data": {
    "orderId": "66f1e5b3e6b39812345678",
    "reference": "SWIFT-MASH-1728980001",
    "phoneNumber": "0241234567",
    "network": "MTN_COMBO",
    "orderStatus": "delivered",
    "comboCost": 10,
    "price": 13,
    "deliveredAt": "2026-10-14T17:35:12Z"
  }
}
```

---

### 4. Cancel Pending Order

Cancel an order while it is still pending delivery and receive an immediate 100% wallet refund.

- **Method**: `POST`
- **Path**: `/api/developer/cancel-order`

#### Cancellation Request Example

```bash
curl -X POST "https://api.datamartgh.shop/api/developer/cancel-order" \
  -H "X-API-Key: YOUR_DATAMART_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "reference": "SWIFT-MASH-1728980001"
  }'
```

---

## 4. Error Codes & Troubleshooting

| Error Code | HTTP Status | Meaning | Recommended Action |
| :--- | :--- | :--- | :--- |
| `MASHUP_NOT_ENABLED` | **403** | MashUp is not enabled on your API account. | Contact DataMart support to activate MashUp. Do not retry automatically. |
| `MASHUP_UNAVAILABLE` | **503** | Carrier lane closed. Nothing was debited. | Keep order in `pending`/`processing` and retry after lane re-opens. |
| `UNKNOWN_PACKAGE` | **400** | The submitted `comboCost` does not exist. | Query `/mashup/packages` to verify valid comboCost numbers. |
| `INVALID_PHONE` | **400** | Phone number is not a valid 10-digit MTN number. | Validate with `024`, `054`, `055`, `059`, `053` prefix before ordering. |
| `DUPLICATE_REFERENCE` | **400** | The merchant `ref` has already been used. | Generate a unique reference per transaction. Do not retry blindly. |
| `INSUFFICIENT_BALANCE` | **400** | Your API wallet does not have enough funds. | Top up your DataMart wallet balance. |
| `API_KEY_REQUIRED` | **401** | Missing or invalid `X-API-Key` header. | Verify environment credentials in `DATAMART_API_KEY`. |

---

## 5. Implementation Code Examples

### TypeScript / Node.js

```typescript
import axios from "axios";

const DATAMART_BASE = "https://api.datamartgh.shop/api/developer";
const API_KEY = process.env.DATAMART_API_KEY || "";

interface MashUpOrderParams {
  phone: string;
  comboCost: number;
  reference: string;
}

export async function buyMashUpPackage({ phone, comboCost, reference }: MashUpOrderParams) {
  try {
    const res = await axios.post(
      `${DATAMART_BASE}/mashup/purchase`,
      {
        phoneNumber: phone,
        comboCost,
        ref: reference
      },
      {
        headers: {
          "X-API-Key": API_KEY,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        timeout: 25000
      }
    );

    return {
      success: true,
      orderId: res.data?.data?.orderId,
      status: res.data?.data?.orderStatus || "processing",
      raw: res.data
    };
  } catch (error: any) {
    const data = error.response?.data;
    const code = data?.code || error.response?.status;
    const message = data?.message || error.message;

    if (code === "DUPLICATE_REFERENCE") {
      return { success: true, status: "processing", reason: "Duplicate reference accepted." };
    }

    return {
      success: false,
      code,
      message,
      retryable: code === "MASHUP_UNAVAILABLE" || error.code === "ECONNABORTED"
    };
  }
}
```

### PHP

```php
<?php
$apiKey = getenv('DATAMART_API_KEY');
$url = 'https://api.datamartgh.shop/api/developer/mashup/purchase';

$payload = [
    'phoneNumber' => '0241234567',
    'comboCost'   => 10,
    'ref'         => 'MASH_' . time() . '_' . bin2hex(random_bytes(3))
];

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($payload),
    CURLOPT_HTTPHEADER     => [
        'X-API-Key: ' . $apiKey,
        'Content-Type: application/json',
        'Accept: application/json'
    ],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$result = json_decode($response, true);
if ($httpCode === 200 && ($result['status'] ?? '') === 'success') {
    echo "Order Placed Successfully: " . $result['data']['orderId'];
} else {
    echo "Order Error [" . ($result['code'] ?? $httpCode) . "]: " . ($result['message'] ?? 'Unknown');
}
?>
```

### Python

```python
import os
import requests

API_KEY = os.environ.get("DATAMART_API_KEY", "")
BASE_URL = "https://api.datamartgh.shop/api/developer"

def purchase_mashup(phone: str, combo_cost: int, reference: str):
    headers = {
        "X-API-Key": API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    payload = {
        "phoneNumber": phone,
        "comboCost": combo_cost,
        "ref": reference
    }
    
    response = requests.post(f"{BASE_URL}/mashup/purchase", json=payload, headers=headers, timeout=30)
    data = response.json()
    
    if response.status_code == 200 and data.get("status") == "success":
        return {
            "ok": True,
            "order_id": data["data"]["orderId"],
            "status": data["data"]["orderStatus"]
        }
    
    return {
        "ok": False,
        "code": data.get("code", response.status_code),
        "message": data.get("message", "Purchase failed")
    }
```
