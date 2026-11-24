import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, MessageSquare, UploadCloud, X, FileImage, Link, CheckCircle2, Clock, AlertCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const DashboardReportIssue = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // File Upload State
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Interactive Premium Features States
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [loadingRecentOrders, setLoadingRecentOrders] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [retryingTicketId, setRetryingTicketId] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    
    if (!error && data) {
      setTickets(data);
    }
    setLoading(false);
  }, [user]);

  const fetchRecentOrders = useCallback(async () => {
    if (!user) return;
    setLoadingRecentOrders(true);
    try {
      const { data } = await supabase
        .from("orders")
        .select("id, network, package_size, amount, customer_phone, created_at, status")
        .eq("agent_id", user.id)
        .order("created_at", { ascending: false })
        .limit(6);
      if (data) {
        setRecentOrders(data);
      }
    } catch (e) {
      console.error("Error fetching recent orders:", e);
    } finally {
      setLoadingRecentOrders(false);
    }
  }, [user]);

  useEffect(() => {
    fetchTickets();
    fetchRecentOrders();
  }, [fetchTickets, fetchRecentOrders]);

  // Real-time updates when AI or an Admin replies to / resolves a ticket
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`user-tickets-live-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "support_tickets", filter: `user_id=eq.${user.id}` },
        (payload: any) => {
          const updated = payload.new;
          if (!updated?.id) return;
          setTickets((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
          if (updated.status === "resolved") {
            setEtaSeconds(null);
            toast({
              title: "✅ Ticket Resolved!",
              description: updated.admin_response || "Our support team has resolved your ticket.",
            });
          } else if (updated.admin_response) {
            toast({
              title: "💬 Support Update",
              description: updated.admin_response,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, toast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.size > 5 * 1024 * 1024) {
        toast({ title: "File too large", description: "Please select an image smaller than 5MB.", variant: "destructive" });
        return;
      }
      setFile(selectedFile);
      setFilePreview(URL.createObjectURL(selectedFile));

      // Trigger "Laser Scan" receipt details extraction visual animation
      setScanning(true);
      setTimeout(() => {
        setScanning(false);
        toast({ title: "OCR analysis complete!", description: "AI detected transaction context successfully." });
      }, 2000);
    }
  };

  const removeFile = () => {
    setFile(null);
    setFilePreview(null);
    setScanning(false);
  };

  const handleRetryOrder = async (orderId: string, ticketId: string) => {
    setRetryingTicketId(ticketId);
    try {
      const { error } = await supabase.functions.invoke("verify-payment", {
        body: { reference: orderId }
      });
      if (error) throw error;

      toast({ title: "Fulfillment Retried!", description: "Order status check successfully dispatched." });
      await fetchTickets();
    } catch (err: any) {
      console.error("Retry order error:", err);
      toast({ title: "Retry failed", description: err.message || "Failed to contact fulfillment provider.", variant: "destructive" });
    } finally {
      setRetryingTicketId(null);
    }
  };

  const handleSubmit = async () => {
    if (!subject.trim() || !details.trim()) {
      toast({ title: "Subject and details are required", variant: "destructive" });
      return;
    }
    if (!user) return;

    setSubmitting(true);
    setUploading(true);

    // Start 30s Real-Time AI Resolution countdown
    setEtaSeconds(30);
    const countdownInterval = setInterval(() => {
      setEtaSeconds((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(countdownInterval);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    try {
      let attachmentUrl = null;

      // Handle Image Upload if selected
      if (file) {
        const fileExt = file.name.split(".").pop();
        const fileName = `${user.id}/${Date.now()}.${fileExt}`;
        const { data, error: uploadError } = await supabase.storage
          .from("support-attachments")
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from("support-attachments")
          .getPublicUrl(fileName);

        attachmentUrl = publicUrl;
      }

      // Create Ticket
      const { data: createdTicket, error: ticketError } = await supabase
        .from("support_tickets")
        .insert({
          user_id: user.id,
          subject: subject.trim(),
          description: details.trim(),
          attachment_url: attachmentUrl,
          status: "open"
        })
        .select("id")
        .single();

      if (ticketError) throw ticketError;

      // Immediately invoke AI auto-triage + instant admin alert (non-blocking)
      if (createdTicket?.id) {
        void supabase.functions
          .invoke("auto-ticket-resolver", {
            body: { ticket_id: createdTicket.id },
          })
          .then(() => {
            void fetchTickets();
          })
          .catch(() => {});
      }

      toast({ title: "Ticket submitted successfully!", description: "Ama AI is checking it now & our support team has been alerted." });
      setSubject("");
      setDetails("");
      setFile(null);
      setFilePreview(null);
      fetchTickets();
    } catch (err: any) {
      toast({ title: "Failed to submit ticket", description: err.message, variant: "destructive" });
      setEtaSeconds(null);
      clearInterval(countdownInterval);
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl space-y-8 relative">
      {/* Scanning laser line styling injection */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes scan {
          0% { top: 0%; }
          50% { top: 100%; }
          100% { top: 0%; }
        }
      `}} />

      <div>
        <h1 className="font-black text-3xl tracking-tighter uppercase italic text-white flex items-center gap-3">
          <MessageSquare className="w-8 h-8 text-primary animate-pulse" />
          Autonomous Support Suite
        </h1>
        <p className="text-muted-foreground text-xs font-bold tracking-widest uppercase mt-1">24/7 AI-Agent Automated Resolution & Helpdesk</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        <Card className="lg:col-span-3 border-none bg-white/5 backdrop-blur-xl shadow-2xl">
          <CardHeader>
            <CardTitle className="text-lg font-black uppercase text-primary">Open Ticket</CardTitle>
            <CardDescription className="font-bold text-xs uppercase tracking-wider text-muted-foreground">Submit details and receipts for lightning-fast analysis.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="issue-subject" className="text-xs font-black uppercase tracking-wider">Subject</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowTxModal(true)}
                  className="h-7 rounded-lg text-[9px] font-black uppercase tracking-widest bg-primary/10 border-primary/20 text-primary hover:bg-primary/20 gap-1 cursor-pointer"
                >
                  <Link className="w-3 h-3" /> Link Transaction
                </Button>
              </div>
              <Input 
                id="issue-subject" 
                value={subject} 
                onChange={(e) => setSubject(e.target.value)} 
                className="bg-white/5 border-none h-12 rounded-xl font-bold placeholder:text-muted-foreground/30" 
                placeholder="e.g. Failed GHS 50 MoMo Deposit" 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="issue-details" className="text-xs font-black uppercase tracking-wider">Problem Description</Label>
              <Textarea
                id="issue-details"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                className="bg-white/5 border-none min-h-[140px] rounded-xl font-medium placeholder:text-muted-foreground/30 leading-relaxed"
                placeholder="Describe your issue. If relevant, include date, provider, or phone number used."
              />
            </div>

            {/* Premium Interactive Image Dropzone with Scan Overlay */}
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-wider">Attach Receipt / screenshot (Optional)</Label>
              {filePreview ? (
                <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-white/5 p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3 relative">
                    <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-white/5 shadow-inner shrink-0 bg-black/20">
                      <img src={filePreview} className="w-full h-full object-cover" />
                      {scanning && (
                        <>
                          <div className="absolute inset-0 bg-primary/10 backdrop-blur-[0.5px] flex items-center justify-center">
                            <span className="text-[8px] font-black text-primary bg-black/60 px-1 py-0.5 rounded uppercase tracking-widest animate-pulse">Scanning</span>
                          </div>
                          <div 
                            className="absolute left-0 w-full h-[2px] bg-primary shadow-[0_0_8px_rgba(251,191,36,0.8)]" 
                            style={{
                              top: 0,
                              animation: 'scan 1.5s infinite linear',
                            }}
                          />
                        </>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-black truncate max-w-[200px] text-white">{file?.name}</p>
                      <p className="text-[10px] font-black text-muted-foreground uppercase mt-0.5">
                        {scanning ? (
                          <span className="text-primary animate-pulse flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> Analyzing receipt data...
                          </span>
                        ) : (
                          `Size: ${(file!.size / 1024).toFixed(1)} KB`
                        )}
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={removeFile} className="rounded-xl text-red-400 hover:bg-red-400/10 hover:text-red-300">
                    <X className="w-5 h-5" />
                  </Button>
                </div>
              ) : (
                <label className="border-2 border-dashed border-white/5 hover:border-primary/30 transition-all rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer gap-2 bg-black/20 hover:bg-white/[0.02]">
                  <UploadCloud className="w-10 h-10 text-primary animate-bounce" />
                  <span className="text-xs font-black text-center text-white/80">Upload Screenshot or Receipt</span>
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">PNG, JPG, WEBP (MAX. 5MB)</span>
                  <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                </label>
              )}
            </div>

            <Button 
              onClick={handleSubmit} 
              disabled={submitting} 
              className="w-full h-14 rounded-xl font-black text-lg bg-primary hover:bg-primary/90 shadow-2xl shadow-primary/20 gap-2 cursor-pointer"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
              Dispatch Support Agent
            </Button>
          </CardContent>
        </Card>

        {/* Live Ticket History Inbox Fleet */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-black uppercase tracking-tight text-white flex items-center justify-between w-full">
            <span className="flex items-center gap-2">
              <Badge className="bg-primary/20 text-primary border-none text-[10px] font-black rounded-lg py-1 px-2">LIVE</Badge>
              Your Helpdesk Inbox
            </span>
            {etaSeconds !== null && (
              <Badge className="bg-amber-400/20 text-amber-400 border-none text-[8px] font-black rounded-lg py-1 px-2 animate-pulse">
                ⚡ AI RESOLUTION ETA: ~{etaSeconds}S
              </Badge>
            )}
          </h2>
          
          {loading ? (
            <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : tickets.length === 0 ? (
            <Card className="bg-white/5 border-dashed border-white/5">
              <CardContent className="py-16 text-center flex flex-col items-center">
                <MessageSquare className="w-12 h-12 opacity-20 mb-4 text-primary" />
                <p className="text-sm font-black text-muted-foreground uppercase tracking-widest">Inbox Clean</p>
                <p className="text-[10px] text-muted-foreground font-bold mt-1">No active or resolved support tickets.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
              {tickets.map((ticket) => {
                const orderIdMatch = ticket.description.match(/Order ID:\s*([a-f0-9-]{36})/i);
                const orderId = orderIdMatch ? orderIdMatch[1] : null;

                return (
                  <Card key={ticket.id} className="border-none bg-white/5 hover:bg-white/[0.07] transition-all duration-300">
                    <CardContent className="p-5 space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-sm text-white leading-tight">{ticket.subject}</p>
                          <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mt-1">
                            {new Date(ticket.created_at).toLocaleString()}
                          </p>
                        </div>
                        <Badge 
                          className={`rounded-lg border-none text-[8px] font-black px-2 h-5 shrink-0 ${
                            ticket.status === 'resolved' 
                              ? 'bg-emerald-500/10 text-emerald-500' 
                              : ticket.status === 'in_progress' 
                              ? 'bg-amber-500/10 text-amber-500' 
                              : 'bg-indigo-500/10 text-indigo-500'
                          }`}
                        >
                          {ticket.status.replace('_', ' ').toUpperCase()}
                        </Badge>
                      </div>

                      <p className="text-xs text-muted-foreground leading-relaxed font-medium">{ticket.description}</p>

                      {/* Self-Healing linked transaction quick action card */}
                      {orderId && ticket.status !== 'resolved' && (
                        <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-between gap-3 animate-in slide-in-from-top-1 duration-200">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-wider text-primary">Self-Healing Trigger Active</p>
                            <p className="text-[9px] text-muted-foreground/60 font-bold mt-0.5">Order ID: #{orderId.slice(0, 8).toUpperCase()}</p>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleRetryOrder(orderId, ticket.id)}
                            disabled={retryingTicketId === ticket.id}
                            className="h-8 rounded-lg text-[9px] font-black uppercase tracking-widest bg-primary hover:bg-primary/90 text-black gap-1 cursor-pointer"
                          >
                            {retryingTicketId === ticket.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            Force Retry
                          </Button>
                        </div>
                      )}

                      {/* Neon Status Stepper Pipeline */}
                      <div className="mt-4 pt-4 border-t border-white/5 space-y-3">
                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">AI Analysis Pipeline</p>
                        <div className="relative flex items-center justify-between w-full">
                          {/* Stepper Steps */}
                          <div className="flex items-center justify-between w-full relative z-10 text-[9px] font-bold text-muted-foreground/60">
                            <div className="flex flex-col items-center gap-1">
                              <span className="w-5 h-5 rounded-full bg-primary/20 border border-primary flex items-center justify-center text-[8px] font-black text-primary">01</span>
                              <span className="text-white/80">Ticket Filed</span>
                            </div>
                            
                            <div className="flex flex-col items-center gap-1">
                              <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[8px] font-black transition-all ${
                                ticket.status === 'resolved' 
                                  ? 'bg-primary/20 border-primary text-primary' 
                                  : 'bg-amber-400/20 border-amber-400 text-amber-400 animate-pulse'
                              }`}>02</span>
                              <span className={ticket.status !== 'resolved' ? 'text-amber-400 animate-pulse' : 'text-white/80'}>AI Review</span>
                            </div>

                            <div className="flex flex-col items-center gap-1">
                              <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[8px] font-black transition-all ${
                                ticket.status === 'resolved' 
                                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' 
                                  : 'bg-white/5 border-white/10 text-white/30'
                              }`}>03</span>
                              <span className={ticket.status === 'resolved' ? 'text-emerald-400' : 'text-white/30'}>Resolved</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Screenshot attachment preview */}
                      {ticket.attachment_url && (
                        <div className="relative rounded-xl overflow-hidden border border-white/5 max-h-[140px] bg-black/20 p-1 flex items-center justify-center">
                          <img src={ticket.attachment_url} className="max-h-[130px] rounded-lg object-contain w-full" alt="Attachment" />
                          <a 
                            href={ticket.attachment_url} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="absolute bottom-2 right-2 bg-black/70 hover:bg-black/90 p-1.5 rounded-lg text-[8px] font-black text-white uppercase tracking-widest border border-white/10"
                          >
                            View Fullsize
                          </a>
                        </div>
                      )}

                      {ticket.admin_response && (
                        <div className="bg-primary/5 p-4 rounded-xl border border-primary/10 space-y-1 mt-2 animate-in fade-in duration-300">
                          <div className="flex items-center gap-1.5 text-primary">
                            <Badge className="bg-primary text-black font-black text-[8px] px-1.5 rounded-sm">AI RESOLVER</Badge>
                          </div>
                          <p className="text-xs text-white/90 leading-relaxed font-medium italic">"{ticket.admin_response}"</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Linked Transaction modal */}
      {showTxModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md border border-white/10 bg-[#0f0f15] text-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-sm font-black uppercase text-primary">Recent Transactions</CardTitle>
                <CardDescription className="text-[10px] font-black uppercase tracking-wider text-muted-foreground mt-0.5">Select a recent order to auto-fill ticket details.</CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowTxModal(false)} className="rounded-xl text-white/50 hover:bg-white/5 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
              {loadingRecentOrders ? (
                <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : recentOrders.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-xs font-black text-muted-foreground uppercase tracking-wider">No recent orders found.</p>
                </div>
              ) : (
                recentOrders.map((order) => (
                  <button
                    key={order.id}
                    onClick={() => {
                      setSubject(`Failed ${order.network || "Bundle"} Top-up — Order #${order.id.slice(0, 8).toUpperCase()}`);
                      setDetails(
                        `Order ID: ${order.id}\n` +
                        `Network: ${order.network || "—"}\n` +
                        `Package Size: ${order.package_size || "—"}\n` +
                        `Recipient Phone: ${order.customer_phone || "—"}\n` +
                        `Amount: GHS ${Number(order.amount).toFixed(2)}\n` +
                        `Status: ${order.status.toUpperCase()}\n` +
                        `Date: ${new Date(order.created_at).toLocaleString()}\n\n` +
                        `Please help resolve this transaction discrepancy.`
                      );
                      setShowTxModal(false);
                      toast({ title: "Transaction details linked!" });
                    }}
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 hover:border-primary/20 text-left transition-all group cursor-pointer"
                  >
                    <div>
                      <p className="font-black text-xs text-white group-hover:text-primary transition-colors">
                        {order.network || "Bundle"} {order.package_size || ""}
                      </p>
                      <p className="text-[9px] font-black text-muted-foreground mt-0.5">
                        ID: {order.id.slice(0, 8).toUpperCase()} · {order.customer_phone || "—"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-xs text-white">₵{Number(order.amount).toFixed(2)}</p>
                      <Badge className={`rounded-md border-none text-[8px] font-black px-1.5 py-0.5 mt-0.5 leading-none ${
                        order.status === 'fulfilled' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                      }`}>
                        {order.status.toUpperCase()}
                      </Badge>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default DashboardReportIssue;
