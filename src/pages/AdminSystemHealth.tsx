import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Database, KeyRound, ShieldAlert, Wrench } from "lucide-react";

type ChecklistItem = {
  name: string;
  note: string;
};

const AdminSystemHealth = () => {
  const secrets: ChecklistItem[] = useMemo(
    () => [
      { name: "SUPABASE_URL", note: "Core project URL for all edge functions." },
      { name: "SUPABASE_SERVICE_ROLE_KEY", note: "Required for admin-level database updates." },
      { name: "SUPABASE_ANON_KEY", note: "Used in token-scoped user validation paths." },
      { name: "PAYSTACK_SECRET_KEY", note: "Required for initialize, verify, and webhook payment flows." },
      { name: "DATA_PROVIDER_API_KEY / PRIMARY / SECONDARY", note: "Required for data fulfillment providers." },
      { name: "DATA_PROVIDER_BASE_URL / PRIMARY / SECONDARY", note: "Provider endpoint host configuration." },
      { name: "TXTCONNECT_API_KEY", note: "Required for payment-success SMS sending." },
      { name: "TXTCONNECT_SMS_URL", note: "SMS endpoint URL." },
      { name: "TXTCONNECT_SENDER_ID", note: "SMS sender ID shown to users." },
      { name: "TXTCONNECT_SMS_TYPE", note: "SMS message mode (regular/unicode mapping)." },
      { name: "SITE_URL", note: "Used for stable reset-password and callback links." },
    ],
    [],
  );

  const tables: ChecklistItem[] = useMemo(
    () => [
      { name: "profiles", note: "User profile, reseller, and sub-agent state." },
      { name: "orders", note: "All payment/order records for admin tracking." },
      { name: "wallets", note: "Agent wallet balances." },
      { name: "withdrawals", note: "Agent withdrawal requests and approvals." },
      { name: "user_roles", note: "Admin role authorization." },
      { name: "notifications", note: "Admin broadcast/notification system." },
      { name: "maintenance_settings", note: "Maintenance mode configuration." },
      { name: "global_package_settings", note: "Platform package pricing settings." },
      { name: "system_settings", note: "Core platform switches and API source settings." },
    ],
    [],
  );

  const functions: ChecklistItem[] = useMemo(
    () => [
      { name: "initialize-payment", note: "Starts Paystack checkout and creates order references." },
      { name: "verify-payment", note: "Verifies successful payments and fulfills pending orders." },
      { name: "paystack-webhook", note: "Handles Paystack charge.success events." },
      { name: "wallet-buy-data", note: "Wallet-paid data flow for dashboard purchases." },
      { name: "wallet-topup", note: "Wallet top-up initiation flow." },
      { name: "agent-withdraw", note: "Agent withdrawal requests." },
      { name: "admin-user-actions", note: "Admin user approval and action controls." },
      { name: "admin-send-sms", note: "Admin SMS broadcast pathway." },
      { name: "system-settings", note: "Platform settings read/write." },
      { name: "maintenance-mode", note: "Public maintenance state handling." },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">System Health</h1>
          <p className="text-sm text-muted-foreground">
            Operational reference for critical system dependencies and what each category controls.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-primary" />
            Admin Health Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>This page intentionally shows static operational guidance for admins.</p>
          <p>Use it as a checklist when troubleshooting incidents or onboarding operators.</p>
          <div className="pt-2 flex flex-wrap gap-2">
            <Badge className="bg-primary/15 text-primary border-primary/30">Secrets: {secrets.length}</Badge>
            <Badge className="bg-primary/15 text-primary border-primary/30">Tables: {tables.length}</Badge>
            <Badge className="bg-primary/15 text-primary border-primary/30">Functions: {functions.length}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" />
            Secrets
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {secrets.map((item) => (
              <div key={item.name} className="flex items-start justify-between rounded-md border p-3 gap-4">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.note}</p>
                </div>
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Required</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            Tables
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {tables.map((item) => (
              <div key={item.name} className="flex items-start justify-between rounded-md border p-3 gap-4">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.note}</p>
                </div>
                <CheckCircle2 className="w-4 h-4 text-green-400 mt-1" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Wrench className="w-5 h-5 text-primary" />
            Edge Functions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {functions.map((item) => (
              <div key={item.name} className="flex items-start justify-between rounded-md border p-3 gap-4">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.note}</p>
                </div>
                <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Operational</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Troubleshooting Notes</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. If users report payment success but no delivery, check verify-payment and paystack-webhook deployment first.</p>
          <p>2. If SMS does not send, verify TXTCONNECT keys and sender ID in project secrets.</p>
          <p>3. If admins cannot access controls, verify the user has admin role in user_roles.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminSystemHealth;
