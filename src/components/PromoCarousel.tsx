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
    return (
      <div className="flex gap-3 overflow-hidden">
        <Skeleton className="w-[88%] lg:w-[calc(50%-6px)] shrink-0 aspect-[2/1] lg:aspect-[21/9] rounded-[22px]" />
        <Skeleton className="w-[88%] lg:w-[calc(50%-6px)] shrink-0 aspect-[2/1] lg:aspect-[21/9] rounded-[22px]" />
      </div>
    );
  }

  if (banners.length === 0) return null;

  const pages = api ? api.scrollSnapList().length : banners.length;

  return (
    <section aria-label="Promotions" className="relative">
      <Carousel
        setApi={setApi}
        opts={{ align: "start", loop: banners.length > 2 }}
        plugins={[Autoplay({ delay: 4500, stopOnInteraction: false, stopOnMouseEnter: true })]}
        className="w-full"
      >
        <CarouselContent className="-ml-3">
          {banners.map((banner, i) => (
            <CarouselItem
              key={banner.id}
              className={`pl-3 ${banners.length > 1 ? "basis-[88%] sm:basis-[70%] lg:basis-1/2" : "basis-full"}`}
            >
              <button
                type="button"
                onClick={() => banner.target_url && navigate(banner.target_url)}
                className="group block w-full text-left rounded-[22px] p-[3px] bg-gradient-to-br from-amber-300 via-pink-300 to-emerald-300 shadow-[0_10px_30px_-14px_rgba(236,72,153,0.55)] transition-transform duration-300 hover:-translate-y-0.5 active:scale-[0.99]"
              >
                <div className="relative aspect-[2/1] lg:aspect-[21/9] overflow-hidden rounded-[19px] bg-muted">
                  {banner.banner_type === "text" ? (
                    <div
                      className="w-full h-full flex flex-col items-center justify-center p-6 text-center"
                      style={{ backgroundColor: banner.background_color, color: banner.text_color }}
                    >
                      <span aria-hidden className="absolute -top-6 -right-6 h-24 w-24 rounded-full bg-white/20" />
                      <span aria-hidden className="absolute -bottom-8 -left-4 h-20 w-20 rounded-full bg-white/15" />
                      <p className="relative font-bold text-lg sm:text-xl leading-snug max-w-[85%]">{banner.content}</p>
                    </div>
                  ) : (
                    <img
                      src={banner.image_url || ""}
                      alt={banner.title || "Promotion"}
                      loading={i < 2 ? "eager" : "lazy"}
                      decoding="async"
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                    />
                  )}

                  {banner.banner_type !== "text" && (banner.title || banner.target_url) && (
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                  )}

                  <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[10.5px] font-semibold text-pink-600 shadow-sm backdrop-blur">
                    <Sparkles className="h-3 w-3" /> Hot deal
                  </span>

                  {(banner.title || banner.target_url) && (
                    <div className="absolute inset-x-0 bottom-0 p-3 sm:p-3.5 flex items-end justify-between gap-3">
                      {banner.title ? (
                        <p className="text-white font-semibold text-[13.5px] sm:text-sm leading-snug drop-shadow max-w-[70%]">{banner.title}</p>
                      ) : (
                        <span />
                      )}
                      {banner.target_url && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-white px-3 py-1.5 text-[11.5px] font-semibold text-slate-900 shadow-md transition-transform group-hover:translate-x-0.5">
                          Grab it <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </button>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>

      {pages > 1 && (
        <div className="mt-2.5 flex justify-center gap-1.5" role="tablist" aria-label="Choose promotion">
          {Array.from({ length: pages }).map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={current === i}
              aria-label={`Promotion ${i + 1}`}
              onClick={() => api?.scrollTo(i)}
              className={`h-2 rounded-full transition-all duration-300 ${current === i ? "w-6 bg-gradient-to-r from-amber-400 to-pink-500" : "w-2 bg-foreground/15 hover:bg-foreground/30"}`}
            />
          ))}
        </div>
      )}
    </section>
  );
};

export default PromoCarousel;
