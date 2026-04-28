import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://lsocdjpflecduumopijn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxzb2NkanBmbGVjZHV1bW9waWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2Nzk3NDMsImV4cCI6MjA5MTI1NTc0M30.4RnQ7s2qCXO4Qqlw1WKqTfZBfB-1Kq3toyXpGHnbv_0";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function checkOrders() {
  const today = new Date().toISOString().slice(0, 10);
  
  // Use .select('*', { count: 'exact' }) instead of head: true to avoid potential issues in some environments
  const { data, count, error } = await supabase
    .from('orders')
    .select('*', { count: 'exact' })
    .eq('status', 'fulfilled')
    .gte('created_at', `${today}T00:00:00Z`);

  if (error) {
    console.error("Error fetching orders:", error);
    return;
  }

  console.log(`Fulfilled orders today (${today}): ${count}`);
}

checkOrders();
