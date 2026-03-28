import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Clock } from "lucide-react";

interface AgentRow {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  store_name: string;
  phone: string;
  momo_number: string;
  momo_network: string;
  slug: string | null;
  is_agent: boolean;
  onboarding_complete: boolean;
  agent_approved: boolean;
  created_at: string;
}

const AdminAgents = () => {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchAgents = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("is_agent", true)
      .order("created_at", { ascending: false });
    setAgents((data as AgentRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  const handleApprove = async (userId: string) => {
    const { error } = await supabase
      .from("profiles")
      .update({ agent_approved: true })
      .eq("user_id", userId);

    if (error) {
      toast({ title: "Failed to approve", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Agent approved ✅" });
      fetchAgents();
    }
  };

  const handleRevoke = async (userId: string) => {
    const { error } = await supabase
      .from("profiles")
      .update({ agent_approved: false })
      .eq("user_id", userId);

    if (error) {
      toast({ title: "Failed to revoke", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Agent access revoked" });
      fetchAgents();
    }
  };

  if (loading) return <div className="text-muted-foreground">Loading agents...</div>;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-6">Agent Management</h1>

      {agents.length === 0 ? (
        <p className="text-muted-foreground">No agents registered yet.</p>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-4 font-medium text-muted-foreground">Name</th>
                  <th className="text-left p-4 font-medium text-muted-foreground">Store</th>
                  <th className="text-left p-4 font-medium text-muted-foreground">Email</th>
                  <th className="text-left p-4 font-medium text-muted-foreground">MoMo</th>
                  <th className="text-left p-4 font-medium text-muted-foreground">Status</th>
                  <th className="text-left p-4 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="p-4 font-medium">{agent.full_name}</td>
                    <td className="p-4">{agent.store_name || "—"}</td>
                    <td className="p-4 text-muted-foreground">{agent.email}</td>
                    <td className="p-4 text-muted-foreground">
                      {agent.momo_number ? `${agent.momo_network} - ${agent.momo_number}` : "—"}
                    </td>
                    <td className="p-4">
                      {!agent.onboarding_complete ? (
                        <Badge variant="outline" className="gap-1">
                          <Clock className="w-3 h-3" /> Onboarding
                        </Badge>
                      ) : agent.agent_approved ? (
                        <Badge className="gap-1 bg-green-500/20 text-green-400 border-green-500/30">
                          <CheckCircle className="w-3 h-3" /> Approved
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <XCircle className="w-3 h-3" /> Pending
                        </Badge>
                      )}
                    </td>
                    <td className="p-4">
                      {agent.onboarding_complete && !agent.agent_approved && (
                        <Button size="sm" onClick={() => handleApprove(agent.user_id)}>
                          Approve
                        </Button>
                      )}
                      {agent.agent_approved && (
                        <Button size="sm" variant="outline" onClick={() => handleRevoke(agent.user_id)}>
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminAgents;
