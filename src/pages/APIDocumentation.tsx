import { useState, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Copy, Check, Shield, Zap, Code2, BookOpen,
  AlertCircle, ChevronRight, Globe, Key, List, ShoppingCart, AlertTriangle,
  Activity, Lock, RotateCcw, Menu, X, CreditCard, Search,
  ArrowLeftRight, Gauge, RefreshCw, Database
} from "lucide-react";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import LastMtnOrderWidget from "@/components/LastMtnOrderWidget";

const BASE_URL = "https://lsocdjpflecduumopijn.supabase.co/functions/v1/developer-api";

type Lang = "curl" | "node" | "python" | "php";
const LANGS: Lang[] = ["curl", "node", "python", "php"];
const LANG_LABELS: Record<Lang, string> = { curl: "cURL", node: "Node.js", python: "Python", php: "PHP" };

// ─── Code Snippets ────────────────────────────────────────────────────────────
const makeSnippets = (key: string): Record<string, Record<Lang, string>> => {
  const K = key || "swft_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  return {
    service_status: {
      curl: `curl -X GET "${BASE_URL}/service-status" \\\n  -H "X-API-Key: ${K}"`,
      node: `const res = await fetch("${BASE_URL}/service-status", {\n  headers: { "X-API-Key": "${K}" },\n});\nconst data = await res.json();\nconsole.log(data.services);`,
      python: `import requests\n\nres = requests.get(\n    "${BASE_URL}/service-status",\n    headers={"X-API-Key": "${K}"},\n)\nprint(res.json())`,
      php: `<?php\n$ch = curl_init("${BASE_URL}/service-status");\ncurl_setopt_array($ch, [\n    CURLOPT_HTTPHEADER    => ["X-API-Key: ${K}"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\n$data = json_decode(curl_exec($ch));\nprint_r($data->services);`,
    },
    balance: {
      curl: `curl -X GET "${BASE_URL}/balance" \\\n  -H "X-API-Key: ${K}"`,
      node: `const res = await fetch("${BASE_URL}/balance", {\n  headers: { "X-API-Key": "${K}" },\n});\nconst data = await res.json();\nconsole.log(data.balance);`,
      python: `import requests\n\nres = requests.get(\n    "${BASE_URL}/balance",\n    headers={"X-API-Key": "${K}"},\n)\nprint(res.json())`,
      php: `<?php\n$ch = curl_init("${BASE_URL}/balance");\ncurl_setopt_array($ch, [\n    CURLOPT_HTTPHEADER    => ["X-API-Key: ${K}"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\n$data = json_decode(curl_exec($ch));\necho $data->balance;`,
    },
    wallets: {
      curl: `curl -X GET "${BASE_URL}/wallets" \\\n  -H "Authorization: Bearer ${K}"`,
      node: `const res = await fetch("${BASE_URL}/wallets", {\n  headers: { "Authorization": "Bearer ${K}" },\n});\nconst { wallets } = await res.json();\nconsole.log("Main:", wallets.main.balance);\nconsole.log("API:", wallets.api.balance);`,
      python: `import requests\n\nres = requests.get(\n    "${BASE_URL}/wallets",\n    headers={"Authorization": "Bearer ${K}"},\n)\nw = res.json()["wallets"]\nprint("Main:", w["main"]["balance"])\nprint("API:", w["api"]["balance"])`,
      php: `<?php\n$ch = curl_init("${BASE_URL}/wallets");\ncurl_setopt_array($ch, [\n    CURLOPT_HTTPHEADER    => ["Authorization: Bearer ${K}"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\n$data = json_decode(curl_exec($ch));\necho $data->wallets->main->balance;`,
    },
    transfer: {
      curl: `curl -X POST "${BASE_URL}/wallet/transfer" \\\n  -H "Authorization: Bearer ${K}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "from": "main",\n    "to": "api",\n    "amount": 100.00\n  }'`,
      node: `const res = await fetch("${BASE_URL}/wallet/transfer", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer ${K}",\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({\n    from: "main",    // "main" | "api"\n    to:   "api",     // "main" | "api"\n    amount: 100.00,\n  }),\n});\nconst data = await res.json();\nconsole.log(data.success); // true`,
      python: `import requests\n\nres = requests.post(\n    "${BASE_URL}/wallet/transfer",\n    headers={\n        "Authorization": "Bearer ${K}",\n        "Content-Type": "application/json",\n    },\n    json={"from": "main", "to": "api", "amount": 100.00},\n)\nprint(res.json())`,
      php: `<?php\n$payload = json_encode(["from" => "main", "to" => "api", "amount" => 100.00]);\n$ch = curl_init("${BASE_URL}/wallet/transfer");\ncurl_setopt_array($ch, [\n    CURLOPT_POST           => true,\n    CURLOPT_POSTFIELDS     => $payload,\n    CURLOPT_HTTPHEADER     => [\n        "Authorization: Bearer ${K}",\n        "Content-Type: application/json",\n    ],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    account: {
      curl: `curl -X GET "${BASE_URL}/account" \\\n  -H "X-API-Key: ${K}"`,
      node: `const res = await fetch("${BASE_URL}/account", {\n  headers: { "X-API-Key": "${K}" },\n});\nconst data = await res.json();\nconsole.log(data.name, data.active);`,
      python: `import requests\n\nres = requests.get(\n    "${BASE_URL}/account",\n    headers={"X-API-Key": "${K}"},\n)\nprint(res.json())`,
      php: `<?php\n$ch = curl_init("${BASE_URL}/account");\ncurl_setopt_array($ch, [\n    CURLOPT_HTTPHEADER    => ["X-API-Key: ${K}"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    plans: {
      curl: `curl -X GET "${BASE_URL}/plans" \\\n  -H "Authorization: Bearer ${K}"`,
      node: `const res = await fetch("${BASE_URL}/plans", {\n  headers: { "Authorization": "Bearer ${K}" },\n});\nconst { plans } = await res.json();\nplans.forEach(p => console.log(p.network, p.package_size, "GH₵" + p.api_price));`,
      python: `import requests\n\nres = requests.get(\n    "${BASE_URL}/plans",\n    headers={"Authorization": "Bearer ${K}"},\n)\nfor plan in res.json()["plans"]:\n    print(plan["network"], plan["package_size"], plan["api_price"])`,
      php: `<?php\n$ch = curl_init("${BASE_URL}/plans");\ncurl_setopt_array($ch, [\n    CURLOPT_HTTPHEADER    => ["Authorization: Bearer ${K}"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\n$data = json_decode(curl_exec($ch));\nforeach ($data->plans as $plan) {\n    echo $plan->network . " " . $plan->package_size . " → GH₵" . $plan->api_price . "\\n";\n}`,
    },
    airtime: {
      curl: `curl -X POST "${BASE_URL}/payment/airtime" \\\n  -H "X-API-Key: ${K}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Idempotency-Key: unique_key_abc123" \\\n  -d '{\n    "network": "MTN",\n    "phone": "0241234567",\n    "amount": 5.00,\n    "request_id": "my_ref_001"\n  }'`,
      node: `const res = await fetch("${BASE_URL}/payment/airtime", {\n  method: "POST",\n  headers: {\n    "X-API-Key": "${K}",\n    "Content-Type": "application/json",\n    "X-Idempotency-Key": "unique_key_abc123",\n  },\n  body: JSON.stringify({\n    network: "MTN",          // MTN | TELECEL | AT | GLO\n    phone: "0241234567",\n    amount: 5.00,            // GHS — airtime mode\n    request_id: "my_ref_001",\n  }),\n});\nconst data = await res.json();\nconsole.log(data.status); // "fulfilled"`,
      python: `import requests\n\nres = requests.post(\n    "${BASE_URL}/payment/airtime",\n    headers={\n        "X-API-Key": "${K}",\n        "Content-Type": "application/json",\n        "X-Idempotency-Key": "unique_key_abc123",\n    },\n    json={\n        "network": "MTN",\n        "phone": "0241234567",\n        "amount": 5.00,\n        "request_id": "my_ref_001",\n    },\n)\nprint(res.json())`,
      php: `<?php\n$payload = json_encode([\n    "network" => "MTN",\n    "phone"   => "0241234567",\n    "amount"  => 5.00,\n    "request_id" => "my_ref_001",\n]);\n$ch = curl_init("${BASE_URL}/payment/airtime");\ncurl_setopt_array($ch, [\n    CURLOPT_POST           => true,\n    CURLOPT_POSTFIELDS     => $payload,\n    CURLOPT_HTTPHEADER     => [\n        "X-API-Key: ${K}",\n        "Content-Type: application/json",\n        "X-Idempotency-Key: unique_key_abc123",\n    ],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    data: {
      curl: `curl -X POST "${BASE_URL}/payment/data" \\\n  -H "X-API-Key: ${K}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Idempotency-Key: unique_key_def456" \\\n  -d '{\n    "package_id": "yellow_5gb",\n    "phone": "0241234567",\n    "request_id": "my_ref_002"\n  }'`,
      node: `const res = await fetch("${BASE_URL}/payment/data", {\n  method: "POST",\n  headers: {\n    "X-API-Key": "${K}",\n    "Content-Type": "application/json",\n    "X-Idempotency-Key": "unique_key_def456",\n  },\n  body: JSON.stringify({\n    package_id: "yellow_5gb",  // Unique smart ID from /plans\n    phone: "0241234567",\n    request_id: "my_ref_002",\n  }),\n});\nconst data = await res.json();\nconsole.log(data.status); // "fulfilled"`,
      python: `import requests\n\nres = requests.post(\n    "${BASE_URL}/payment/data",\n    headers={\n        "X-API-Key": "${K}",\n        "Content-Type": "application/json",\n        "X-Idempotency-Key": "unique_key_def456",\n    },\n    json={\n        "package_id": "yellow_5gb",\n        "phone": "0241234567",\n        "request_id": "my_ref_002",\n    },\n)\nprint(res.json())`,
      php: `<?php\n$payload = json_encode([\n    "package_id"   => "yellow_5gb",\n    "phone"        => "0241234567",\n    "request_id"   => "my_ref_002",\n]);\n$ch = curl_init("${BASE_URL}/payment/data");\ncurl_setopt_array($ch, [\n    CURLOPT_POST           => true,\n    CURLOPT_POSTFIELDS     => $payload,\n    CURLOPT_HTTPHEADER     => [\n        "X-API-Key: ${K}",\n        "Content-Type: application/json",\n        "X-Idempotency-Key: unique_key_def456",\n    ],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    validate: {
      curl: `curl -X POST "${BASE_URL}/payment/bills/validate" \\\n  -H "Authorization: Bearer ${K}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Idempotency-Key: unique_key_val123" \\\n  -d '{\n    "customerNumber": "8226349986",\n    "billType": "DSTV"\n  }'`,
      node: `const res = await fetch("${BASE_URL}/payment/bills/validate", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer ${K}",\n    "Content-Type": "application/json",\n    "X-Idempotency-Key": "unique_key_val123",\n  },\n  body: JSON.stringify({\n    customerNumber: "8226349986",\n    billType: "DSTV",\n  }),\n});\nconst data = await res.json();`,
      python: `import requests\n\nres = requests.post(\n    "${BASE_URL}/payment/bills/validate",\n    headers={"Authorization": f"Bearer {K}", "X-Idempotency-Key": "unique_key_val123"},\n    json={"customerNumber": "8226349986", "billType": "DSTV"}\n)\nprint(res.json())`,
      php: `<?php\n$payload = json_encode(["customerNumber" => "8226349986", "billType" => "DSTV"]);\n$ch = curl_init("${BASE_URL}/payment/bills/validate");\ncurl_setopt_array($ch, [\n    CURLOPT_POST => true,\n    CURLOPT_POSTFIELDS => $payload,\n    CURLOPT_HTTPHEADER => ["Authorization: Bearer ${K}", "Content-Type: application/json"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    bill: {
      curl: `curl -X POST "${BASE_URL}/payment/bills/pay" \\\n  -H "Authorization: Bearer ${K}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Idempotency-Key: unique_key_bill123" \\\n  -d '{\n    "customerNumber": "8226349986",\n    "billType": "DSTV",\n    "amount": 41.00,\n    "senderName": "JOHN DOE"\n  }'`,
      node: `const res = await fetch("${BASE_URL}/payment/bills/pay", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer ${K}",\n    "Content-Type": "application/json",\n    "X-Idempotency-Key": "unique_key_bill123",\n  },\n  body: JSON.stringify({\n    customerNumber: "8226349986",\n    billType: "DSTV",\n    amount: 41.00,\n    senderName: "JOHN DOE",\n  }),\n});\nconst data = await res.json();`,
      python: `import requests\n\nres = requests.post(\n    "${BASE_URL}/payment/bills/pay",\n    headers={"Authorization": f"Bearer {K}", "X-Idempotency-Key": "unique_key_bill123"},\n    json={"customerNumber": "8226349986", "billType": "DSTV", "amount": 41.00, "senderName": "JOHN DOE"}\n)\nprint(res.json())`,
      php: `<?php\n$payload = json_encode(["customerNumber" => "8226349986", "billType" => "DSTV", "amount" => 41.00, "senderName" => "JOHN DOE"]);\n$ch = curl_init("${BASE_URL}/payment/bills/pay");\ncurl_setopt_array($ch, [\n    CURLOPT_POST => true,\n    CURLOPT_POSTFIELDS => $payload,\n    CURLOPT_HTTPHEADER => ["Authorization: Bearer ${K}", "Content-Type: application/json"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    ecg_lookup: {
      curl: `curl -X POST "${BASE_URL}/payment/ecg/lookup" \\\n  -H "Authorization: Bearer ${K}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Idempotency-Key: unique_key_ecgl123" \\\n  -d '{\n    "accountNumber": "70013245710"\n  }'`,
      node: `const res = await fetch("${BASE_URL}/payment/ecg/lookup", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer ${K}",\n    "Content-Type": "application/json",\n    "X-Idempotency-Key": "unique_key_ecgl123",\n  },\n  body: JSON.stringify({\n    accountNumber: "70013245710",\n  }),\n});\nconst data = await res.json();`,
      python: `import requests\n\nres = requests.post(\n    "${BASE_URL}/payment/ecg/lookup",\n    headers={"Authorization": f"Bearer {K}", "X-Idempotency-Key": "unique_key_ecgl123"},\n    json={"accountNumber": "70013245710"}\n)\nprint(res.json())`,
      php: `<?php\n$payload = json_encode(["accountNumber" => "70013245710"]);\n$ch = curl_init("${BASE_URL}/payment/ecg/lookup");\ncurl_setopt_array($ch, [\n    CURLOPT_POST => true,\n    CURLOPT_POSTFIELDS => $payload,\n    CURLOPT_HTTPHEADER => ["Authorization: Bearer ${K}", "Content-Type: application/json"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    ecg_pay: {
      curl: `curl -X POST "${BASE_URL}/payment/ecg" \\\n  -H "Authorization: Bearer ${K}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Idempotency-Key: unique_key_ecg123" \\\n  -d '{\n    "phoneNumber": "233241234567",\n    "accountNumber": "70013245710",\n    "amount": 20.00\n  }'`,
      node: `const res = await fetch("${BASE_URL}/payment/ecg", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer ${K}",\n    "Content-Type": "application/json",\n    "X-Idempotency-Key": "unique_key_ecg123",\n  },\n  body: JSON.stringify({\n    phoneNumber: "233241234567",\n    accountNumber: "70013245710",\n    amount: 20.00,\n  }),\n});\nconst data = await res.json();`,
      python: `import requests\n\nres = requests.post(\n    "${BASE_URL}/payment/ecg",\n    headers={"Authorization": f"Bearer {K}", "X-Idempotency-Key": "unique_key_ecg123"},\n    json={"phoneNumber": "233241234567", "accountNumber": "70013245710", "amount": 20.00}\n)\nprint(res.json())`,
      php: `<?php\n$payload = json_encode(["phoneNumber" => "233241234567", "accountNumber" => "70013245710", "amount" => 20.00]);\n$ch = curl_init("${BASE_URL}/payment/ecg");\ncurl_setopt_array($ch, [\n    CURLOPT_POST => true,\n    CURLOPT_POSTFIELDS => $payload,\n    CURLOPT_HTTPHEADER => ["Authorization: Bearer ${K}", "Content-Type: application/json"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    sms: {
      curl: `curl -X POST "${BASE_URL}/sms" \\\n  -H "Authorization: Bearer ${K}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "to": "0241234567",\n    "message": "Your data bundle is ready!",\n    "senderId": "SwiftData"\n  }'`,
      node: `const res = await fetch("${BASE_URL}/sms", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer ${K}",\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({\n    to: "0241234567",\n    message: "Your data bundle is ready!",\n    senderId: "SwiftData"\n  }),\n});\nconst data = await res.json();`,
      python: `import requests\n\nres = requests.post(\n    "${BASE_URL}/sms",\n    headers={"Authorization": "Bearer ${K}"},\n    json={"to": "0241234567", "message": "Your data bundle is ready!"},\n)\nprint(res.json())`,
      php: `<?php\n$payload = json_encode(["to" => "0241234567", "message" => "Your data bundle is ready!"]);\n$ch = curl_init("${BASE_URL}/sms");\ncurl_setopt_array($ch, [\n    CURLOPT_POST => true,\n    CURLOPT_POSTFIELDS => $payload,\n    CURLOPT_HTTPHEADER => ["Authorization: Bearer ${K}", "Content-Type: application/json"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    orders: {
      curl: `curl -X GET "${BASE_URL}/orders?limit=20&offset=0" \\\n  -H "Authorization: Bearer ${K}"`,
      node: `const res = await fetch("${BASE_URL}/orders?limit=20&offset=0", {\n  headers: { "Authorization": "Bearer ${K}" },\n});\nconst { orders } = await res.json();`,
      python: `import requests\n\nres = requests.get(\n    "${BASE_URL}/orders",\n    params={"limit": 20, "offset": 0},\n    headers={"Authorization": "Bearer ${K}"},\n)\nprint(res.json()["orders"])`,
      php: `<?php\n$ch = curl_init("${BASE_URL}/orders?limit=20&offset=0");\ncurl_setopt_array($ch, [\n    CURLOPT_HTTPHEADER    => ["Authorization: Bearer ${K}"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    orders_filtered: {
      curl: `curl -X GET "${BASE_URL}/orders?limit=20&offset=40&status=fulfilled&network=MTN" \\\n  -H "Authorization: Bearer ${K}"`,
      node: `const params = new URLSearchParams({\n  limit:   "20",\n  offset:  "40",        // skip first 40 (page 3)\n  status:  "fulfilled", // pending|fulfilled|fulfillment_failed\n  network: "MTN",\n});\nconst res = await fetch(\`${BASE_URL}/orders?\${params}\`, {\n  headers: { "Authorization": "Bearer ${K}" },\n});\nconst { orders, total } = await res.json();`,
      python: `import requests\n\nres = requests.get(\n    "${BASE_URL}/orders",\n    params={\n        "limit":   20,\n        "offset":  40,\n        "status":  "fulfilled",\n        "network": "MTN",\n    },\n    headers={"Authorization": "Bearer ${K}"},\n)\ndata = res.json()\nprint(f"Total: {data['total']}, Returned: {len(data['orders'])}")`,
      php: `<?php\n$q = http_build_query(["limit"=>20,"offset"=>40,"status"=>"fulfilled","network"=>"MTN"]);\n$ch = curl_init("${BASE_URL}/orders?$q");\ncurl_setopt_array($ch, [\n    CURLOPT_HTTPHEADER    => ["Authorization: Bearer ${K}"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    status: {
      curl: `curl -X GET "${BASE_URL}/status?order_id=a3f2b1c0-d4e5-6789-ab01-cd2345ef6789" \\\n  -H "Authorization: Bearer ${K}"`,
      node: `const res = await fetch("${BASE_URL}/status?order_id=a3f2b1c0-d4e5-6789-ab01-cd2345ef6789", {\n  headers: { "Authorization": "Bearer ${K}" },\n});\nconst { order } = await res.json();\nconsole.log("Status:", order.status);`,
      python: `import requests\n\nres = requests.get(\n    "${BASE_URL}/status",\n    params={"order_id": "a3f2b1c0-d4e5-6789-ab01-cd2345ef6789"},\n    headers={"Authorization": "Bearer ${K}"},\n)\nprint(res.json()["order"]["status"])`,
      php: `<?php\n$ch = curl_init("${BASE_URL}/status?order_id=a3f2b1c0-d4e5-6789-ab01-cd2345ef6789");\ncurl_setopt_array($ch, [\n    CURLOPT_HTTPHEADER    => ["Authorization: Bearer ${K}"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\n$data = json_decode(curl_exec($ch));\necho $data->order->status;`,
    },
    hmac: {
      curl: `# 1. Compute HMAC-SHA256 of the raw JSON body using your secret key\nBODY='{"network":"MTN","phone":"0241234567","package_size":"5GB"}'\nSIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$YOUR_SECRET_KEY" -hex | awk '{print $2}')\n\n# 2. Send with both API key + signature headers\ncurl -X POST "${BASE_URL}/buy" \\\n  -H "Authorization: Bearer ${K}" \\\n  -H "X-Swift-Signature: $SIG" \\\n  -H "Content-Type: application/json" \\\n  -d "$BODY"`,
      node: `import crypto from "crypto";\n\nconst body = JSON.stringify({\n  network: "MTN",\n  phone: "0241234567",\n  package_size: "5GB",\n});\n\n// Sign the raw body string with your secret key\nconst sig = crypto\n  .createHmac("sha256", YOUR_SECRET_KEY)\n  .update(body)\n  .digest("hex");\n\nconst res = await fetch("${BASE_URL}/buy", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer ${K}",\n    "X-Swift-Signature": sig,\n    "Content-Type": "application/json",\n  },\n  body,\n});`,
      python: `import hmac, hashlib, json, requests\n\nbody = json.dumps({\n    "network": "MTN",\n    "phone": "0241234567",\n    "package_size": "5GB",\n}, separators=(",", ":"))\n\nsig = hmac.new(\n    YOUR_SECRET_KEY.encode(),\n    body.encode(),\n    hashlib.sha256\n).hexdigest()\n\nres = requests.post(\n    "${BASE_URL}/buy",\n    headers={\n        "Authorization": "Bearer ${K}",\n        "X-Swift-Signature": sig,\n        "Content-Type": "application/json",\n    },\n    data=body,\n)\nprint(res.json())`,
      php: `<?php\n$body = json_encode([\n    "network"      => "MTN",\n    "phone"        => "0241234567",\n    "package_size" => "5GB",\n]);\n\n$sig = hash_hmac("sha256", $body, $YOUR_SECRET_KEY);\n\n$ch = curl_init("${BASE_URL}/buy");\ncurl_setopt_array($ch, [\n    CURLOPT_POST       => true,\n    CURLOPT_POSTFIELDS => $body,\n    CURLOPT_HTTPHEADER => [\n        "Authorization: Bearer ${K}",\n        "X-Swift-Signature: $sig",\n        "Content-Type: application/json",\n    ],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    webhook_verify: {
      curl: `# Webhooks are verified server-side automatically.\n# Your endpoint will receive POST requests like:\n#\n# POST https://yourserver.com/webhooks/swiftdata\n# X-Swift-Signature: <hmac_sha256_of_body>\n# Content-Type: application/json\n#\n# {\n#   "event": "order.fulfilled",\n#   "order_id": "a3f2...",\n#   "status": "fulfilled",\n#   "network": "MTN",\n#   "amount": 22.00,\n#   "timestamp": "2026-05-16T10:00:00Z"\n# }`,
      node: `// Express.js webhook handler\napp.post("/webhooks/swiftdata", express.raw({ type: "application/json" }), (req, res) => {\n  const sig  = req.headers["x-swift-signature"];\n  const body = req.body.toString();\n\n  // Verify HMAC signature\n  const expected = crypto\n    .createHmac("sha256", process.env.SWIFT_WEBHOOK_SECRET)\n    .update(body)\n    .digest("hex");\n\n  if (sig !== expected) return res.status(401).send("Invalid signature");\n\n  const event = JSON.parse(body);\n  if (event.event === "order.fulfilled") {\n    console.log("Fulfilled:", event.order_id);\n  }\n  res.sendStatus(200);\n});`,
      python: `import hmac, hashlib\nfrom flask import Flask, request, abort\n\napp = Flask(__name__)\n\n@app.route("/webhooks/swiftdata", methods=["POST"])\ndef webhook():\n    sig      = request.headers.get("X-Swift-Signature", "")\n    body     = request.get_data()\n    expected = hmac.new(\n        SWIFT_WEBHOOK_SECRET.encode(),\n        body,\n        hashlib.sha256\n    ).hexdigest()\n\n    if not hmac.compare_digest(sig, expected):\n        abort(401)\n\n    event = request.json\n    print(event["event"], event["order_id"])\n    return "", 200`,
      php: `<?php\n$body     = file_get_contents("php://input");\n$sig      = $_SERVER["HTTP_X_SWIFT_SIGNATURE"] ?? "";\n$expected = hash_hmac("sha256", $body, SWIFT_WEBHOOK_SECRET);\n\nif (!hash_equals($expected, $sig)) {\n    http_response_code(401);\n    exit("Invalid signature");\n}\n\n$event = json_decode($body, true);\necho $event["event"]; // "order.fulfilled"`,
    },
    afa: {
      curl: `curl -X POST "${BASE_URL}/afa-registration" \\\n  -H "Authorization: Bearer ${K}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Idempotency-Key: unique_key_afa123" \\\n  -d '{\n    "afa_full_name": "Kwame Mensah",\n    "afa_ghana_card": "GHA-123456789-0",\n    "afa_occupation": "Teacher",\n    "afa_email": "kwame@example.com",\n    "afa_residence": "Accra",\n    "afa_date_of_birth": "1990-01-01",\n    "customer_phone": "0201234567",\n    "amount": 5.00,\n    "request_id": "afa_req_001"\n  }'`,
      node: `const res = await fetch("${BASE_URL}/afa-registration", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer ${K}",\n    "Content-Type": "application/json",\n    "X-Idempotency-Key": "unique_key_afa123",\n  },\n  body: JSON.stringify({\n    afa_full_name: "Kwame Mensah",\n    afa_ghana_card: "GHA-123456789-0",\n    afa_occupation: "Teacher",\n    afa_email: "kwame@example.com",\n    afa_residence: "Accra",\n    afa_date_of_birth: "1990-01-01",\n    customer_phone: "0201234567",\n    amount: 5.00,\n    request_id: "afa_req_001",\n  }),\n});\nconst data = await res.json();`,
      python: `import requests\n\nres = requests.post(\n    "${BASE_URL}/afa-registration",\n    headers={"Authorization": "Bearer ${K}", "X-Idempotency-Key": "unique_key_afa123"},\n    json={"afa_full_name": "Kwame Mensah", "afa_ghana_card": "GHA-123456789-0", "customer_phone": "0201234567", "amount": 5.00, "request_id": "afa_req_001"}\n)\nprint(res.json())`,
      php: `<?php\n$payload = json_encode(["afa_full_name" => "Kwame Mensah", "afa_ghana_card" => "GHA-123456789-0", "customer_phone" => "0201234567", "amount" => 5.00, "request_id" => "afa_req_001"]);\n$ch = curl_init("${BASE_URL}/afa-registration");\ncurl_setopt_array($ch, [\n    CURLOPT_POST => true,\n    CURLOPT_POSTFIELDS => $payload,\n    CURLOPT_HTTPHEADER => ["Authorization: Bearer ${K}", "Content-Type: application/json"],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
    results: {
      curl: `curl -X POST "${BASE_URL}/results-checker" \\\n  -H "Authorization: Bearer ${K}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "checker_type": "WASSCE",\n    "customer_phone": "0201234567",\n    "quantity": 1,\n    "amount": 17.00,\n    "request_id": "results_ref_001"\n  }'`,
      node: `const res = await fetch("${BASE_URL}/results-checker", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer ${K}",\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({\n    checker_type: "WASSCE",\n    customer_phone: "0201234567",\n    quantity: 1,\n    amount: 17.00,\n    request_id: "results_ref_001",\n  }),\n});\nconst data = await res.json();`,
      python: `import requests\n\nres = requests.post(\n    "${BASE_URL}/results-checker",\n    headers={"Authorization": "Bearer ${K}"},\n    json={\n        "checker_type": "WASSCE",\n        "customer_phone": "0201234567",\n        "quantity": 1,\n        "amount": 17.00,\n        "request_id": "results_ref_001",\n    },\n)\nprint(res.json())`,
      php: `<?php\n$payload = json_encode([\n    "checker_type" => "WASSCE",\n    "customer_phone" => "0201234567",\n    "quantity" => 1,\n    "amount" => 17.00,\n    "request_id" => "results_ref_001",\n]);\n$ch = curl_init("${BASE_URL}/results-checker");\ncurl_setopt_array($ch, [\n    CURLOPT_POST => true,\n    CURLOPT_POSTFIELDS => $payload,\n    CURLOPT_HTTPHEADER => [\n        "Authorization: Bearer ${K}",\n        "Content-Type: application/json",\n    ],\n    CURLOPT_RETURNTRANSFER => true,\n]);\necho curl_exec($ch);`,
    },
  };
};

// ─── Responses ────────────────────────────────────────────────────────────────
const RESPONSES: Record<string, string> = {
  service_status: `{\n  "success": true,\n  "services": [\n    {\n      "network": "mtn",\n      "display_name": "MTN Ghana",\n      "status": "operational",\n      "updated_at": "2026-06-12T00:30:00.000Z"\n    },\n    {\n      "network": "telecel",\n      "display_name": "Telecel Ghana",\n      "status": "maintenance",\n      "updated_at": "2026-06-12T00:35:00.000Z"\n    },\n    {\n      "network": "airteltigo",\n      "display_name": "AirtelTigo Ghana",\n      "status": "operational",\n      "updated_at": "2026-06-12T00:40:00.000Z"\n    }\n  ]\n}`,
  balance: `{\n  "success": true,\n  "balance": 50.00,\n  "currency": "GHS"\n}`,
  wallets_ok: `{\n  "success": true,\n  "wallets": {\n    "main": { "balance": 250.00, "currency": "GHS" },\n    "api":  { "balance": 100.00, "currency": "GHS" }\n  }\n}`,
  transfer_ok: `{\n  "success": true,\n  "message": "Transfer successful",\n  "from_balance": 150.00,\n  "to_balance":   200.00\n}`,
  account: `{\n  "success": true,\n  "name": "John Doe",\n  "balance": 250.00,\n  "apiKey": "sbp_live_abc123",\n  "active": true\n}`,
  plans: `{\n  "success": true,\n  "plans": [\n    {\n      "package_id": "yellow_5gb",\n      "network": "YELLO",\n      "package_size": "5GB",\n      "api_price": 22.00,\n      "is_unavailable": false\n    },\n    {\n      "package_id": "red_6gb",\n      "network": "RED",\n      "package_size": "6GB",\n      "api_price": 20.00,\n      "is_unavailable": false\n    }\n  ]\n}`,
  buy_ok: `{\n  "success": true,\n  "order_id": "a3f2b1c0-d4e5-6789-ab01-cd2345ef6789",\n  "status": "fulfilled",\n  "balance": 228.00\n}`,
  validate_ok: `{\n  "success": true,\n  "customerName": "JOHN DOE",\n  "validatedAmount": 41.00\n}`,
  bill_ok: `{\n  "success": true,\n  "transaction_id": "JBG_BILL_1234567890",\n  "cost": 41.00,\n  "balance": 209.00\n}`,
  ecg_lookup_ok: `{\n  "success": true,\n  "customerName": "JOHN DOE",\n  "validatedAmount": 20.00\n}`,
  ecg_ok: `{\n  "success": true,\n  "transaction_id": "JBG_ECG_1234567890",\n  "cost": 20.00,\n  "balance": 189.00\n}`,
  afa_ok: `{\n  "success": true,\n  "order_id": "a3f2b1c0-...",\n  "status": "pending",\n  "balance": 223.00\n}`,
  results_ok: `{\n  "success": true,\n  "order_id": "b4e3c2d1-...",\n  "status": "pending",\n  "balance": 198.00\n}`,
  voucher_purchase_200: `{\n  "success": true,\n  "message": "Voucher purchase completed",\n  "vouchers": [\n    {\n      "serial": "CMYJ3344",\n      "pin": "QDVB5566",\n      "type": "WASSCE Results Checker",\n      "price": 17,\n      "purchasedAt": "2025-11-14T15:12:11.123Z"\n    },\n    {\n      "serial": "GXZN7788",\n      "pin": "FHRK9900",\n      "type": "WASSCE Results Checker",\n      "price": 17,\n      "purchasedAt": "2025-11-14T15:12:11.123Z"\n    }\n  ],\n  "transactions": [\n    {\n      "id": "vt_abc123",\n      "userId": "usr_xyz",\n      "voucherTypeId": "type_1",\n      "amount": 17,\n      "recipientPhone": "0201234567",\n      "status": "COMPLETED",\n      "createdAt": "2025-11-14T15:12:11.123Z"\n    },\n    {\n      "id": "vt_abc124",\n      "userId": "usr_xyz",\n      "voucherTypeId": "type_1",\n      "amount": 17,\n      "recipientPhone": "0201234567",\n      "status": "COMPLETED",\n      "createdAt": "2025-11-14T15:12:11.123Z"\n    }\n  ],\n  "wallet": {\n    "balance": 24105.97\n  }\n}`,
  voucher_purchase_400: `{\n  "Missing voucherType": {\n    "success": false,\n    "error": "VoucherType is required (WASSCE or BECE)"\n  },\n  "Invalid recipient": {\n    "success": false,\n    "error": "Recipient must be a valid 10-digit phone number starting with 0"\n  },\n  "Quantity out of range": {\n    "success": false,\n    "error": "Quantity must be between 1 and 100"\n  }\n}`,
  voucher_purchase_401: `{\n  "success": false,\n  "error": "Invalid or inactive API key"\n}`,
  voucher_purchase_403: `{\n  "success": false,\n  "error": "API key is not linked to a user account. Please contact support."\n}`,
  voucher_purchase_404: `{\n  "success": false,\n  "error": "No available WASSCE vouchers in stock"\n}`,
  voucher_purchase_500: `{\n  "success": false,\n  "error": "Failed to complete voucher purchase"\n}`,
  order_status_200: `{\n  "success": true,\n  "message": "Order status retrieved successfully",\n  "data": {\n    "orderNumber": 123456,\n    "reference": "ORDER_123456_1635123456789",\n    "status": "PROCESSING",\n    "network": "MTN",\n    "recipient": "0201234567",\n    "dataAmount": "1GB",\n    "amountPaid": 7,\n    "orderDate": "2024-01-15T10:30:00Z",\n    "statusDescription": "Order sent to network provider, awaiting completion"\n  }\n}`,
  order_status_400: `{\n  "success": false,\n  "error": "Either 'reference' or 'orderNumber' is required"\n}`,
  order_status_401: `{\n  "success": false,\n  "error": "Invalid or inactive API key"\n}`,
  order_status_403: `{\n  "success": false,\n  "error": "API key is not linked to a user account. Please contact support."\n}`,
  order_status_404: `{\n  "By reference": {\n    "success": false,\n    "error": "Order not found with reference: ORDER_123456_1635123456789"\n  },\n  "By order number": {\n    "success": false,\n    "error": "Order not found with order number: 123456"\n  }\n}`,
  order_status_500: `{\n  "success": false,\n  "error": "Internal server error"\n}`,
  sms_ok: `{\n  "success": true,\n  "message": "SMS sent successfully"\n}`,
  orders_ok: `{\n  "success": true,\n  "total": 48,\n  "orders": [\n    {\n      "id": "a3f2b1c0-...",\n      "created_at": "2026-05-10T09:12:00Z",\n      "network": "MTN",\n      "package_size": "5GB",\n      "customer_phone": "0241234567",\n      "amount": 22.00,\n      "status": "fulfilled",\n      "profit": 2.00\n    }\n  ]\n}`,
  status_ok: `{\n  "success": true,\n  "order": {\n    "id": "a3f2b1c0-...",\n    "status": "fulfilled",\n    "network": "MTN",\n    "package_size": "5GB",\n    "customer_phone": "0241234567",\n    "amount": 22.00,\n    "profit": 2.00,\n    "created_at": "2026-05-10T09:12:00Z"\n  }\n}`,
  webhook_event: `{\n  "event": "order.fulfilled",\n  "order_id": "a3f2b1c0-...",\n  "status": "fulfilled",\n  "network": "MTN",\n  "package_size": "5GB",\n  "customer_phone": "0241234567",\n  "amount": 22.00,\n  "timestamp": "2026-05-16T10:00:00Z"\n}`,
  error_401: `{\n  "success": false,\n  "error": "Invalid API key"\n}`,
  error_402: `{\n  "success": false,\n  "error": "Insufficient balance"\n}`,
  error_409: `{\n  "success": false,\n  "error": "Duplicate order detected. Please wait 60 seconds before placing the same order again. Pass 'allow_duplicate': true to bypass."\n}`,
  error_429: `{\n  "success": false,\n  "error": "Rate limit exceeded."\n}`,
  error_500: `{\n  "success": false,\n  "error": "Internal Server Error",\n  "reference": "ERR-7f3a2b1c"\n}`,
};


// ─── Reusable components ──────────────────────────────────────────────────────
function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className={`p-1.5 rounded-lg bg-white/5 hover:bg-white/15 transition-colors ${className}`}
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-white/40" />}
    </button>
  );
}

function CodeBlock({ code, label, className = "" }: { code: string; label?: string; className?: string }) {
  return (
    <div className={`relative rounded-xl bg-[#080810] border border-white/8 overflow-hidden ${className}`}>
      {label && (
        <div className="px-4 py-2 bg-white/[0.03] border-b border-white/5 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">{label}</span>
          <CopyButton text={code} />
        </div>
      )}
      {!label && <CopyButton text={code} className="absolute top-3 right-3 z-10" />}
      <pre className="p-5 text-xs font-mono text-emerald-300/85 leading-relaxed overflow-x-auto whitespace-pre pr-12">{code}</pre>
    </div>
  );
}

function ResponseBlock({ code, label, variant = "success" }: { code: string; label?: string; variant?: "success" | "error" }) {
  const color = variant === "error" ? "text-red-300/85" : "text-sky-300/85";
  return (
    <div className="relative rounded-xl bg-[#080810] border border-white/8 overflow-hidden">
      {label && (
        <div className="px-4 py-2 bg-white/[0.03] border-b border-white/5 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">{label}</span>
          <CopyButton text={code} />
        </div>
      )}
      {!label && <CopyButton text={code} className="absolute top-3 right-3 z-10" />}
      <pre className={`p-5 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre pr-12 ${color}`}>{code}</pre>
    </div>
  );
}

function MethodBadge({ method }: { method: "GET" | "POST" }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold font-mono ${method === "GET" ? "bg-sky-500/15 text-sky-300 border border-sky-500/20" : "bg-amber-500/15 text-amber-300 border border-amber-500/20"}`}>
      {method}
    </span>
  );
}

function ParamRow({ name, type, required, desc }: { name: string; type: string; required: boolean; desc: string }) {
  return (
    <div className="flex flex-col md:grid md:grid-cols-12 md:gap-3 px-4 py-4 md:py-3 text-xs border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors gap-2">
      <div className="md:col-span-3 flex items-center justify-between md:block">
        <span className="font-mono text-amber-300 font-bold md:font-semibold">{name}</span>
        <div className="md:hidden">
          {required
            ? <span className="text-red-400 font-black text-[9px] uppercase tracking-widest bg-red-400/10 px-2 py-0.5 rounded border border-red-400/20">Required</span>
            : <span className="text-white/25 text-[9px] uppercase tracking-widest bg-white/5 px-2 py-0.5 rounded border border-white/10">Optional</span>}
        </div>
      </div>
      <div className="md:col-span-2 text-sky-400 font-mono flex items-center gap-2 md:block">
        <span className="md:hidden text-white/20 font-sans text-[9px] uppercase">Type:</span>
        {type}
      </div>
      <div className="hidden md:col-span-2 md:block">
        {required
          ? <span className="text-red-400 font-bold text-[10px] uppercase tracking-wide">Required</span>
          : <span className="text-white/25 text-[10px] uppercase tracking-wide">Optional</span>}
      </div>
      <div className="md:col-span-5 text-white/50 md:text-white/45 leading-relaxed">{desc}</div>
    </div>
  );
}

function SectionAnchor({ id }: { id: string }) {
  return <span id={id} className="block -mt-20 pt-20 invisible absolute" />;
}

function SectionHeader({ icon: Icon, title }: { icon: React.FC<any>; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-white/40" />
      </div>
      <h2 className="text-2xl font-black">{title}</h2>
    </div>
  );
}

// ─── Sidebar nav ──────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: "overview",        label: "Overview",           icon: BookOpen },
  { id: "authentication",  label: "Authentication",      icon: Key },
  { id: "account",         label: "Account Details",     icon: Activity },
  { id: "balance",         label: "Check Balance",       icon: Activity },
  { id: "wallets",         label: "All Wallets",         icon: Database },
  { id: "transfer",        label: "Wallet Transfer",     icon: ArrowLeftRight },
  { id: "plans",           label: "List Plans",          icon: List },
  { id: "service-status",  label: "Service Status",      icon: Activity },
  { id: "airtime",         label: "Purchase Airtime",    icon: ShoppingCart },
  { id: "data",            label: "Data Bundles",        icon: ShoppingCart },
  { id: "afa",             label: "AFA Registration",    icon: Activity },
  { id: "results",         label: "Voucher Purchase",     icon: ShoppingCart },
  { id: "bills-validate",  label: "Validate TV Bills",   icon: Search },
  { id: "bills-pay",       label: "Pay TV Bills",        icon: CreditCard },
  { id: "ecg-lookup",      label: "ECG Lookup",          icon: Search },
  { id: "ecg-pay",         label: "Pay ECG",             icon: Zap },
  { id: "sms",             label: "Send SMS",            icon: Zap },
  { id: "orders",          label: "Order History",       icon: List },
  { id: "status",          label: "Order Status",        icon: Activity },
  { id: "webhooks",        label: "Webhooks",            icon: Globe },
  { id: "rate-limits",     label: "Rate Limits",         icon: Gauge },
  { id: "errors",          label: "Error Reference",     icon: AlertTriangle },
  { id: "best-practices",  label: "Best Practices",      icon: Shield },
];


// ─── Main Page ────────────────────────────────────────────────────────────────
const APIDocumentation = () => {
  useToast();
  const { profile } = useAuth();
  const [activeLang, setActiveLang] = useState<Lang>("curl");
  const [activeSection, setActiveSection] = useState("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [serviceStatuses, setServiceStatuses] = useState<any[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const defaultStatuses = [
    { network: "mtn", display_name: "MTN Ghana", status: "operational" },
    { network: "telecel", display_name: "Telecel Ghana", status: "operational" },
    { network: "airteltigo", display_name: "AirtelTigo Ghana", status: "operational" },
  ];

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const { data, error } = await supabase
          .from("service_status")
          .select("*")
          .order("network");
        if (!error && data) {
          setServiceStatuses(data);
        }
      } catch (err) {
        console.error("Failed to load service status:", err);
      } finally {
        setLoadingStatus(false);
      }
    };

    fetchStatus();

    // Subscribe to real-time status updates
    const channel = supabase
      .channel("service-status-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "service_status" }, () => {
        fetchStatus();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const userApiKey = profile?.api_key || null;
  const snippets = makeSnippets(userApiKey);

  useEffect(() => {
    const onScroll = () => {
      const offsets = NAV_ITEMS.map(({ id }) => {
        const el = document.getElementById(id);
        return { id, top: el ? el.getBoundingClientRect().top : Infinity };
      });
      const active = offsets.filter(({ top }) => top <= 120).slice(-1)[0];
      if (active) setActiveSection(active.id);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMobileNavOpen(false);
  };

  const Sidebar = () => (
    <nav className="space-y-0.5">
      <div className="flex items-center gap-2 px-3 py-3 mb-3 border-b border-white/5">
        <div className="w-7 h-7 rounded-lg bg-sky-400/15 border border-sky-400/25 flex items-center justify-center">
          <Code2 className="w-3.5 h-3.5 text-sky-400" />
        </div>
        <div>
          <p className="text-xs font-black text-white tracking-tight leading-none">SwiftData API</p>
          <p className="text-[9px] text-white/30 uppercase tracking-widest mt-0.5">v2.0 REST</p>
        </div>
      </div>
      <p className="px-3 pb-1 text-[9px] font-bold uppercase tracking-widest text-white/20">Reference</p>
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          type="button"
          key={id}
          onClick={() => scrollTo(id)}
          className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
            activeSection === id
              ? "bg-sky-400/10 text-sky-300 border border-sky-400/20"
              : "text-white/40 hover:text-white/70 hover:bg-white/5"
          }`}
        >
          <Icon className="w-3.5 h-3.5 shrink-0" />
          {label}
          {activeSection === id && <ChevronRight className="w-3 h-3 ml-auto text-sky-400/60" />}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#030305] text-white selection:bg-sky-400/25">

      {/* Top bar */}
      <div className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#030305]/95 backdrop-blur-xl">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setMobileNavOpen(!mobileNavOpen)} className="lg:hidden p-1.5 rounded-lg hover:bg-white/10 transition-colors">
              {mobileNavOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
            <Link to="/dashboard/api" className="flex items-center gap-2 text-white/40 hover:text-white/80 transition-colors text-sm">
              <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Dashboard</span>
            </Link>
          </div>

          <div className="flex items-center gap-1 p-1 bg-white/5 rounded-xl border border-white/8">
            {LANGS.map((l) => (
              <button
                type="button"
                key={l}
                onClick={() => setActiveLang(l)}
                className={`px-3 py-1 text-xs rounded-lg font-mono font-bold transition-all ${
                  activeLang === l ? "bg-sky-400 text-black shadow-sm" : "text-white/35 hover:text-white/70"
                }`}
              >
                {LANG_LABELS[l]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-sky-500/20 text-sky-400 text-[10px]">v2.0 REST</Badge>
          </div>
        </div>
      </div>

      <div className="flex max-w-[1400px] mx-auto pt-14">
        <aside className="hidden lg:block w-64 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto p-4 border-r border-white/5">
          <Sidebar />
        </aside>

        {/* Mobile Sidebar Overlay */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-[60] lg:hidden animate-in fade-in duration-300">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setMobileNavOpen(false)} />
            <div className="absolute top-0 left-0 bottom-0 w-72 bg-[#08080a] border-r border-white/10 p-4 shadow-2xl animate-in slide-in-from-left duration-300">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-sky-400/20 flex items-center justify-center">
                    <Code2 className="w-4 h-4 text-sky-400" />
                  </div>
                  <span className="font-black tracking-tight">API Docs</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  title="Close menu"
                  className="p-2 rounded-xl bg-white/5 border border-white/10"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <Sidebar />
            </div>
          </div>
        )}

        <main ref={scrollRef} className="flex-1 min-w-0 px-4 md:px-8 lg:px-12 xl:px-16 py-8 md:py-12 pb-32 space-y-20 md:space-y-24">

          {/* ── Overview ─────────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="overview" />
            <div className="flex items-start justify-between gap-4 mb-8">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-sky-400/10 border border-sky-400/20 rounded-full text-xs font-bold text-sky-400 mb-4">
                  <Zap className="w-3 h-3" /> SwiftData Developers · REST API
                </div>
                <h1 className="text-4xl lg:text-5xl font-black tracking-tight leading-none mb-4">
                  SwiftData Ghana<br />
                  <span className="bg-gradient-to-r from-sky-400 via-blue-400 to-sky-500 bg-clip-text text-transparent">
                    API Reference
                  </span>
                </h1>
                <p className="text-white/50 text-lg max-w-2xl leading-relaxed">
                  Integrate airtime, data bundles, bill payments, SMS, and wallet management into your applications.
                  RESTful, secure, and built for scale.
                </p>
              </div>
            </div>

            {/* Base URL */}
            <div className="rounded-xl border border-white/8 overflow-hidden bg-white/[0.02] mb-8">
              <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Base URL</span>
                <CopyButton text={BASE_URL} />
              </div>
              <div className="px-5 py-4 flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <code className="text-sm font-mono text-emerald-300 break-all">{BASE_URL}</code>
              </div>
            </div>

            {/* Live Service & Speed Status */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
              {/* ISP Gateways Status */}
              <div className="lg:col-span-7 rounded-xl border border-white/8 overflow-hidden bg-[#080810]/40 flex flex-col justify-between">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">ISP Gateways Status</span>
                  <span className="text-[9px] text-emerald-400 font-bold uppercase flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                    Real-time
                  </span>
                </div>
                <div className="p-4 sm:p-5 flex-1 flex flex-col justify-center gap-3.5">
                  {(serviceStatuses.length > 0 ? serviceStatuses : defaultStatuses).map((net) => {
                    const getStatusStyles = (status: string) => {
                      switch (status) {
                        case "down":
                          return {
                            bg: "bg-red-500/10 border-red-500/20 text-red-400",
                            dot: "bg-red-500",
                            label: "Offline",
                          };
                        case "maintenance":
                          return {
                            bg: "bg-amber-500/10 border-amber-500/20 text-amber-400",
                            dot: "bg-amber-500",
                            label: "Maintenance",
                          };
                        default:
                          return {
                            bg: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
                            dot: "bg-emerald-500",
                            label: "Operational",
                          };
                      }
                    };
                    const styles = getStatusStyles(net.status);
                    return (
                      <div
                        key={net.network}
                        className={cn(
                          "p-3 rounded-xl border flex items-center justify-between transition-all duration-300",
                          net.status === "down" ? "border-red-500/20 bg-red-500/[0.02]" :
                          net.status === "maintenance" ? "border-amber-500/20 bg-amber-500/[0.02]" :
                          "border-white/5 bg-white/[0.01] hover:bg-white/[0.02]"
                        )}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-bold text-xs text-white/80">{net.display_name}</span>
                          <span className="text-[9px] text-white/45 font-medium uppercase font-mono tracking-wider">{net.network} gateway</span>
                        </div>
                        <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider border shrink-0", styles.bg)}>
                          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", styles.dot, net.status === "operational" && "animate-pulse")} />
                          {styles.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Live Delivery Speed Card */}
              <div className="lg:col-span-5 flex flex-col justify-stretch">
                <LastMtnOrderWidget variant="card" className="h-full" />
              </div>
            </div>

            {/* Quick reference table */}
            <div className="rounded-xl border border-white/8 overflow-hidden">
              <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Endpoint Summary</span>
              </div>
              {[
                { method: "GET",  path: "/account",               desc: "Get account profile" },
                { method: "GET",  path: "/balance",               desc: "Main + API wallet balance" },
                { method: "GET",  path: "/wallets",               desc: "Full wallet breakdown" },
                { method: "POST", path: "/wallet/transfer",       desc: "Move funds between wallets" },
                { method: "GET",  path: "/plans",                 desc: "Available data packages & prices" },
                { method: "GET",  path: "/service-status",        desc: "Get live ISP gateway statuses" },
                { method: "POST", path: "/buy",                   desc: "Purchase airtime or data bundle" },
                { method: "POST", path: "/afa-registration",      desc: "Register AFA SIM card" },
                { method: "POST", path: "/results-checker",       desc: "Buy WASSCE/BECE results checker vouchers" },
                { method: "POST", path: "/payment/bills/validate",desc: "Validate TV bill account" },
                { method: "POST", path: "/payment/bills/pay",     desc: "Pay TV bill" },
                { method: "POST", path: "/payment/ecg/lookup",    desc: "Validate ECG meter" },
                { method: "POST", path: "/payment/ecg",           desc: "Pay ECG bill" },
                { method: "POST", path: "/sms",                   desc: "Send transactional SMS" },
                { method: "GET",  path: "/orders",                desc: "Paginated order history with filters" },
                { method: "GET",  path: "/status",                desc: "Check single order status" },
              ].map(({ method, path, desc }) => (
                <div key={path} className="flex flex-col sm:grid sm:grid-cols-12 sm:gap-2 px-4 py-3 text-xs border-b border-white/5 last:border-0 hover:bg-white/[0.02] gap-1">
                  <div className="sm:col-span-1">
                    <MethodBadge method={method as "GET" | "POST"} />
                  </div>
                  <div className="sm:col-span-5 font-mono text-amber-300 font-semibold sm:pl-2">{path}</div>
                  <div className="sm:col-span-6 text-white/40">{desc}</div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Authentication ───────────────────────────────────────── */}
          <section>
            <SectionAnchor id="authentication" />
            <SectionHeader icon={Key} title="Authentication" />
            <p className="text-white/45 text-sm mb-6 md:ml-11 max-w-xl">
              All requests require a Bearer token in the <code className="text-amber-300 bg-white/5 px-1.5 py-0.5 rounded-md">Authorization</code> header.
              Optionally sign POST bodies with HMAC-SHA256 for tamper-proof requests.
            </p>

            <div className="ml-11 space-y-6">
              {/* Auth header */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/20">Required Header</p>
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/8">
                  <code className="text-sky-400 text-xs">Authorization: Bearer {userApiKey || "swft_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}</code>
                </div>
              </div>

              {/* Idempotency key */}
              <div className="rounded-xl border border-sky-500/15 bg-sky-500/5 p-4 flex gap-3">
                <RefreshCw className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-sky-300 mb-1">Idempotency Key <span className="font-normal text-white/30">(recommended for POST)</span></p>
                  <p className="text-[11px] text-white/40 leading-relaxed mb-2">Pass <code className="text-amber-300 bg-white/5 px-1 rounded">X-Idempotency-Key: &lt;unique_id&gt;</code> on every POST request. If your network drops and you retry, the server returns the original result without double-charging.</p>
                  <code className="text-[10px] font-mono text-white/30">X-Idempotency-Key: order_20260516_abc123</code>
                </div>
              </div>

              {/* HMAC signing */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/20 mb-3">Optional — HMAC Request Signing</p>
                <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-4 flex gap-3 mb-4">
                  <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-amber-300 mb-1">How it works</p>
                    <ol className="text-[11px] text-white/40 leading-relaxed space-y-1 list-decimal list-inside">
                      <li>Retrieve your <strong className="text-white/60">Secret Key</strong> from the Developer dashboard.</li>
                      <li>Compute <code className="text-amber-300 bg-white/5 px-1 rounded">HMAC-SHA256(secret, raw_body_string)</code>.</li>
                      <li>Send the hex digest in the <code className="text-amber-300 bg-white/5 px-1 rounded">X-Swift-Signature</code> header.</li>
                    </ol>
                    <p className="text-[11px] text-white/30 mt-2 italic">Skipped automatically when Test Mode is enabled.</p>
                  </div>
                </div>
                <CodeBlock code={snippets.hmac[activeLang]} label="HMAC Signing Example" />
              </div>

              {/* Test mode */}
              <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-4 flex gap-3">
                <Zap className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-emerald-300 mb-1">Test Mode</p>
                  <p className="text-[11px] text-white/40 leading-relaxed">Enable <strong className="text-white/60">Test Mode</strong> in your dashboard to bypass signature checks and fulfillment. Orders are created in the database but no real data is sent. Responses are identical to production.</p>
                </div>
              </div>

              {/* Production security */}
              <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 flex gap-3">
                <Lock className="w-4 h-4 text-white/30 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-white/60 mb-1">Production Security</p>
                  <p className="text-[11px] text-white/40 leading-relaxed">Never expose API keys in client-side code. Always proxy calls through your own backend server.</p>
                </div>
              </div>
            </div>
          </section>

          {/* ── Account Details ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="account" />
            <SectionHeader icon={Activity} title="Account Details" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-6">
              <MethodBadge method="GET" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/account</code>
            </div>
            <div className="grid lg:grid-cols-2 gap-6 ml-11">
              <CodeBlock code={snippets.account[activeLang]} label="Request" />
              <ResponseBlock code={RESPONSES.account} label="Response · 200 OK" />
            </div>
          </section>

          {/* ── Check Balance ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="balance" />
            <SectionHeader icon={Activity} title="Check Wallet Balance" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-4">
              <MethodBadge method="GET" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/balance</code>
            </div>
            <p className="text-white/40 text-sm mb-6 ml-11 max-w-xl">Returns both your main wallet balance and your API wallet balance in one call.</p>
            <div className="grid lg:grid-cols-2 gap-6 ml-11">
              <CodeBlock code={snippets.balance[activeLang]} label="Request" />
              <ResponseBlock code={RESPONSES.balance} label="Response · 200 OK" />
            </div>
          </section>

          {/* ── All Wallets ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="wallets" />
            <SectionHeader icon={Database} title="All Wallets" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-4">
              <MethodBadge method="GET" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/wallets</code>
            </div>
            <p className="text-white/40 text-sm mb-6 ml-11 max-w-xl">
              Returns a structured breakdown of all wallet types. Useful for building balance displays in your app.
              Your account has two wallets: <code className="text-amber-300 bg-white/5 px-1.5 py-0.5 rounded-md">main</code> (funded via Paystack) and <code className="text-amber-300 bg-white/5 px-1.5 py-0.5 rounded-md">api</code> (funded via transfer from main).
            </p>
            <div className="grid lg:grid-cols-2 gap-6 ml-11">
              <CodeBlock code={snippets.wallets[activeLang]} label="Request" />
              <ResponseBlock code={RESPONSES.wallets_ok} label="Response · 200 OK" />
            </div>
          </section>

          {/* ── Wallet Transfer ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="transfer" />
            <SectionHeader icon={ArrowLeftRight} title="Wallet Transfer" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-4">
              <MethodBadge method="POST" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/wallet/transfer</code>
            </div>
            <p className="text-white/40 text-sm mb-6 ml-11 max-w-xl">
              Move funds between your <code className="text-amber-300 bg-white/5 px-1.5 py-0.5 rounded-md">main</code> and <code className="text-amber-300 bg-white/5 px-1.5 py-0.5 rounded-md">api</code> wallets.
              API purchases are charged from the <strong className="text-white/60">api</strong> wallet only — ensure it has sufficient funds before fulfillment.
            </p>
            <div className="ml-11 space-y-6">
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Body Parameters</span>
                </div>
                <ParamRow name="from"   type="string" required desc='"main" or "api" — source wallet' />
                <ParamRow name="to"     type="string" required desc='"main" or "api" — destination wallet' />
                <ParamRow name="amount" type="number" required desc="GHS amount to transfer (must be > 0)" />
              </div>
              <div className="grid lg:grid-cols-2 gap-6">
                <CodeBlock code={snippets.transfer[activeLang]} label="Request" />
                <ResponseBlock code={RESPONSES.transfer_ok} label="Response · 200 OK" />
              </div>
            </div>
          </section>

          {/* ── List Plans ─────────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="plans" />
            <SectionHeader icon={List} title="List Data Plans" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-4">
              <MethodBadge method="GET" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/plans</code>
            </div>
            <p className="text-white/40 text-sm mb-6 ml-11 max-w-xl">
              Returns all available data packages with your API pricing. Packages marked <code className="text-amber-300 bg-white/5 px-1.5 py-0.5 rounded-md">is_unavailable: true</code> cannot be purchased.
              Always call this before building a package selection UI.
            </p>
            <div className="grid lg:grid-cols-2 gap-6 ml-11">
              <CodeBlock code={snippets.plans[activeLang]} label="Request" />
              <ResponseBlock code={RESPONSES.plans} label="Response · 200 OK" />
            </div>
          </section>

          {/* ── Service Status ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="service-status" />
            <SectionHeader icon={Activity} title="Service Status" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-4">
              <MethodBadge method="GET" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/service-status</code>
            </div>
            <p className="text-white/40 text-sm mb-6 ml-11 max-w-xl">
              Returns the real-time operational status of all registered ISP gateways. Use this to dynamically warn or disable specific network purchases in your application when a gateway goes offline or undergoes maintenance.
            </p>
            <div className="grid lg:grid-cols-2 gap-6 ml-11">
              <CodeBlock code={snippets.service_status[activeLang]} label="Request" />
              <ResponseBlock code={RESPONSES.service_status} label="Response · 200 OK" />
            </div>
          </section>

          {/* ── Airtime ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="airtime" />
            <SectionHeader icon={ShoppingCart} title="Purchase Airtime" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-6">
              <MethodBadge method="POST" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/payment/airtime</code>
            </div>

            <div className="ml-11 space-y-8">
              {/* Parameters table */}
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Body Parameters</span>
                </div>
                <ParamRow name="network"      type="string" required      desc="MTN · TELECEL · AT · GLO" />
                <ParamRow name="phone"        type="string" required      desc="Recipient phone number (e.g. 0241234567)" />
                <ParamRow name="amount"       type="number" required      desc="GHS amount to top-up" />
                <ParamRow name="request_id"   type="string" required={false} desc="Your custom tracking reference. Mapped to client_reference in webhook notifications." />
                <ParamRow name="allow_duplicate" type="boolean" required={false} desc="Set to true to bypass the 60-second duplicate safety block for identical rapid-fire orders." />
              </div>

              {/* Airtime example */}
              <div>
                <div className="grid lg:grid-cols-2 gap-6">
                  <CodeBlock code={snippets.airtime[activeLang]} label="Request" />
                  <ResponseBlock code={RESPONSES.buy_ok} label="Response · 200 OK" />
                </div>
              </div>
            </div>
          </section>

          {/* ── Data Bundle ────────────────────────────────────────── */}
          <section className="pt-8">
            <SectionAnchor id="data" />
            <SectionHeader icon={ShoppingCart} title="Purchase Data Bundle" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-6">
              <MethodBadge method="POST" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/payment/data</code>
            </div>

            <div className="ml-11 space-y-8">
              {/* Parameters table */}
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Body Parameters</span>
                </div>
                <ParamRow name="package_id"   type="string" required      desc="Smart bundle ID from /plans (e.g. yellow_5gb)" />
                <ParamRow name="phone"        type="string" required      desc="Recipient phone number (e.g. 0241234567)" />
                <ParamRow name="request_id"   type="string" required={false} desc="Your custom tracking reference. Mapped to client_reference in webhook notifications." />
                <ParamRow name="allow_duplicate" type="boolean" required={false} desc="Set to true to bypass the 60-second duplicate safety block for identical rapid-fire orders." />
              </div>

              {/* Data example */}
              <div>
                <div className="grid lg:grid-cols-2 gap-6">
                  <CodeBlock code={snippets.data[activeLang]} label="Request" />
                  <ResponseBlock code={RESPONSES.buy_ok} label="Response · 200 OK" />
                </div>
              </div>

              {/* Order status lifecycle */}
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Order Status Lifecycle (Applies to both Airtime and Data)</span>
                </div>
                {[
                  { status: "pending",            color: "text-yellow-400",  desc: "Created — awaiting payment confirmation" },
                  { status: "paid",               color: "text-sky-400",     desc: "Payment confirmed — queued for fulfillment" },
                  { status: "processing",         color: "text-blue-400",    desc: "Sent to network provider" },
                  { status: "fulfilled",          color: "text-emerald-400", desc: "Delivered to recipient successfully" },
                  { status: "fulfillment_failed", color: "text-red-400",     desc: "Provider returned an error — wallet refunded" },
                ].map(({ status, color, desc }) => (
                  <div key={status} className="flex items-center gap-4 px-4 py-3 text-xs border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <code className={`font-mono font-bold w-36 shrink-0 ${color}`}>{status}</code>
                    <span className="text-white/40">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── AFA Registration ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="afa" />
            <SectionHeader icon={Activity} title="AFA Registration" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-4">
              <MethodBadge method="POST" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/afa-registration</code>
            </div>
            <p className="text-white/45 text-sm mb-6 ml-11 max-w-xl">Register AFA SIM cards by submitting the customer's full name, Ghana card, occupation, email, residence, date of birth, phone, and payment amount.</p>
            <div className="ml-11 space-y-6">
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Body Parameters</span>
                </div>
                <ParamRow name="afa_full_name"    type="string" required desc="Full name on Ghana card" />
                <ParamRow name="afa_ghana_card"   type="string" required desc="Ghana card number (GHA-XXXXXXXXX-X)" />
                <ParamRow name="customer_phone"   type="string" required desc="Customer phone number" />
                <ParamRow name="amount"           type="number" required desc="Amount to register (GHS)" />
                <ParamRow name="request_id"       type="string" required={false} desc="Unique tracking ID" />
                <ParamRow name="afa_occupation"   type="string" required={false} desc="Customer occupation (e.g. Teacher)" />
                <ParamRow name="afa_email"        type="string" required={false} desc="Customer email address" />
                <ParamRow name="afa_residence"    type="string" required={false} desc="Customer residential address" />
                <ParamRow name="afa_date_of_birth" type="string" required={false} desc="Customer date of birth (YYYY-MM-DD)" />
              </div>
              <div className="grid lg:grid-cols-2 gap-6">
                <CodeBlock code={snippets.afa[activeLang]} label="Request" />
                <ResponseBlock code={RESPONSES.afa_ok} label="Response · 200 OK" />
              </div>
            </div>
          </section>

          {/* ── Voucher Purchase (Results Checker) ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="results" />
            <SectionHeader icon={ShoppingCart} title="Voucher Purchase" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-4">
              <MethodBadge method="POST" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/results-checker</code>
            </div>
            <p className="text-white/45 text-sm mb-6 ml-11 max-w-xl">Purchase WASSCE/BECE result checker vouchers using your API key.</p>
            <div className="ml-11 space-y-6">
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Body Parameters</span>
                </div>
                <ParamRow name="checker_type"   type="string" required desc="WASSCE or BECE" />
                <ParamRow name="customer_phone" type="string" required desc="Recipient phone number (e.g. 0241234567)" />
                <ParamRow name="quantity"       type="number" required desc="Quantity of vouchers to purchase (1 to 100)" />
                <ParamRow name="amount"         type="number" required desc="Total GHS cost amount" />
                <ParamRow name="request_id"     type="string" required={false} desc="Unique tracking reference ID" />
              </div>
              <div className="space-y-4">
                <p className="text-xs font-bold uppercase tracking-widest text-sky-400 mb-2">Request Example</p>
                <CodeBlock code={snippets.results[activeLang]} label="Request" />
              </div>
              <div className="space-y-4">
                <p className="text-xs font-bold uppercase tracking-widest text-white/20 mb-2">Response Examples</p>
                <div className="grid lg:grid-cols-2 gap-6">
                  <ResponseBlock code={RESPONSES.voucher_purchase_200} label="Response · 200 OK" />
                  <ResponseBlock code={RESPONSES.voucher_purchase_400} variant="error" label="Response · 400 Bad Request" />
                </div>
                <div className="grid lg:grid-cols-2 gap-6">
                  <ResponseBlock code={RESPONSES.voucher_purchase_401} variant="error" label="Response · 401 Unauthorized" />
                  <ResponseBlock code={RESPONSES.voucher_purchase_403} variant="error" label="Response · 403 Forbidden" />
                </div>
                <div className="grid lg:grid-cols-2 gap-6">
                  <ResponseBlock code={RESPONSES.voucher_purchase_404} variant="error" label="Response · 404 Not Found" />
                  <ResponseBlock code={RESPONSES.voucher_purchase_500} variant="error" label="Response · 500 Server Error" />
                </div>
              </div>
            </div>
          </section>

          {/* ── Bill Validation ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="bills-validate" />
            <SectionHeader icon={Search} title="Validate Utility Bill" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-6">
              <MethodBadge method="POST" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/payment/bills/validate</code>
            </div>
            <div className="ml-11 space-y-6">
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Body Parameters</span>
                </div>
                <ParamRow name="customerNumber" type="string" required desc="Smartcard or account number" />
                <ParamRow name="billType"       type="string" required desc="DSTV | GOTV | STARTIMES | ECG" />
              </div>
              <div className="grid lg:grid-cols-2 gap-6">
                <CodeBlock code={snippets.validate[activeLang]} label="Request" />
                <ResponseBlock code={RESPONSES.validate_ok} label="Response · 200 OK" />
              </div>
            </div>
          </section>

          {/* ── Pay Bill ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="bills-pay" />
            <SectionHeader icon={CreditCard} title="Pay Utility Bill" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-4">
              <MethodBadge method="POST" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/payment/bills</code>
            </div>
            <div className="ml-11 space-y-6">
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Body Parameters</span>
                </div>
                <ParamRow name="customerNumber" type="string" required desc="Smartcard or account number" />
                <ParamRow name="billType"       type="string" required desc="DSTV | GOTV | STARTIMES | ECG" />
                <ParamRow name="amount"         type="number" required desc="Amount in GHS" />
                <ParamRow name="senderName"     type="string" required desc="Customer full name from lookup" />
              </div>
              <div className="grid lg:grid-cols-2 gap-6">
                <CodeBlock code={snippets.bill[activeLang]} label="Request" />
                <ResponseBlock code={RESPONSES.bill_ok} label="Response · 200 OK" />
              </div>
            </div>
          </section>

          {/* ── Pay ECG ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="ecg-pay" />
            <SectionHeader icon={Zap} title="Pay ECG" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-4">
              <MethodBadge method="POST" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/payment/ecg</code>
            </div>
            <div className="ml-11 space-y-6">
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Body Parameters</span>
                </div>
                <ParamRow name="phoneNumber"    type="string" required desc="Phone number in 233XXXXXXXXX format" />
                <ParamRow name="accountNumber"  type="string" required desc="ECG meter or account number" />
                <ParamRow name="amount"         type="number" required desc="Amount in GHS" />
              </div>
              <div className="grid lg:grid-cols-2 gap-6">
                <CodeBlock code={snippets.ecg_pay[activeLang]} label="Request" />
                <ResponseBlock code={RESPONSES.ecg_ok} label="Response · 200 OK" />
              </div>
            </div>
          </section>

          {/* ── Send SMS ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="sms" />
            <SectionHeader icon={Zap} title="Send SMS" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-4">
              <MethodBadge method="POST" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/sms</code>
            </div>
            <p className="text-white/45 text-sm mb-6 ml-11 max-w-xl">Send transactional SMS to any Ghana number. Common use: notify customers after data purchase. Charge: <code className="text-amber-400">0.05 GHS</code> per message, deducted from your API wallet.</p>
            <div className="ml-11 space-y-6">
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Body Parameters</span>
                </div>
                <ParamRow name="to"       type="string" required      desc="Recipient phone number (e.g. 0241234567)" />
                <ParamRow name="message"  type="string" required      desc="Message body (max 160 chars per SMS segment)" />
                <ParamRow name="senderId" type="string" required={false} desc='Sender ID shown to recipient (default: "SwiftData")' />
              </div>
              <div className="grid lg:grid-cols-2 gap-6">
                <CodeBlock code={snippets.sms[activeLang]} label="Request" />
                <ResponseBlock code={RESPONSES.sms_ok} label="Response · 200 OK" />
              </div>
            </div>
          </section>

          {/* ── Order History ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="orders" />
            <SectionHeader icon={List} title="Order History" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-4">
              <MethodBadge method="GET" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/orders</code>
            </div>
            <p className="text-white/40 text-sm mb-6 ml-11 max-w-xl">
              Returns paginated orders in reverse-chronological order. Combine <code className="text-amber-300 bg-white/5 px-1.5 py-0.5 rounded-md">offset</code> with <code className="text-amber-300 bg-white/5 px-1.5 py-0.5 rounded-md">limit</code> to page through large histories. Filter by <code className="text-amber-300 bg-white/5 px-1.5 py-0.5 rounded-md">status</code> and <code className="text-amber-300 bg-white/5 px-1.5 py-0.5 rounded-md">network</code> to narrow results.
            </p>
            <div className="ml-11 space-y-6">
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Query Parameters</span>
                </div>
                <ParamRow name="limit"   type="number"  required={false} desc="Max orders to return (default: 20, max: 100)" />
                <ParamRow name="offset"  type="number"  required={false} desc="Number of orders to skip — use for pagination (default: 0)" />
                <ParamRow name="status"  type="string"  required={false} desc="Filter: pending · paid · processing · fulfilled · fulfillment_failed" />
                <ParamRow name="network" type="string"  required={false} desc="Filter: MTN · TELECEL · AT · GLO" />
              </div>

              {/* Basic example */}
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-sky-400 mb-3">Basic — Latest 20 Orders</p>
                <div className="grid lg:grid-cols-2 gap-6">
                  <CodeBlock code={snippets.orders[activeLang]} label="Request" />
                  <ResponseBlock code={RESPONSES.orders_ok} label="Response · 200 OK" />
                </div>
              </div>

              {/* Filtered example */}
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-amber-400 mb-3">Filtered — Page 3 of MTN Fulfilled Orders</p>
                <CodeBlock code={snippets.orders_filtered[activeLang]} label="Request" />
              </div>
            </div>
          </section>

          {/* ── Order Status ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="status" />
            <SectionHeader icon={Activity} title="Check Order Status" />
            <div className="ml-11 flex flex-wrap items-center gap-3 mb-6">
              <MethodBadge method="GET" />
              <code className="text-white/55 text-sm font-mono bg-white/5 px-3 py-1 rounded-lg border border-white/8">/status</code>
            </div>
            <p className="text-white/45 text-sm mb-6 ml-11 max-w-xl">Retrieve the status of any order using its unique order UUID reference.</p>
            <div className="ml-11 space-y-6">
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Query Parameters</span>
                </div>
                <ParamRow name="order_id" type="string" required desc="The order's unique UUID reference (also accepts query via 'reference' or 'orderNumber' UUID)" />
              </div>
              <div className="space-y-4">
                <p className="text-xs font-bold uppercase tracking-widest text-sky-400 mb-2">Request Example</p>
                <CodeBlock code={snippets.status[activeLang]} label="Request" />
              </div>
              <div className="space-y-4">
                <p className="text-xs font-bold uppercase tracking-widest text-white/20 mb-2">Response Examples</p>
                <div className="grid lg:grid-cols-2 gap-6">
                  <ResponseBlock code={RESPONSES.order_status_200} label="Response · 200 OK" />
                  <ResponseBlock code={RESPONSES.order_status_400} variant="error" label="Response · 400 Bad Request" />
                </div>
                <div className="grid lg:grid-cols-2 gap-6">
                  <ResponseBlock code={RESPONSES.order_status_401} variant="error" label="Response · 401 Unauthorized" />
                  <ResponseBlock code={RESPONSES.order_status_403} variant="error" label="Response · 403 Forbidden" />
                </div>
                <div className="grid lg:grid-cols-2 gap-6">
                  <ResponseBlock code={RESPONSES.order_status_404} variant="error" label="Response · 404 Not Found" />
                  <ResponseBlock code={RESPONSES.order_status_500} variant="error" label="Response · 500 Server Error" />
                </div>
              </div>
            </div>
          </section>

          {/* ── Webhooks ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="webhooks" />
            <SectionHeader icon={Globe} title="Webhooks" />
            <p className="text-white/45 text-sm mb-6 md:ml-11 max-w-xl">
              SwiftData can POST real-time events to your server whenever an order status changes.
              Set your webhook URL in the <strong className="text-white/70">Developer Dashboard → API Settings</strong>.
            </p>

            <div className="ml-11 space-y-6">
              {/* Events table */}
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Event Types</span>
                </div>
                {[
                  { event: "order.fulfilled",         desc: "Order delivered to recipient" },
                  { event: "order.fulfillment_failed", desc: "Provider returned an error; wallet was refunded" },
                  { event: "order.processing",        desc: "Order accepted by provider, awaiting delivery" },
                  { event: "wallet.credited",         desc: "API wallet received a transfer" },
                ].map(({ event, desc }) => (
                  <div key={event} className="flex items-center gap-4 px-4 py-3 text-xs border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <code className="font-mono font-bold text-emerald-300 w-44 shrink-0">{event}</code>
                    <span className="text-white/40">{desc}</span>
                  </div>
                ))}
              </div>

              {/* Security callout */}
              <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-4 flex gap-3">
                <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-amber-300 mb-1">Verify Webhook Signatures</p>
                  <p className="text-[11px] text-white/40 leading-relaxed">
                    Every webhook includes an <code className="text-amber-300 bg-white/5 px-1 rounded">X-Swift-Signature</code> header — the HMAC-SHA256 of the raw body using your Secret Key.
                    Always verify it before processing the event to prevent replay attacks.
                  </p>
                </div>
              </div>

              {/* Payload example + handler */}
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-sky-400 mb-3">Webhook Payload</p>
                <ResponseBlock code={RESPONSES.webhook_event} label="Incoming POST Body" />
              </div>

              <div>
                <p className="text-xs font-black uppercase tracking-widest text-emerald-400 mb-3">Signature Verification Handler</p>
                <CodeBlock code={snippets.webhook_verify[activeLang]} label="Your Server Code" />
              </div>

              {/* Retry policy */}
              <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
                <p className="text-xs font-bold text-white/60 mb-2">Security Requirements & Retry Policy</p>
                <ul className="text-[11px] text-white/40 leading-relaxed space-y-1">
                  <li><strong className="text-emerald-400">Strict HTTPS Only:</strong> The webhook callback URL must use secure <code className="text-emerald-300">https://</code> protocol.</li>
                  <li><strong className="text-amber-400">VPC SSRF Firewall:</strong> Loopback addresses (<code className="text-amber-300">localhost</code>, <code className="text-amber-300">127.x.x.x</code>), private IP blocks (<code className="text-amber-300">10.x.x.x</code>, <code className="text-amber-300">192.168.x.x</code>), and link-local ranges are blocked for infrastructure security.</li>
                  <li>Your endpoint must respond with <code className="text-white/60">HTTP 200</code> within <strong className="text-white/60">10 seconds</strong>.</li>
                  <li>Failed deliveries are retried up to <strong className="text-white/60">5 times</strong> with exponential back-off (1 min → 5 min → 30 min → 2 hr → 12 hr).</li>
                  <li>Use the <code className="text-amber-300 bg-white/5 px-1 rounded">order_id</code> field to deduplicate events in case of retries.</li>
                </ul>
              </div>
            </div>
          </section>

          {/* ── Rate Limits ────────────────────────────────────────── */}
          <section>
            <SectionAnchor id="rate-limits" />
            <SectionHeader icon={Gauge} title="Rate Limits" />
            <p className="text-white/45 text-sm mb-6 md:ml-11 max-w-xl">
              Each API key has a configurable per-minute request limit. The default is <strong className="text-white/70">30 requests / minute</strong>.
              Adjust your limit in the <strong className="text-white/70">Developer Dashboard → API Keys</strong>.
            </p>

            <div className="ml-11 space-y-6">
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Limits Overview</span>
                </div>
                {[
                  { label: "Default rate limit",   value: "30 req / min per key" },
                  { label: "Max rate limit",        value: "300 req / min (contact support)" },
                  { label: "Daily spend cap",       value: "Set per key in dashboard (GHS)" },
                  { label: "Duplicate protection",  value: "Same phone + network + package = 409 within 60 sec (bypass with allow_duplicate: true)" },
                  { label: "Exceeded response",     value: "HTTP 429 — Rate limit exceeded" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex flex-col sm:grid sm:grid-cols-12 sm:gap-2 px-4 py-3 text-xs border-b border-white/5 last:border-0 hover:bg-white/[0.02] gap-1">
                    <div className="sm:col-span-5 font-semibold text-white/60">{label}</div>
                    <div className="sm:col-span-7 font-mono text-amber-300">{value}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-red-500/15 bg-red-500/5 p-4 flex gap-3">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-red-300 mb-1">On 429 — Back Off Gracefully</p>
                  <p className="text-[11px] text-white/40 leading-relaxed">
                    When you receive a <code className="text-red-300 bg-white/5 px-1 rounded">429</code>, wait at least <strong className="text-white/60">60 seconds</strong> before retrying.
                    Queue purchases and send them in batches rather than firing rapid sequential requests.
                  </p>
                </div>
              </div>

              <ResponseBlock code={RESPONSES.error_429} variant="error" label="429 Response" />
            </div>
          </section>

          {/* ── Error Reference ───────────────────────────────────────── */}
          <section>
            <SectionAnchor id="errors" />
            <SectionHeader icon={AlertTriangle} title="Error Reference" />
            <div className="ml-11 space-y-6">
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <div className="grid grid-cols-12 px-4 py-2.5 bg-white/[0.03] border-b border-white/5">
                  <div className="col-span-2 text-[9px] font-bold uppercase tracking-widest text-white/20">Code</div>
                  <div className="col-span-3 text-[9px] font-bold uppercase tracking-widest text-white/20">Title</div>
                  <div className="col-span-7 text-[9px] font-bold uppercase tracking-widest text-white/20">Description</div>
                </div>
                {[
                  { code: "400", title: "Bad Request",       desc: "Missing or malformed request parameters" },
                  { code: "401", title: "Unauthorized",      desc: "API key missing, invalid, or signature mismatch" },
                  { code: "402", title: "Low Balance",       desc: "API wallet balance insufficient for this purchase" },
                  { code: "403", title: "Forbidden",         desc: "API access disabled or action not permitted for this key" },
                  { code: "404", title: "Not Found",         desc: "Order ID not found or endpoint does not exist" },
                  { code: "409", title: "Duplicate Order",   desc: "Same phone + network + package placed within 60 seconds (override with allow_duplicate)" },
                  { code: "429", title: "Rate Limited",      desc: "Exceeded your per-minute request limit or daily spend cap" },
                  { code: "500", title: "Server Error",      desc: "Unexpected internal error — includes a reference ID for support" },
                ].map(({ code, title, desc }) => (
                  <div key={code} className={`flex items-center gap-4 px-4 py-3 text-xs border-b border-white/5 last:border-0 hover:bg-white/[0.02] ${["402","403","409","429","500"].includes(code) ? "hover:bg-red-500/[0.02]" : ""}`}>
                    <div className={`font-mono font-black w-8 shrink-0 ${parseInt(code) >= 400 ? "text-red-400" : "text-sky-400"}`}>{code}</div>
                    <div className="font-bold text-white/80 w-28 shrink-0">{title}</div>
                    <div className="text-white/35">{desc}</div>
                  </div>
                ))}
              </div>

              <div className="grid lg:grid-cols-3 gap-4">
                <ResponseBlock code={RESPONSES.error_402} variant="error" label="402 Insufficient Balance" />
                <ResponseBlock code={RESPONSES.error_409} variant="error" label="409 Duplicate Order" />
                <ResponseBlock code={RESPONSES.error_500} variant="error" label="500 Server Error (with reference)" />
              </div>
            </div>
          </section>

          {/* ── Best Practices ───────────────────────────────────────── */}
          <section>
            <SectionAnchor id="best-practices" />
            <SectionHeader icon={Shield} title="Best Practices" />

            <div className="ml-11 grid md:grid-cols-2 gap-6">
              <div className="p-4 rounded-xl border border-white/8 bg-white/[0.02]">
                <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-sky-400" /> Never Expose Your Key
                </h3>
                <p className="text-xs text-white/45 leading-relaxed">
                  Never store API keys in client-side code, mobile apps, or public repositories. Always proxy requests through your own backend server where the key lives in environment variables.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5">
                <h3 className="text-sm font-bold text-red-400 mb-2 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-red-400 animate-pulse" /> Enforce IP Whitelisting
                </h3>
                <p className="text-xs text-white/45 leading-relaxed">
                  <strong className="text-red-400 font-bold">Recommended:</strong> Restrict your API credentials to trust requests originating only from your designated server IP addresses. This locks down your wallet balance even if your API key is leaked. Find your outbound hosting IP on your server dashboard or query <code className="text-sky-300 bg-white/5 px-1 rounded">curl ifconfig.me</code> on your server.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-white/8 bg-white/[0.02]">
                <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                  <RotateCcw className="w-4 h-4 text-amber-400" /> Always Use Idempotency Keys
                </h3>
                <p className="text-xs text-white/45 leading-relaxed">
                  Send a unique <code className="text-amber-400">request_id</code> on every purchase. If your request times out and you retry, the server returns the original result instead of creating a duplicate order.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-white/8 bg-white/[0.02]">
                <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-400" /> Keep the API Wallet Funded
                </h3>
                <p className="text-xs text-white/45 leading-relaxed">
                  Purchases are charged from your <strong className="text-white/70">API wallet</strong>, not your main wallet. Use <code className="text-sky-400">/wallet/transfer</code> to move funds programmatically, and monitor the <code className="text-sky-400">wallet.credited</code> webhook.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-white/8 bg-white/[0.02]">
                <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-400" /> Monitor for 402 Errors
                </h3>
                <p className="text-xs text-white/45 leading-relaxed">
                  Implement proper logging on your end. A spike in <code className="text-red-400">402</code> (low balance) or <code className="text-red-400">fulfillment_failed</code> orders is your signal to top up or investigate provider issues.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-white/8 bg-white/[0.02]">
                <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-purple-400" /> Validate Bills Before Paying
                </h3>
                <p className="text-xs text-white/45 leading-relaxed">
                  Always call <code className="text-sky-400">/payment/bills/validate</code> before <code className="text-sky-400">/ecg</code>. This confirms the account exists and prevents payment failures from invalid meter/smartcard numbers.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-white/8 bg-white/[0.02]">
                <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" /> Use Test Mode First
                </h3>
                <p className="text-xs text-white/45 leading-relaxed">
                  Enable <strong className="text-white/70">Test Mode</strong> in the dashboard before going live. Orders behave identically (same responses, same order records) but no real fulfillment occurs and no wallet is charged.
                </p>
              </div>
            </div>
          </section>

        </main>
      </div>
    </div>
  );
};

export default APIDocumentation;
