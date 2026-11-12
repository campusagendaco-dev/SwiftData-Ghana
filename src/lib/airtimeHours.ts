/**
 * Guest airtime purchases are blocked from 10:00 PM to 7:00 AM Ghana time (UTC) as an
 * anti-fraud rule. Must match the Night Guard in supabase/functions/initialize-payment.
 */
export function isGuestAirtimeClosed(now: Date = new Date()): boolean {
  const hour = now.getUTCHours();
  return hour >= 22 || hour < 7;
}
