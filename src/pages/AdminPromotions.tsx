import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Ticket, Plus } from "lucide-react";

const AdminPromotions = () => {
  return (
    <div className="space-y-6 max-w-5xl pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Promo Codes & Sales</h1>
          <p className="text-sm text-muted-foreground mt-1">Generate discount codes to drive user acquisition.</p>
        </div>
        <Button className="gap-2">
          <Plus className="w-4 h-4" /> Create Promo Code
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Active Promotions</CardTitle>
              <CardDescription>Currently valid discount codes.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Ticket className="w-12 h-12 text-muted-foreground opacity-20 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No active promo codes</p>
                <p className="text-xs text-muted-foreground mt-1">Create a new code to see it here.</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Generator</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Code</Label>
                <Input placeholder="e.g. FLASH20" className="uppercase" />
              </div>
              <div className="space-y-2">
                <Label>Discount Percentage</Label>
                <div className="relative">
                  <Input type="number" placeholder="10" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Max Uses</Label>
                <Input type="number" placeholder="100" />
              </div>
              <Button className="w-full">Generate Code</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AdminPromotions;
