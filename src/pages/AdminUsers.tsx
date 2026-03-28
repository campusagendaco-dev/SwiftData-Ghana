import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, Search } from "lucide-react";

interface UserRow {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  is_agent: boolean;
  agent_approved: boolean;
  onboarding_complete: boolean;
  created_at: string;
}

const AdminUsers = () => {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<Record<string, "reset" | "delete" | null>>({});

  useEffect(() => {
    const fetchUsers = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      setUsers((data as UserRow[]) || []);
      setLoading(false);
    };
    fetchUsers();
  }, []);

  const filtered = users.filter((u) =>
    [u.full_name, u.email]
      .filter(Boolean)
      .some((v) => v.toLowerCase().includes(search.toLowerCase()))
  );

  const setRowAction = (userId: string, action: "reset" | "delete" | null) => {
    setActionLoading((prev) => ({ ...prev, [userId]: action }));
  };

  const handleResetPassword = async (row: UserRow) => {
    const entered = window.prompt(`Enter a new password for ${row.email} (min 6 chars).\nLeave blank to auto-generate one.`);
    if (entered !== null && entered.trim() && entered.trim().length < 6) {
      toast({
        title: "Password too short",
        description: "Use at least 6 characters, or leave blank to auto-generate.",
        variant: "destructive",
      });
      return;
    }

    setRowAction(row.user_id, "reset");
    const { data, error } = await supabase.functions.invoke("admin-user-actions", {
      body: {
        action: "reset_password",
        user_id: row.user_id,
        new_password: entered?.trim() || undefined,
      },
    });

    if (error || data?.error) {
      const rawMessage = data?.error || error?.message || "Unknown error";
      const isEdgeError = rawMessage.toLowerCase().includes("edge function");
      toast({
        title: "Failed to reset password",
        description: isEdgeError
          ? "Admin action function is unavailable. Deploy admin-user-actions and verify edge-function secrets."
          : rawMessage,
        variant: "destructive",
      });
    } else {
      const tempPassword = data?.temporary_password as string | undefined;
      toast({
        title: `Password reset for ${row.email}`,
        description: tempPassword ? `Temporary password: ${tempPassword}` : "Password updated successfully.",
      });
    }
    setRowAction(row.user_id, null);
  };

  const handleDeleteUser = async (row: UserRow) => {
    const confirmed = window.confirm(`Delete ${row.email}? This action cannot be undone.`);
    if (!confirmed) return;

    setRowAction(row.user_id, "delete");
    const { data, error } = await supabase.functions.invoke("admin-user-actions", {
      body: {
        action: "delete_user",
        user_id: row.user_id,
      },
    });

    if (error || data?.error) {
      const rawMessage = data?.error || error?.message || "Unknown error";
      const isEdgeError = rawMessage.toLowerCase().includes("edge function");
      toast({
        title: "Failed to delete user",
        description: isEdgeError
          ? "Admin action function is unavailable. Deploy the admin-user-actions edge function and check its secrets."
          : rawMessage,
        variant: "destructive",
      });
      setRowAction(row.user_id, null);
      return;
    }

    setUsers((prev) => prev.filter((u) => u.user_id !== row.user_id));
    toast({ title: "User deleted successfully" });
    setRowAction(row.user_id, null);
  };

  if (loading) return <div className="text-muted-foreground">Loading users...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl font-bold">User Management</h1>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-secondary"
          />
        </div>
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-4 font-medium text-muted-foreground">Name</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Email</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Role</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Joined</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="p-4 font-medium">{user.full_name || "—"}</td>
                  <td className="p-4 text-muted-foreground">{user.email}</td>
                  <td className="p-4">
                    {user.is_agent ? (
                      <Badge className={user.agent_approved 
                        ? "bg-green-500/20 text-green-400 border-green-500/30" 
                        : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                      }>
                        {user.agent_approved ? "Agent (Approved)" : "Agent (Pending)"}
                      </Badge>
                    ) : (
                      <Badge variant="outline">Customer</Badge>
                    )}
                  </td>
                  <td className="p-4 text-muted-foreground">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-4">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleResetPassword(user)}
                        disabled={!!actionLoading[user.user_id]}
                      >
                        {actionLoading[user.user_id] === "reset" ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          "Reset Password"
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteUser(user)}
                        disabled={!!actionLoading[user.user_id] || currentUser?.id === user.user_id}
                      >
                        {actionLoading[user.user_id] === "delete" ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          "Delete"
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-muted-foreground">No users found.</div>
        )}
      </div>
    </div>
  );
};

export default AdminUsers;
