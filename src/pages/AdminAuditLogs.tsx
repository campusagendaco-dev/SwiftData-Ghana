import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileSearch, ShieldAlert } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const AdminAuditLogs = () => {
  return (
    <div className="space-y-6 max-w-5xl pb-10">
      <div>
        <h1 className="font-display text-2xl font-bold">Audit Logs</h1>
        <p className="text-sm text-muted-foreground mt-1">Track all administrative actions for security and compliance.</p>
      </div>

      <Card className="border-red-500/20 bg-red-500/5">
        <CardContent className="p-4 flex items-start gap-4">
          <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-500">Security Notice</p>
            <p className="text-xs text-muted-foreground mt-1">
              Audit logs are immutable and cannot be deleted. All sensitive actions (manual wallet top-ups, price changes, role assignments) are recorded here.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest administrative actions across the platform.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <FileSearch className="w-12 h-12 text-muted-foreground opacity-20 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No logs found</p>
            <p className="text-xs text-muted-foreground mt-1">Admin actions will populate here once recorded.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminAuditLogs;
