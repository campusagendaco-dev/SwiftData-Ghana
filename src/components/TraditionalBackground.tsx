import { useEffect, useState, memo } from "react";
import { supabase } from "@/integrations/supabase/client";

const GYE_NYAME_PATH = "M20.763 5.13303C20.732 9.04703 20.236 11.724 18.317 14.581C16.398 17.438 13.117 18.145 12.731 16.544C12.345 14.943 16.519 15.361 17.114 13.954C17.2395 13.683 17.2812 13.3807 17.2338 13.0858C17.1864 12.791 17.052 12.517 16.8479 12.2989C16.6438 12.0809 16.3794 11.9287 16.0883 11.8619C15.7972 11.7951 15.4927 11.8168 15.214 11.924C14.032 12.257 12.438 13.235 13.124 11.724C13.81 10.213 17.731 10.589 17.185 8.18702C16.639 5.78502 14.005 8.83503 13.385 8.43403C12.833 8.07703 13.2851 7.41002 13.9851 6.54902C15.3551 5.07302 16.7761 5.19703 16.9591 3.89903C17.1421 2.60103 16.024 1.44602 14.185 1.73502C12.346 2.02402 12.376 3.98403 11.409 3.89903C10.442 3.81403 11.0231 1.59102 9.64406 1.13102C9.3752 1.01368 9.08332 0.958399 8.79017 0.969307C8.49703 0.980215 8.21015 1.05704 7.95076 1.19404C7.69137 1.33104 7.46617 1.5247 7.29188 1.76066C7.1176 1.99662 6.99871 2.26881 6.94404 2.55701C6.89749 2.84792 6.91833 3.14566 7.00502 3.42722C7.09171 3.70879 7.24193 3.96666 7.44404 4.18101C5.82804 4.60401 3.58503 5.90901 2.48903 9.52601C1.63593 12.6298 1.89777 15.9344 3.22902 18.865C3.26002 14.951 3.756 12.275 5.675 9.41703C7.594 6.55903 10.8751 5.85202 11.2611 7.45402C11.6471 9.05602 7.473 8.63601 6.878 10.044C6.75255 10.315 6.71091 10.6173 6.75831 10.9122C6.80572 11.2071 6.94004 11.4811 7.14412 11.6991C7.3482 11.9172 7.61273 12.0693 7.90382 12.1361C8.19491 12.2029 8.4993 12.1813 8.77803 12.074C9.96003 11.741 11.5541 10.762 10.8681 12.274C10.1821 13.786 6.26202 13.409 6.80702 15.812C7.35202 18.215 9.98701 15.164 10.607 15.565C11.158 15.922 10.707 16.589 10.007 17.449C8.63603 18.926 7.21506 18.802 7.03206 20.1C6.84906 21.398 7.96704 22.552 9.80604 22.264C11.645 21.976 11.616 20.015 12.582 20.1C13.548 20.185 12.9681 22.408 14.3471 22.868C14.6159 22.9854 14.9077 23.0406 15.2009 23.0297C15.494 23.0188 15.7809 22.942 16.0403 22.805C16.2997 22.668 16.5249 22.4743 16.6992 22.2384C16.8735 22.0024 16.9923 21.7302 17.047 21.442C17.0935 21.1511 17.0726 20.8534 16.9859 20.5719C16.8992 20.2903 16.7491 20.0324 16.547 19.818C18.163 19.395 20.406 18.089 21.502 14.472C22.3554 11.3684 22.0939 8.06382 20.763 5.13303Z";

