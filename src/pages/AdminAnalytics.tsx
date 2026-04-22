import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp, Users, Smartphone, Zap } from "lucide-react";

const AdminAnalytics = () => {
  return (
    <div className="space-y-6 max-w-6xl pb-10">
      <div>
        <h1 className="font-display text-2xl font-bold">Financial Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Track profit margins, network volume, and top performers.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-amber-500/5 border-amber-500/20">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-amber-500" /> Total Net Profit
            </CardDescription>
            <CardTitle className="text-3xl font-black">GH₵ 0.00</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mt-1">Calculated from Sell Price vs API Cost</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-500" /> Active Resellers
            </CardDescription>
            <CardTitle className="text-3xl font-black">0</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mt-1">Agents generating volume this month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-500" /> Top Network
            </CardDescription>
            <CardTitle className="text-3xl font-black">MTN</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mt-1">Highest sales volume by network</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" /> Profit Margins Over Time
          </CardTitle>
          <CardDescription>Visual breakdown of revenue vs API costs.</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center border-t border-white/5">
          <p className="text-muted-foreground text-sm flex flex-col items-center gap-2">
            <BarChart3 className="w-8 h-8 opacity-20" />
            Charts will populate once historical order data is synced.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminAnalytics;
