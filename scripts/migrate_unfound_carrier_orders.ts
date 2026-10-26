import fs from 'fs';
import path from 'path';

const envPath = path.resolve('c:/Users/hp/swift data/.env');
const env = fs.readFileSync(envPath, 'utf-8');
const envMap: Record<string, string> = {};
for (const l of env.split('\n')) {
  const m = l.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (m) envMap[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
}

const url = envMap['VITE_SUPABASE_URL'] || envMap['SUPABASE_URL'];
const key = envMap['SUPABASE_SERVICE_ROLE_KEY'] || envMap['VITE_SUPABASE_ANON_KEY'];

const isApply = process.argv.includes('--apply');

interface TargetOrder {
  id: string;
  customer_phone: string;
  network: string;
  package_size: string;
  amount: number;
  payment_method: string;
  status: string;
  provider_id: string | null;
  provider_order_id: string | null;
  failure_reason: string | null;
  auto_refunded?: boolean;
  metadata?: any;
  created_at: string;
}

async function run() {
  console.log(`=== ONE-TIME CARRIER DELIVERY MIGRATION SCRIPT ===`);
  console.log(`Mode: ${isApply ? 'APPLY (LIVE DATABASE WRITES)' : 'DRY-RUN (SIMULATION ONLY)'}\n`);

  if (!url || !key) {
    console.error('Error: Supabase URL or Service Role Key missing.');
    process.exit(1);
  }

  // 1. Query orders currently marked 'fulfillment_failed' with 'Order not found' in failure_reason
  const res = await fetch(`${url}/rest/v1/orders?select=id,customer_phone,network,package_size,amount,payment_method,status,auto_refunded,provider_id,provider_order_id,failure_reason,metadata,created_at&status=eq.fulfillment_failed&failure_reason=ilike.*Order%20not%20found*&order=created_at.desc`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });

  const orders: TargetOrder[] = await res.json();
  if (!Array.isArray(orders)) {
    console.error('Failed to fetch orders:', orders);
    process.exit(1);
  }

  console.log(`Total candidate orders matching 'Order not found': ${orders.length}`);

  // 2. Filter:
  // - Exclude orders with auto_refunded === true
  // - Require a valid provider_order_id (not null, not 'failed_api_call', not 'timeout', not 'refunded')
  const eligibleOrders = orders.filter((o) => {
    if (o.auto_refunded === true) return false;
    if (o.metadata?.refunded === true || o.metadata?.is_refunded === true) return false;
    const pId = String(o.provider_order_id || '').trim();
    if (!pId || pId === 'null' || pId === 'failed_api_call' || pId === 'timeout' || pId === 'refunded' || pId === 'dispatching') {
      return false;
    }
    return true;
  });

  console.log(`Eligible orders for carrier fulfillment resolution: ${eligibleOrders.length}\n`);

  // Breakdown by provider group
  const dataMartOrders: TargetOrder[] = [];
  const bundleZoneOrders: TargetOrder[] = [];
  const spendlessOrders: TargetOrder[] = [];
  const otherOrders: TargetOrder[] = [];

  for (const o of eligibleOrders) {
    const pId = String(o.provider_order_id || '');
    if (/^[0-9a-f]{24}$/i.test(pId)) {
      dataMartOrders.push(o);
    } else if (pId.startsWith('REQ-') || (o.failure_reason && o.failure_reason.includes('BundleZone'))) {
      bundleZoneOrders.push(o);
    } else if (pId.startsWith('API_') || (o.failure_reason && o.failure_reason.includes('Spendless'))) {
      spendlessOrders.push(o);
    } else {
      otherOrders.push(o);
    }
  }

  console.log(`Breakdown:`);
  console.log(`- DataMart Orders (24-char ObjectId): ${dataMartOrders.length}`);
  console.log(`- BundleZone Orders (REQ- / BZ ref): ${bundleZoneOrders.length}`);
  console.log(`- Spendless Orders (API_... ref): ${spendlessOrders.length}`);
  console.log(`- Other valid provider refs: ${otherOrders.length}\n`);

  let updatedCount = 0;
  let errorCount = 0;

  for (const o of eligibleOrders) {
    const logInfo = `Order ${o.id} | Phone: ${o.customer_phone} | Pkg: ${o.network} ${o.package_size} | Tx: ${o.provider_order_id}`;
    if (!isApply) {
      console.log(`[DRY-RUN] Would mark FULFILLED: ${logInfo}`);
    } else {
      try {
        const updateRes = await fetch(`${url}/rest/v1/orders?id=eq.${o.id}`, {
          method: 'PATCH',
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            status: 'fulfilled',
            failure_reason: null,
            updated_at: new Date().toISOString(),
            metadata: {
              ...(o.metadata || {}),
              carrier_reconciled_at: new Date().toISOString(),
              carrier_reconciled_from: 'migration_unfound_carrier_orders',
              previous_failure_reason: o.failure_reason
            }
          })
        });

        if (updateRes.ok) {
          updatedCount++;
          console.log(`[UPDATED] ${logInfo} -> status: fulfilled`);

          // Credit profits if agent order
          await fetch(`${url}/rest/v1/rpc/credit_order_profits`, {
            method: 'POST',
            headers: {
              'apikey': key,
              'Authorization': `Bearer ${key}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ p_order_id: o.id })
          }).catch(() => {});
        } else {
          errorCount++;
          console.error(`[ERROR] Failed to update ${o.id}: HTTP ${updateRes.status}`);
        }
      } catch (err: any) {
        errorCount++;
        console.error(`[EXCEPTION] Updating ${o.id}:`, err?.message || err);
      }
    }
  }

  console.log(`\n=== MIGRATION SUMMARY ===`);
  if (!isApply) {
    console.log(`[DRY-RUN COMPLETE] Total orders that would be updated: ${eligibleOrders.length}`);
    console.log(`To execute live updates, run with flag: --apply`);
  } else {
    console.log(`Total successfully updated to 'fulfilled': ${updatedCount}`);
    console.log(`Total errors: ${errorCount}`);
  }
}

run().catch(console.error);