const SANKOFA_PATH = "M19.6709 9.689C19.5889 9.289 22.2649 8.92599 22.4889 7.74199C22.7129 6.55799 19.075 9.198 18.668 8.989C18.261 8.78 21.1299 7.18899 20.9369 5.58899C20.7439 3.98899 17.548 9.30299 17.08 8.92699C16.612 8.55099 19.7399 5.554 19.1999 3.766C18.6599 1.978 16.606 7.7 15.053 9.30899C14.2063 10.0785 13.1784 10.6208 12.0653 10.8854C10.9522 11.15 9.79034 11.1282 8.68798 10.822C7.77921 10.6882 6.90711 10.371 6.12475 9.88961C5.34239 9.40826 4.6661 8.77285 4.13696 8.02199C3.38296 6.82999 3.78991 4.95 6.15991 4.903C8.52991 4.856 9.93591 8.765 9.93591 8.765L10.36 7.318L11.37 8.247C11.37 8.247 11.718 7.847 11.688 6.304C11.658 4.761 11.288 1.519 7.20996 2.049C3.13196 2.579 0.366953 7.59099 1.13195 11.363C1.89695 15.135 6.28997 18.754 9.77697 19.106C10.0281 19.1318 10.2805 19.1431 10.533 19.14V21.014H9.02099C8.88871 21.0113 8.76075 21.0612 8.66516 21.1526C8.56956 21.2441 8.51413 21.3697 8.51098 21.502C8.51413 21.6343 8.56956 21.7599 8.66516 21.8514C8.76075 21.9428 8.88871 21.9927 9.02099 21.99H15.7489C15.8812 21.9927 16.0091 21.9428 16.1047 21.8514C16.2003 21.7599 16.2558 21.6343 16.2589 21.502C16.2558 21.3697 16.2003 21.2441 16.1047 21.1526C16.0091 21.0612 15.8812 21.0113 15.7489 21.014H14.2369V18.002H14.1909C14.5114 17.809 14.8712 17.6903 15.2436 17.6549C15.6161 17.6194 15.9917 17.668 16.3429 17.797C16.2258 17.1142 16.1501 16.4249 16.116 15.733C16.17 15.686 17.6159 16.258 17.6809 16.222C17.7459 16.186 17.2629 14.893 17.4619 14.722C17.6609 14.551 18.562 14.81 18.673 14.79C18.784 14.77 18.4659 13.855 18.2439 13.535C18.0219 13.215 19.2939 13.258 19.3009 13.063C19.3079 12.868 18.8559 12.417 18.4299 12.283C18.0039 12.149 19.868 11.892 20.052 11.748C20.236 11.604 19.557 10.914 19.704 10.868C19.851 10.822 22.1039 10.789 22.8979 10.068C23.6919 9.347 19.7499 10.09 19.6709 9.689ZM1.88 10.262C1.64 9.362 2.93899 8.7 3.61499 9.236C3.26556 9.26049 2.92652 9.36594 2.62487 9.54401C2.32323 9.72208 2.06721 9.96789 1.87695 10.262H1.88ZM2.38 11.829C1.865 10.6 3.5699 9.435 4.6289 10.071C4.14096 10.1662 3.68231 10.375 3.29003 10.6804C2.89776 10.9858 2.58294 11.3793 2.37097 11.829H2.38ZM3.328 13.676C2.311 12.294 4.073 10.368 5.583 10.86C5.00855 11.1146 4.50337 11.5031 4.10998 11.9931C3.71659 12.483 3.44635 13.0601 3.32189 13.676H3.328ZM4.78491 15.405C3.37191 13.642 5.57596 11.022 7.58496 11.59C6.84611 11.9542 6.2056 12.4905 5.71728 13.1539C5.22897 13.8173 4.90711 14.5883 4.77893 15.402L4.78491 15.405ZM13.0279 21.023H11.7429V19.002C12.1849 18.8984 12.6155 18.7507 13.0279 18.561V21.023ZM11.88 17.717C9.451 18.375 6.52397 16.017 6.71997 15.823C7.62997 14.553 10.331 17.535 11.606 16.865C12.881 16.195 6.94997 15.23 7.09997 14.248C7.24997 13.266 13.407 16.52 13.808 15.717C14.209 14.914 7.56593 13.952 8.00793 13.112C8.44993 12.272 14.992 15.112 15.292 14.119C15.592 13.126 8.69789 12.757 8.61889 12.119C8.53989 11.481 15.8639 12.071 16.2989 13.019C16.7339 13.967 14.303 17.059 11.871 17.717H11.88ZM16.8199 11.724C16.6649 12.124 15.1739 11.565 15.1659 10.816C15.1579 10.067 16.5399 9.36599 16.7899 9.70499C17.0399 10.044 16.253 10.344 16.231 10.834C16.203 11.36 16.9709 11.327 16.8149 11.724H16.8199ZM18.428 10.978C18.344 11.055 17.737 10.828 17.563 10.618C17.389 10.408 18.1989 9.697 18.2849 10.066C18.3709 10.435 18.507 10.902 18.423 10.978H18.428Z";

const SLIDESHOW_BACKGROUNDS = [
  "/assets/backgrounds/bg_motherboard_1.png",
  "/assets/backgrounds/bg_motherboard_2.png",
  "/assets/backgrounds/bg_motherboard_3.png",
  "/assets/backgrounds/bg_motherboard_4.png",
  "/assets/backgrounds/bg_motherboard_5.png",
  "/assets/backgrounds/bg_motherboard_adinkra.png",
  "/assets/backgrounds/bg_ghana_kente.png",
  "/assets/backgrounds/bg_ghana_gold_adinkra.png",
  "/assets/backgrounds/bg_ghana_warm_earth.png",
  "/assets/backgrounds/bg_data_flow.png",
  "/assets/backgrounds/bg_mesh_gradient.png",
  "/assets/backgrounds/bg_gold_ribbons.png",
  "/assets/backgrounds/bg_ghana_3d.png",
  "/assets/backgrounds/bg_world_cup.png",
  "/assets/backgrounds/bg_world_cup_gold.png",
  "/assets/backgrounds/bg_world_cup_stars.png",
];

