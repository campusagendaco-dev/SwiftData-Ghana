import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Skeleton } from "@/components/ui/skeleton";
import Autoplay from "embla-carousel-autoplay";
import { Sparkles, ChevronRight } from "lucide-react";

interface PromoBanner {
  id: string;
  banner_type: "image" | "text";
  image_url: string | null;
  content: string | null;
  background_color: string;
  text_color: string;
  target_url: string | null;
  title: string | null;
}

const PromoCarousel = () => {
  const [banners, setBanners] = useState<PromoBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchBanners = async () => {
      try {
        const { data, error } = await supabase
          .from("promo_banners")
          .select("*")
          .eq("is_active", true)
          .order("priority", { ascending: false });
        if (error) throw error;
        
        const dbBanners = (data as unknown as PromoBanner[]) || [];
        setBanners(dbBanners);
      } catch (err) {
        console.error("Error fetching banners:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchBanners();
  }, []);

  useEffect(() => {
    if (!api) return;
    setCurrent(api.selectedScrollSnap());
    api.on("select", () => setCurrent(api.selectedScrollSnap()));
  }, [api]);

  if (loading) {
    return <Skeleton className="w-full aspect-[2/1] rounded-3xl" />;
  }

  if (banners.length === 0) return null;

  return (
    <div className="relative group rounded-3xl shadow-[0_0_0_1px_rgba(251,191,36,0.12),0_12px_40px_rgba(0,0,0,0.45)]">
      <Carousel
        setApi={setApi}
        plugins={[Autoplay({ delay: 5000 })]}
        className="w-full"
      >
        <CarouselContent className="-ml-0">
          {banners.map((banner) => (
            <CarouselItem
              key={banner.id}
              className="pl-0 cursor-pointer"
              onClick={() => banner.target_url && navigate(banner.target_url)}
            >
              <div className="relative aspect-[2/1] overflow-hidden rounded-3xl">

                {/* ── Media ── */}
                {banner.banner_type === "text" ? (
                  <div
                    className="w-full h-full flex flex-col items-center justify-center p-8 text-center"
                    style={{ backgroundColor: banner.background_color, color: banner.text_color }}
                  >
                    <p className="font-black text-xl sm:text-2xl leading-tight max-w-[80%] drop-shadow">
                      {banner.content}
                    </p>
                  </div>
                ) : (
                  <img
                    src={banner.image_url || ""}
                    alt={banner.title || "Promotion"}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                  />
                )}

                {/* ── Bottom gradient overlay ── */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/[0.18] to-transparent pointer-events-none" />

                {/* ── PROMO badge ── */}
                <div className="absolute top-3 left-3 flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest text-black bg-gradient-to-r from-amber-400 to-amber-500 shadow-lg shadow-amber-500/40">
                  <Sparkles className="w-2.5 h-2.5" />
                  Promo
                </div>

                {/* ── Title + CTA at bottom ── */}
                {(banner.title || banner.target_url) && (
                  <div className="absolute bottom-0 left-0 right-0 p-4 flex items-end justify-between gap-3">
                    {banner.title && (
                      <p className="text-white font-black text-sm leading-tight drop-shadow-lg max-w-[70%]">
                        {banner.title}
                      </p>
                    )}
                    {banner.target_url && (
                      <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-[10px] font-black text-black bg-amber-400 shadow-md shadow-black/30">
                        View <ChevronRight className="w-3 h-3" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>

      {/* ── Frosted-glass dot indicators ── */}
      {banners.length > 1 && (
        <div className="absolute bottom-3 right-4 flex gap-1.5 px-2.5 py-1.5 rounded-full bg-black/45 backdrop-blur-sm border border-white/10">
          {banners.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                current === i ? "w-4 bg-amber-400" : "w-1.5 bg-white/30"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default PromoCarousel;
