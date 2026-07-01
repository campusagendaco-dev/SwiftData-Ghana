import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CalendarClock, Plus, RefreshCw, XCircle, Settings, ClipboardList, CheckCircle2, AlertTriangle, Play } from "lucide-react";
import { motion } from "framer-motion";

interface Mandate {
  id: string;
  customer_number: string;
  transaction_id: string;
  mandate_id: string | null;
  amount: number;
  frequency_type: "Daily" | "Weekly" | "Monthly" | "Yearly";
  frequency: string;
  start_date: string;
  end_date: string;
  debit_day: string;
  description: string | null;
  payer_name: string | null;
  status: "pending" | "pending_pre_approval" | "active" | "failed" | "cancelled";
  created_at: string;
}

interface DebitTransaction {
  id: string;
  mandate_id: string;
  transaction_id: string;
  amount: number;
  status: "processing" | "success" | "failed";
  message: string | null;
  created_at: string;
  direct_debit_mandates?: {
    customer_number: string;
    description: string | null;
  } | null;
}

export default function DashboardDirectDebit() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [transactions, setTransactions] = useState<DebitTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // New Mandate Form State
  const [customerNumber, setCustomerNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [frequencyType, setFrequencyType] = useState("Monthly");
  const [frequency, setFrequency] = useState("1");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [debitDay, setDebitDay] = useState("1");
  const [description, setDescription] = useState("");
  const [payerName, setPayerName] = useState("");

  // Edit Mandate State
  const [selectedMandate, setSelectedMandate] = useState<Mandate | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editDebitDay, setEditDebitDay] = useState("");
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const fetchMandatesAndLogs = async () => {
    if (!user) return;
    try {
      setLoading(true);
      // Fetch Mandates
      const { data: mandateData, error: mandateErr } = await supabase
        .from("direct_debit_mandates")
        .select("*")
        .order("created_at", { ascending: false });

      if (mandateErr) throw mandateErr;
      setMandates(mandateData || []);

      // Fetch Debit Transactions
      const { data: txData, error: txErr } = await supabase
        .from("direct_debit_transactions")
        .select("*, direct_debit_mandates(customer_number, description)")
        .order("created_at", { ascending: false });

      if (txErr) throw txErr;
      setTransactions((txData as any) || []);
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Load Failed",
        description: e.message || "Failed to load direct debit mandates.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMandatesAndLogs();
  }, [user]);

  // Form Normalization
  const normalizePhoneNumber = (num: string) => {
    let clean = num.replace(/\D/g, "");
    if (clean.startsWith("0")) {
      clean = "233" + clean.slice(1);
    }
    return clean;
  };

  const handleCreateMandate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerNumber || !amount || !startDate || !endDate || !debitDay) {
      toast({
        title: "Required Fields",
        description: "Please fill out all mandatory schedule fields.",
        variant: "destructive"
      });
      return;
    }

    const formattedPhone = normalizePhoneNumber(customerNumber);
    if (formattedPhone.length < 10) {
      toast({
        title: "Invalid Number",
        description: "Please enter a valid MTN phone number.",
        variant: "destructive"
      });
      return;
    }

    try {
      setSubmitting(true);
      const { data, error } = await supabase.functions.invoke("direct-debit-action", {
        body: {
          action: "create_mandate",
          customer_number: formattedPhone,
          amount: Number(amount),
          frequency_type: frequencyType,
          frequency,
          start_date: startDate,
          end_date: endDate,
          debit_day: debitDay,
          description,
          payer_name: payerName
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "Mandate Created",
          description: "A pre-approval request has been sent to the customer's wallet.",
        });
        // Clear form
        setCustomerNumber("");
        setAmount("");
        setDescription("");
        setPayerName("");
        fetchMandatesAndLogs();
      } else {
        throw new Error(data?.error || "Mandate creation failed.");
      }
    } catch (e: any) {
      toast({
        title: "Creation Failed",
        description: e.message || "Failed to create mandate.",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateMandate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMandate) return;

    try {
      setSubmitting(true);
      const { data, error } = await supabase.functions.invoke("direct-debit-action", {
        body: {
          action: "update_mandate",
          mandate_db_id: selectedMandate.id,
          amount: Number(editAmount),
          frequency_type: selectedMandate.frequency_type,
          frequency: selectedMandate.frequency,
          start_date: editStartDate,
          end_date: editEndDate,
          debit_day: editDebitDay,
          description: selectedMandate.description,
          payer_name: selectedMandate.payer_name
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "Mandate Updated",
          description: "The mandate schedule has been updated successfully.",
        });
        setEditDialogOpen(false);
        fetchMandatesAndLogs();
      } else {
        throw new Error(data?.error || "Mandate update failed.");
      }
    } catch (e: any) {
      toast({
        title: "Update Failed",
        description: e.message || "Failed to update mandate schedule.",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelMandate = async (id: string) => {
    if (!confirm("Are you sure you want to cancel this approved direct debit mandate?")) return;

    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("direct-debit-action", {
        body: {
          action: "cancel_mandate",
          mandate_db_id: id
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "Mandate Cancelled",
          description: "The direct debit mandate was cancelled successfully.",
        });
        fetchMandatesAndLogs();
      } else {
        throw new Error(data?.error || "Mandate cancellation failed.");
      }
    } catch (e: any) {
      toast({
        title: "Cancellation Failed",
        description: e.message || "Failed to cancel mandate.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCancelPreApproval = async (phone: string) => {
    if (!confirm("Are you sure you want to cancel the pending pre-approval request?")) return;

    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("direct-debit-action", {
        body: {
          action: "cancel_pre_approval",
          customer_number: phone
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "Pre-approval Cancelled",
          description: "Pending pre-approval request was cancelled successfully.",
        });
        fetchMandatesAndLogs();
      } else {
        throw new Error(data?.error || "Pre-approval cancellation failed.");
      }
    } catch (e: any) {
      toast({
        title: "Cancellation Failed",
        description: e.message || "Failed to cancel pending pre-approval.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const openEditDialog = (mandate: Mandate) => {
    setSelectedMandate(mandate);
    setEditAmount(String(mandate.amount));
    setEditStartDate(mandate.start_date);
    setEditEndDate(mandate.end_date);
    setEditDebitDay(mandate.debit_day);
    setEditDialogOpen(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white gap-1"><CheckCircle2 className="h-3 w-3" /> Active</Badge>;
      case "pending":
      case "pending_pre_approval":
        return <Badge className="bg-amber-500 hover:bg-amber-600 text-white gap-1"><RefreshCw className="h-3 w-3 animate-spin" /> Pending Approval</Badge>;
      case "failed":
        return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Failed</Badge>;
      case "cancelled":
        return <Badge variant="secondary" className="gap-1"><XCircle className="h-3 w-3" /> Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTxStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white">Success</Badge>;
      case "processing":
        return <Badge className="bg-amber-500 hover:bg-amber-600 text-white">Processing</Badge>;
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-amber-500 bg-clip-text text-transparent flex items-center gap-2">
            <CalendarClock className="h-8 w-8 text-primary" /> MTN Direct Debit
          </h1>
          <p className="text-muted-foreground mt-1">
            Create, update and manage recurring direct debit mandates on customer mobile money wallets.
          </p>
        </div>
        <Button onClick={fetchMandatesAndLogs} disabled={loading} variant="outline" className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <Tabs defaultValue="list" className="w-full">
        <TabsList className="grid w-full md:w-[400px] grid-cols-3 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="list" className="rounded-lg">Mandates</TabsTrigger>
          <TabsTrigger value="create" className="rounded-lg">New Mandate</TabsTrigger>
          <TabsTrigger value="history" className="rounded-lg">Debit Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-6">
          <Card className="border-none shadow-xl bg-card/60 backdrop-blur-md">
            <CardHeader>
              <CardTitle>Mandate List</CardTitle>
              <CardDescription>Manage active, pending, or cancelled debit schedules.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading && mandates.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">Loading mandates...</div>
              ) : mandates.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground flex flex-col items-center gap-2">
                  <CalendarClock className="h-10 w-10 text-muted-foreground/50" />
                  No recurring debit mandates created yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>MTN Number</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Cycle</TableHead>
                        <TableHead>Debit Day</TableHead>
                        <TableHead>Validity</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mandates.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="font-semibold">{m.customer_number}</TableCell>
                          <TableCell>GHS {m.amount.toFixed(2)}</TableCell>
                          <TableCell>
                            {m.frequency_type} ({m.frequency === "1" ? "Every cycle" : `Every ${m.frequency} cycles`})
                          </TableCell>
                          <TableCell>Day {m.debit_day}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {m.start_date} to {m.end_date}
                          </TableCell>
                          <TableCell>{getStatusBadge(m.status)}</TableCell>
                          <TableCell className="max-w-[150px] truncate text-muted-foreground text-xs">{m.description || "N/A"}</TableCell>
                          <TableCell className="text-right space-x-2 whitespace-nowrap">
                            {m.status === "pending_pre_approval" && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleCancelPreApproval(m.customer_number)}
                                className="h-8 text-xs"
                              >
                                Cancel Request
                              </Button>
                            )}
                            {m.status === "active" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openEditDialog(m)}
                                  className="h-8 text-xs gap-1"
                                >
                                  <Settings className="h-3 w-3" /> Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => handleCancelMandate(m.id)}
                                  className="h-8 text-xs"
                                >
                                  Cancel Mandate
                                </Button>
                              </>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="create" className="mt-6">
          <div className="grid md:grid-cols-3 gap-6">
            <Card className="md:col-span-2 border-none shadow-xl bg-card/60 backdrop-blur-md">
              <CardHeader>
                <CardTitle>Register Recurring Mandate</CardTitle>
                <CardDescription>Initiates a prompt to prompting the customer to approve the debit cycle.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreateMandate} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="customerNumber">Customer MTN MoMo Number</Label>
                      <Input
                        id="customerNumber"
                        placeholder="e.g. 0244000000"
                        value={customerNumber}
                        onChange={(e) => setCustomerNumber(e.target.value)}
                        required
                      />
                      <p className="text-[10px] text-muted-foreground">Normalizes to 233xxxxxxxx format automatically.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="amount">Debit Amount (GHS)</Label>
                      <Input
                        id="amount"
                        type="number"
                        step="0.01"
                        placeholder="e.g. 20.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="frequencyType">Frequency Type</Label>
                      <Select value={frequencyType} onValueChange={setFrequencyType}>
                        <SelectTrigger id="frequencyType">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Daily">Daily</SelectItem>
                          <SelectItem value="Weekly">Weekly</SelectItem>
                          <SelectItem value="Monthly">Monthly</SelectItem>
                          <SelectItem value="Yearly">Yearly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="frequency">Interval Cycle</Label>
                      <Input
                        id="frequency"
                        type="number"
                        placeholder="1"
                        value={frequency}
                        onChange={(e) => setFrequency(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="debitDay">Debit Day (e.g. 30)</Label>
                      <Input
                        id="debitDay"
                        type="number"
                        placeholder="30"
                        value={debitDay}
                        onChange={(e) => setDebitDay(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="startDate">Start Date</Label>
                      <Input
                        id="startDate"
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="endDate">End Date</Label>
                      <Input
                        id="endDate"
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="payerName">Payer Name (Metadata)</Label>
                      <Input
                        id="payerName"
                        placeholder="e.g. John Doe"
                        value={payerName}
                        onChange={(e) => setPayerName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Subscription Description</Label>
                      <Input
                        id="description"
                        placeholder="e.g. Monthly cloud backup"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>
                  </div>

                  <Button type="submit" disabled={submitting} className="w-full gap-2">
                    {submitting ? "Requesting Mandate..." : "Register Debit Mandate"} <Plus className="h-4 w-4" />
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="border-none shadow-xl bg-card/60 backdrop-blur-md">
              <CardHeader>
                <CardTitle className="text-lg">Mandate Instructions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <div className="flex gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                  <p>When you create a mandate, a prompt is sent to the customer's MTN Mobile Money wallet.</p>
                </div>
                <div className="flex gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                  <p>The customer must authorize the mandate prompt. Debits will NOT run unless they approve.</p>
                </div>
                <div className="flex gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                  <p>Once approved, debits will run automatically according to the cycle settings and days selected.</p>
                </div>
                <div className="flex gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                  <p>You will receive callbacks logging success or failure for each attempt, available in the logs tab.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card className="border-none shadow-xl bg-card/60 backdrop-blur-md">
            <CardHeader>
              <CardTitle>Debit Attempts Log</CardTitle>
              <CardDescription>Chronological attempts and results of scheduled debit cycles.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading && transactions.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">Loading logs...</div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground flex flex-col items-center gap-2">
                  <ClipboardList className="h-10 w-10 text-muted-foreground/50" />
                  No debit transactions logged yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer Number</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Transaction ID</TableHead>
                        <TableHead>Debit Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Response Message</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.map((tx) => (
                        <TableRow key={tx.id}>
                          <TableCell className="font-semibold">
                            {tx.direct_debit_mandates?.customer_number || "Unknown"}
                          </TableCell>
                          <TableCell>GHS {tx.amount.toFixed(2)}</TableCell>
                          <TableCell className="text-xs font-mono">{tx.transaction_id}</TableCell>
                          <TableCell className="text-xs">
                            {new Date(tx.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell>{getTxStatusBadge(tx.status)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{tx.message || "No message"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleUpdateMandate}>
            <DialogHeader>
              <DialogTitle>Update Mandate Schedule</DialogTitle>
              <DialogDescription>
                Modify schedule parameters for approved mandate: {selectedMandate?.customer_number}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="editAmount">New Amount (GHS)</Label>
                <Input
                  id="editAmount"
                  type="number"
                  step="0.01"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editStartDate">New Start Date</Label>
                <Input
                  id="editStartDate"
                  type="date"
                  value={editStartDate}
                  onChange={(e) => setEditStartDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editEndDate">New End Date</Label>
                <Input
                  id="editEndDate"
                  type="date"
                  value={editEndDate}
                  onChange={(e) => setEditEndDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editDebitDay">New Debit Day (1 to 31)</Label>
                <Input
                  id="editDebitDay"
                  type="number"
                  value={editDebitDay}
                  onChange={(e) => setEditDebitDay(e.target.value)}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Updating..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
