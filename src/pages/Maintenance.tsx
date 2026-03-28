import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wrench } from "lucide-react";

interface MaintenanceProps {
  message?: string;
}

const Maintenance = ({ message }: MaintenanceProps) => {
  return (
    <main className="min-h-screen bg-background px-4 py-16 flex items-center justify-center">
      <Card className="w-full max-w-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Wrench className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="font-display text-2xl">Site Under Maintenance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground">
            {message?.trim() || "We are performing scheduled maintenance. Please check back soon."}
          </p>
        </CardContent>
      </Card>
    </main>
  );
};

export default Maintenance;
