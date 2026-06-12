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
  console.log("Checking recent audit logs...");
  const { data: logs, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (error) {
    console.error("Error fetching audit logs:", error);
  } else {
    console.log(`Fetched ${logs.length} recent audit logs:`);
    console.log(JSON.stringify(logs, null, 2));
  }

  console.log("\nChecking recent admin action logs...");
  const { data: adminLogs, error: adminError } = await supabase
    .from('admin_action_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (adminError) {
    console.error("Error fetching admin action logs:", adminError);
  } else {
    console.log(`Fetched ${adminLogs.length} recent admin action logs:`);
    console.log(JSON.stringify(adminLogs, null, 2));
  }
}

run();
