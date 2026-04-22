import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LifeBuoy, Inbox, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const AdminTickets = () => {
  return (
    <div className="space-y-6 max-w-5xl pb-10">
      <div>
        <h1 className="font-display text-2xl font-bold">Support Tickets</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage user issues, failed orders, and refunds directly.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-amber-500/5 border-amber-500/20">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="bg-amber-500/10 p-3 rounded-full">
              <Inbox className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Open Tickets</p>
              <p className="text-2xl font-black">0</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="bg-green-500/10 p-3 rounded-full">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Resolved</p>
              <p className="text-2xl font-black">0</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Tickets</CardTitle>
          <CardDescription>Support requests requiring admin attention.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <LifeBuoy className="w-12 h-12 text-muted-foreground opacity-20 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">Inbox Zero!</p>
            <p className="text-xs text-muted-foreground mt-1">No open support tickets at the moment.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminTickets;
