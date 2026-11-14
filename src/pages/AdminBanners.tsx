import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Trash2, Plus, Upload, ExternalLink, Image as ImageIcon, Loader2, Save, LayoutDashboard, Menu, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface PromoBanner {
  id: string;
  banner_type: "image" | "text";
  image_url: string | null;
  content: string | null;
  background_color: string;
  text_color: string;
  target_url: string | null;
  title: string | null;
  is_active: boolean;
  priority: number;
}

const AdminBanners = () => {
  const { toast } = useToast();
  const [banners, setBanners] = useState<PromoBanner[]>([]);
  const [menuBanners, setMenuBanners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // New banner state
  const [newBanner, setNewBanner] = useState({
    banner_type: "image" as "image" | "text",
    title: "",
    content: "",
    target_url: "",
    image: null as File | null,
    background_color: "#f59e0b",
    text_color: "#000000",
    priority: 0,
  });

  const [newMenuBanner, setNewMenuBanner] = useState({
    target_url: "",
    image: null as File | null,
    priority: 0,
  });

  const fetchBanners = async () => {
    try {
      const { data: promoData } = await supabase
        .from("promo_banners")
        .select("*")
        .order("priority", { ascending: false });

      const { data: menuData } = await supabase
        .from("menu_banners")
        .select("*")
        .order("priority", { ascending: false });

      setBanners(promoData || []);
      setMenuBanners(menuData || []);
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBanners();
  }, []);

  const handleUpload = async (type: 'promo' | 'menu') => {
    const banner = type === 'promo' ? newBanner : newMenuBanner;

    if (type === 'promo') {
      if (newBanner.banner_type === "image" && !newBanner.image) {
        toast({ variant: "destructive", title: "Error", description: "Please select an image" });
        return;
      }
      if (newBanner.banner_type === "text" && !newBanner.content) {
        toast({ variant: "destructive", title: "Error", description: "Please enter banner text" });
        return;
      }
    } else {
      if (!banner.image) {
        toast({ variant: "destructive", title: "Error", description: "Please select an image" });
        return;
      }
    }

    setUploading(true);
    try {
      let imageUrl = null;

      if (banner.image) {
        const file = banner.image;
        const fileExt = file.name.split(".").pop();
        const fileName = `${type}_${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
        const filePath = `banners/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("promo-banners")
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from("promo-banners")
          .getPublicUrl(filePath);
        
        imageUrl = publicUrl;
      }

      const table = type === 'promo' ? "promo_banners" : "menu_banners";
      const payload: any = {
        image_url: imageUrl,
        target_url: banner.target_url || null,
        priority: banner.priority,
      };

      if (type === 'promo') {
        payload.banner_type = newBanner.banner_type;
        payload.content = newBanner.content || null;
        payload.background_color = newBanner.background_color;
        payload.text_color = newBanner.text_color;
        payload.title = newBanner.title || null;
      }

      const { error: dbError } = await supabase.from(table).insert(payload);
      if (dbError) throw dbError;

      toast({ title: "Success", description: `${type === 'promo' ? 'Dashboard' : 'Menu'} banner created successfully` });
      
      if (type === 'promo') {
        setNewBanner({ 
          banner_type: "image", title: "", content: "", target_url: "", 
          image: null, background_color: "#f59e0b", text_color: "#000000", priority: 0 
        });
      } else {
        setNewMenuBanner({ target_url: "", image: null, priority: 0 });
      }
      
      fetchBanners();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, type: 'promo' | 'menu') => {
    try {
      const table = type === 'promo' ? "promo_banners" : "menu_banners";
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
      toast({ title: "Deleted" });
      fetchBanners();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    }
  };

  const toggleActive = async (id: string, current: boolean, type: 'promo' | 'menu') => {
    try {
      const table = type === 'promo' ? "promo_banners" : "menu_banners";
      const { error } = await supabase.from(table).update({ is_active: !current }).eq("id", id);
      if (error) throw error;
      fetchBanners();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        <p className="text-sm text-muted-foreground">Loading banners...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Banner Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage promotional images for the app and menu.</p>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2 mb-8">
          <TabsTrigger value="dashboard" className="gap-2">
            <LayoutDashboard className="w-4 h-4" /> Dashboard Banners
          </TabsTrigger>
          <TabsTrigger value="menu" className="gap-2">
            <Menu className="w-4 h-4" /> Menu Banners
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6 mt-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="md:col-span-1 h-fit sticky top-6">
              <CardHeader>
                <CardTitle className="text-lg">Add Dashboard Banner</CardTitle>
                <CardDescription>Upload a new image or create a text card.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Tabs 
                  value={newBanner.banner_type} 
                  onValueChange={(v: any) => setNewBanner({ ...newBanner, banner_type: v })}
                  className="w-full"
                >
                  <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="image" className="gap-2">
                      <ImageIcon className="w-4 h-4" /> Image
                    </TabsTrigger>
                    <TabsTrigger value="text" className="gap-2">
                      <Save className="w-4 h-4" /> Text
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="image" className="space-y-4 mt-0">
                    <div className="space-y-2">
                      <Label>Banner Image</Label>
                      <div className="border-2 border-dashed border-white/10 rounded-xl p-6 flex flex-col items-center justify-center gap-3 bg-black/20 hover:bg-black/30 transition-all cursor-pointer relative overflow-hidden group">
                        {newBanner.image ? (
                          <div className="text-center">
                            <ImageIcon className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                            <p className="text-xs font-bold truncate max-w-[200px]">{newBanner.image.name}</p>
                            <Button 
                              variant="ghost" size="sm" className="mt-2 text-red-500 hover:text-red-400 hover:bg-red-500/10 h-7"
                              onClick={(e) => { e.stopPropagation(); setNewBanner({ ...newBanner, image: null }); }}
                            >
                              Remove
                            </Button>
                          </div>
                        ) : (
                          <>
                            <Upload className="w-8 h-8 text-white/20 group-hover:text-amber-500/50 transition-colors" />
                            <p className="text-xs text-white/50 font-bold">Click to upload image</p>
                          </>
                        )}
                        <input 
                          type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer"
                          title="Upload dashboard banner image"
                          onChange={(e) => setNewBanner({ ...newBanner, image: e.target.files?.[0] || null })}
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="text" className="space-y-4 mt-0">
                    <div className="space-y-2">
                      <Label>Promo Text (Content)</Label>
                      <Textarea 
                        placeholder="e.g. MEGA MTN PROMO!" 
                        value={newBanner.content}
                        onChange={(e) => setNewBanner({ ...newBanner, content: e.target.value })}
                        className="min-h-[100px]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Background</Label>
                        <Input type="color" value={newBanner.background_color} onChange={(e) => setNewBanner({ ...newBanner, background_color: e.target.value })} className="h-10 p-1" />
                      </div>
                      <div className="space-y-2">
                        <Label>Text Color</Label>
                        <Input type="color" value={newBanner.text_color} onChange={(e) => setNewBanner({ ...newBanner, text_color: e.target.value })} className="h-10 p-1" />
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>

                <div className="space-y-2 pt-2 border-t border-white/5">
                  <Label>Title (Optional)</Label>
                  <Input placeholder="e.g. MTN 1GB Promo" value={newBanner.title} onChange={(e) => setNewBanner({ ...newBanner, title: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Target URL (Optional)</Label>
                  <Input placeholder="e.g. /dashboard/buy-data" value={newBanner.target_url} onChange={(e) => setNewBanner({ ...newBanner, target_url: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Priority (Higher shows first)</Label>
                  <Input type="number" value={newBanner.priority} onChange={(e) => setNewBanner({ ...newBanner, priority: parseInt(e.target.value) || 0 })} />
                </div>
                <Button onClick={() => handleUpload('promo')} disabled={uploading} className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold h-11 rounded-xl gap-2 mt-4">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Create Dashboard Banner
                </Button>
              </CardContent>
            </Card>

            <div className="md:col-span-2 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-white/40 flex items-center gap-2 px-2">
                <Sparkles className="w-4 h-4" /> Active Banners ({banners.length})
              </h3>
              
              {banners.length === 0 ? (
                <div className="p-12 text-center border border-dashed border-white/10 rounded-3xl bg-white/[0.02]">
                  <ImageIcon className="w-12 h-12 text-white/10 mx-auto mb-4" />
                  <p className="text-white/40">No dashboard banners created yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {banners.map((banner) => (
                    <Card key={banner.id} className="overflow-hidden border-white/5 bg-card/50">
                      <div className="aspect-[2/1] relative group">
                        {banner.banner_type === "text" ? (
                          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center" style={{ backgroundColor: banner.background_color, color: banner.text_color }}>
                            <p className="font-black text-sm md:text-base leading-snug line-clamp-4">{banner.content}</p>
                          </div>
                        ) : (
                          <img src={banner.image_url || ""} alt={banner.title || "Banner"} className="w-full h-full object-cover" />
                        )}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <Button variant="destructive" size="icon" className="h-9 w-9 rounded-xl" onClick={() => handleDelete(banner.id, 'promo')}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </div>
                      <CardContent className="p-3 flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate">{banner.title || "Untitled Banner"}</p>
                          <p className="text-[10px] text-white/40 truncate">{banner.target_url || "No target URL"}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <Badge variant={banner.priority > 0 ? "default" : "outline"} className="text-[9px] h-5">P{banner.priority}</Badge>
                          <Switch checked={banner.is_active} onCheckedChange={() => toggleActive(banner.id, banner.is_active, 'promo')} />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="menu" className="space-y-6 mt-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="md:col-span-1 h-fit sticky top-6">
              <CardHeader>
                <CardTitle className="text-lg">Add Menu Banner</CardTitle>
                <CardDescription>Upload an image for the animated menu carousel.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Banner Image</Label>
                  <div className="border-2 border-dashed border-white/10 rounded-xl p-6 flex flex-col items-center justify-center gap-3 bg-black/20 hover:bg-black/30 transition-all cursor-pointer relative overflow-hidden group">
                    {newMenuBanner.image ? (
                      <div className="text-center">
                        <ImageIcon className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                        <p className="text-xs font-bold truncate max-w-[200px]">{newMenuBanner.image.name}</p>
                        <Button 
                          variant="ghost" size="sm" className="mt-2 text-red-500 hover:text-red-400 hover:bg-red-500/10 h-7"
                          onClick={(e) => { e.stopPropagation(); setNewMenuBanner({ ...newMenuBanner, image: null }); }}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Upload className="w-8 h-8 text-white/20 group-hover:text-amber-500/50 transition-colors" />
                        <p className="text-xs text-white/50 font-bold">Click to upload image</p>
                      </>
                    )}
                    <input 
                      type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer"
                      title="Upload menu banner image"
                      onChange={(e) => setNewMenuBanner({ ...newMenuBanner, image: e.target.files?.[0] || null })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Target URL (Optional)</Label>
                  <Input placeholder="e.g. /dashboard/support" value={newMenuBanner.target_url} onChange={(e) => setNewMenuBanner({ ...newMenuBanner, target_url: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Input type="number" value={newMenuBanner.priority} onChange={(e) => setNewMenuBanner({ ...newMenuBanner, priority: parseInt(e.target.value) || 0 })} />
                </div>
                <Button onClick={() => handleUpload('menu')} disabled={uploading} className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold h-11 rounded-xl gap-2 mt-4">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Create Menu Banner
                </Button>
              </CardContent>
            </Card>

            <div className="md:col-span-2 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-white/40 flex items-center gap-2 px-2">
                <Menu className="w-4 h-4" /> Menu Banners ({menuBanners.length})
              </h3>
              
              {menuBanners.length === 0 ? (
                <div className="p-12 text-center border border-dashed border-white/10 rounded-3xl bg-white/[0.02]">
                  <ImageIcon className="w-12 h-12 text-white/10 mx-auto mb-4" />
                  <p className="text-white/40">No menu banners created yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {menuBanners.map((banner) => (
                    <Card key={banner.id} className="overflow-hidden border-white/5 bg-card/50">
                      <div className="aspect-[16/9] relative group">
                        <img src={banner.image_url} alt="Menu Banner" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <Button variant="destructive" size="icon" className="h-9 w-9 rounded-xl" onClick={() => handleDelete(banner.id, 'menu')}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </div>
                      <CardContent className="p-3 flex items-center justify-between">
                        <p className="text-[10px] text-white/40 truncate">{banner.target_url || "No target URL"}</p>
                        <div className="flex items-center gap-3 shrink-0">
                          <Badge variant={banner.priority > 0 ? "default" : "outline"} className="text-[9px] h-5">P{banner.priority}</Badge>
                          <Switch checked={banner.is_active} onCheckedChange={() => toggleActive(banner.id, banner.is_active, 'menu')} />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminBanners;
