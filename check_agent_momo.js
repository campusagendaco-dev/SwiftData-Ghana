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
  const agents = ['282765fc-3501-4e08-9bb4-52737d54409f', 'c3be534f-0585-452c-b8c8-195d95e3991d', 'bd62a490-5bdd-442a-9139-07a41d128081'];
  
  for (const id of agents) {
    console.log(`Checking profile for Agent ${id}...`);
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, email, full_name, momo_number, momo_network, momo_account_name')
      .eq('user_id', id)
      .maybeSingle();
      
    if (error) {
      console.error(`Error fetching profile for ${id}:`, error);
    } else if (!data) {
      console.log(`Profile not found for agent ${id}.`);
    } else {
      console.log(`  Name: ${data.full_name}`);
      console.log(`  Email: ${data.email}`);
      console.log(`  MoMo Number: "${data.momo_number}"`);
      console.log(`  MoMo Network: "${data.momo_network}"`);
      console.log(`  MoMo Account Name: "${data.momo_account_name}"`);
    }
  }
}

run();
