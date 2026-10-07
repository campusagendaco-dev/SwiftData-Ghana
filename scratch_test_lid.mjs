import fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let v = match[2] || '';
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[match[1]] = v.trim();
  }
});

// We know WHATSAPP_API_KEY from Supabase secrets
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(env.SUPABASE_URL || 'https://lsocdjpflecduumopijn.supabase.co', env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data: settings } = await supabase
    .from('v_system_settings_with_secrets')
    .select('whatsapp_api_key')
    .maybeSingle();

  console.log("Settings key present:", !!settings?.whatsapp_api_key);
}

test();
