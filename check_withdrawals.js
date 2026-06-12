import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// Read environment variables from .env
const envPath = 'c:\\Users\\hp\\swift data\\.env';
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    const key = match[1];
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    env[key] = value.trim();
  }
});

const supabaseUrl = env.SUPABASE_URL || 'https://lsocdjpflecduumopijn.supabase.co';
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false
  }
});

async function run() {
  console.log("Checking recent withdrawals...");
  const { data: withdrawals, error } = await supabase
    .from('withdrawals')
    .select('id, agent_id, amount, net_amount, status, failure_reason, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (error) {
    console.error("Error fetching withdrawals:", error);
    return;
  }
  
  console.log(`Fetched ${withdrawals.length} recent withdrawals:`);
  withdrawals.forEach((w, idx) => {
    console.log(`[${idx}] ID: ${w.id}`);
    console.log(`    Agent: ${w.agent_id}`);
    console.log(`    Amount: GHS ${w.amount}, Net: GHS ${w.net_amount}`);
    console.log(`    Status: ${w.status}`);
    console.log(`    Failure Reason: "${w.failure_reason}"`);
    console.log(`    Created At: ${w.created_at}`);
    console.log('---');
  });
}

run();