export const TraditionalBackground = memo(({ className = "fixed inset-0 z-0 opacity-[0.15] dark:opacity-[0.25]" }: { className?: string }) => {
  const [enabled, setEnabled] = useState(true);
  const [customBgUrl, setCustomBgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data } = await supabase
          .from("public_system_settings")
          .select("traditional_background_enabled, background_custom_image_url")
          .maybeSingle();
        
        if (data) {
          setEnabled(data.traditional_background_enabled !== false);
          setCustomBgUrl(data.background_custom_image_url || null);
        }
      } catch (e) {
        console.error("Failed to load dynamic background settings:", e);
      }
    };

    fetchSettings();

    // Subscribe to real-time background settings changes
    const channelName = `background-settings-live-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes" as any,
        { event: "UPDATE", schema: "public", table: "system_settings" },
        (payload: any) => {
          const updated = payload.new;
          if (updated) {
            if ("traditional_background_enabled" in updated) {
              setEnabled(updated.traditional_background_enabled !== false);
            }
            if ("background_custom_image_url" in updated) {
              setCustomBgUrl(updated.background_custom_image_url || null);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const [bgIndex, setBgIndex] = useState(0);
  const isSlideshow = customBgUrl === "/auto_switch";

  useEffect(() => {
    if (!isSlideshow) return;
    const interval = setInterval(() => {
      setBgIndex((prev) => (prev + 1) % SLIDESHOW_BACKGROUNDS.length);
    }, 15000); // Smooth cycle every 15 seconds
    return () => clearInterval(interval);
  }, [isSlideshow]);

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (loading) return null;
  if (!enabled && !customBgUrl) return null;

  const allSymbols = [
    { top: '5%', left: '5%', size: 120, rotate: 15, delay: 0 },
    { top: '15%', right: '8%', size: 160, rotate: -10, delay: 2 },
    { bottom: '12%', left: '10%', size: 140, rotate: 25, delay: 4 },
    { bottom: '8%', right: '12%', size: 180, rotate: -20, delay: 1 },
    { top: '42%', left: '-3%', size: 80, rotate: 45, delay: 3 },
    { top: '58%', right: '-3%', size: 90, rotate: -30, delay: 5 },
  ];

  const symbols = isMobile ? allSymbols.slice(0, 3) : allSymbols;

  const getSymbol = (index: number) => {
    const type = index % 3;
    if (type === 0) return <path d={GYE_NYAME_PATH} />;
    if (type === 1) return <path d={SANKOFA_PATH} />;
    return (
      <>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1" fill="none" />
      </>
    );
  };

  const baseClasses = "w-full h-full overflow-hidden pointer-events-none select-none";

  if (customBgUrl) {
    return (
      <div className={`${className} ${baseClasses}`}>
        {isSlideshow ? (
          SLIDESHOW_BACKGROUNDS.map((bg, idx) => {
            const isActive = idx === bgIndex;
            return (
              <div
                key={bg}
                className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-[2000ms] ease-in-out"
                style={{
                  backgroundImage: `url(${bg})`,
                  opacity: isActive ? 1 : 0,
                  zIndex: isActive ? 1 : 0,
                }}
              />
            );
          })
        ) : (
          <div 
            className="absolute inset-0 bg-cover bg-center bg-no-repeat w-full h-full"
            style={{ backgroundImage: `url(${customBgUrl})` }} 
          />
        )}
      </div>
    );
  }

  return (
    <div className={`${className} ${baseClasses}`}>
      <style>
        {`
          @keyframes floatVertical {
            0% { transform: translateY(0px) translateZ(0); }
            50% { transform: translateY(-15px) translateZ(0); }
            100% { transform: translateY(0px) translateZ(0); }
          }
          @keyframes floatRotate {
            from { transform: rotate(0deg) translateZ(0); }
            to { transform: rotate(360deg) translateZ(0); }
          }
          @keyframes floatRotateRev {
            from { transform: rotate(0deg) translateZ(0); }
            to { transform: rotate(-360deg) translateZ(0); }
          }
          .bg-floating-symbol {
            will-change: transform;
            transform-style: preserve-3d;
            backface-visibility: hidden;
          }
        `}
      </style>
      {symbols.map((sym, i) => {
        const isEven = i % 2 === 0;
        return (
          <div
            key={i}
            className="absolute text-amber-600 dark:text-amber-400 bg-floating-symbol"
            style={{
              top: sym.top,
              left: sym.left,
              right: sym.right,
              bottom: sym.bottom,
              animation: `floatVertical 12s ease-in-out infinite ${sym.delay}s`,
            }}
          >
            <div
              style={{
                transform: `rotate(${sym.rotate}deg)`,
                animation: `${isEven ? 'floatRotate' : 'floatRotateRev'} 180s linear infinite`,
              }}
            >
              <svg 
                width={sym.size} 
                height={sym.size} 
                viewBox="0 0 24 24" 
                fill="currentColor" 
                xmlns="http://www.w3.org/2000/svg"
                style={{ opacity: 0.8 }}
              >
                {getSymbol(i)}
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
});

TraditionalBackground.displayName = "TraditionalBackground";
