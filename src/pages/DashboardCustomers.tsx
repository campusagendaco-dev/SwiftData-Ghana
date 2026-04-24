import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Users2, Search, Plus, Trash2, Phone, User as UserIcon, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface SavedCustomer {
  id: string;
  name: string;
  phone: string;
  network: string;
  created_at: string;
}

const DashboardCustomers = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [customers, setCustomers] = useState<SavedCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    phone: "",
    network: "MTN"
  });

  useEffect(() => {
    if (user) fetchCustomers();
  }, [user]);

  const fetchCustomers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("saved_customers")
      .select("*")
      .order("name", { ascending: true });
    
    if (error) {
      toast({ title: "Error fetching customers", description: error.message, variant: "destructive" });
    } else {
      setCustomers(data || []);
    }
    setLoading(false);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    if (!newCustomer.name.trim() || !newCustomer.phone.trim()) {
      toast({ title: "Please fill in all fields", variant: "destructive" });
      return;
    }

    setAdding(true);
    const { data, error } = await supabase
      .from("saved_customers")
      .insert([
        {
          agent_id: user.id,
          name: newCustomer.name.trim(),
          phone: newCustomer.phone.trim(),
          network: newCustomer.network
        }
      ])
      .select()
      .single();

    if (error) {
      toast({ title: "Error adding customer", description: error.message, variant: "destructive" });
    } else {
      setCustomers([...customers, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewCustomer({ name: "", phone: "", network: "MTN" });
      toast({ title: "Customer saved!" });
    }
    setAdding(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("saved_customers")
      .delete()
      .eq("id", id);

    if (error) {
      toast({ title: "Error deleting customer", variant: "destructive" });
    } else {
      setCustomers(customers.filter(c => c.id !== id));
      toast({ title: "Customer removed" });
    }
  };

  const filtered = customers.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.phone.includes(search)
  );

  return (
    <div className="p-6 md:p-8 space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3">
            <Users2 className="w-8 h-8 text-primary" />
            Address Book
          </h1>
          <p className="text-white/40 text-sm mt-1">Manage your frequent customers for faster data delivery.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Add Customer Form */}
        <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 h-fit backdrop-blur-xl">
          <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary" />
            Add New Customer
          </h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cust-name">Full Name</Label>
              <Input
                id="cust-name"
                value={newCustomer.name}
                onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                placeholder="e.g. Abena Mensah"
                className="bg-white/5 border-white/10"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cust-phone">Phone Number</Label>
              <Input
                id="cust-phone"
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                placeholder="024XXXXXXX"
                className="bg-white/5 border-white/10"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cust-net">Network</Label>
              <select
                id="cust-net"
                value={newCustomer.network}
                onChange={(e) => setNewCustomer({ ...newCustomer, network: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="MTN" className="bg-[#0d140d]">MTN</option>
                <option value="Telecel" className="bg-[#0d140d]">Telecel</option>
                <option value="AirtelTigo" className="bg-[#0d140d]">AirtelTigo</option>
              </select>
            </div>
            <Button type="submit" className="w-full h-12 rounded-xl" disabled={adding}>
              {adding ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Save Customer
            </Button>
          </form>
        </div>

        {/* Customer List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone..."
              className="pl-12 h-14 bg-white/5 border-white/10 rounded-2xl"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 bg-white/5 rounded-2xl animate-pulse" />
              ))
            ) : filtered.length > 0 ? (
              filtered.map((c) => (
                <div key={c.id} className="group bg-white/5 border border-white/10 rounded-2xl p-4 hover:border-primary/50 transition-all flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <UserIcon className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-white font-bold">{c.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-white/40 text-xs font-mono">{c.phone}</p>
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-white/10 text-white/60">
                          {c.network}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="p-2 text-white/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            ) : (
              <div className="col-span-full py-20 text-center bg-white/5 rounded-[3rem] border border-dashed border-white/10">
                <Users2 className="w-12 h-12 text-white/10 mx-auto mb-4" />
                <p className="text-white/40">No customers found.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardCustomers;
