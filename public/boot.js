/* SwiftData boot script: runs before the app.
 * Kept as an external file (not inline) so the Content-Security-Policy can forbid inline scripts.
 * 1. Canonical-domain redirect   2. iOS standalone hacks
 * 3. Reseller branding / PWA manifest   4. Clone guard   5. Non-blocking web font
 */
(function () {
  var OFFICIAL_HOME = "https://swiftdatagh.shop";
  var host = (window.location.hostname || "").toLowerCase();
  var bareHost = host.replace(/^www\./, "");

  // 1. Force canonical naked domain
  if (host === "www.swiftdatagh.shop") {
    window.location.replace(OFFICIAL_HOME + window.location.pathname + window.location.search + window.location.hash);
    return;
  }

  // 2. iOS Safari standalone redirect hacks
  var path = window.location.pathname;
  var ua = navigator.userAgent || "";
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.indexOf("Mac") !== -1 && "ontouchend" in document);
  var isStandalone = window.navigator.standalone || window.matchMedia("(display-mode: standalone)").matches;
  if (isIOS && !isStandalone) {
    if (path === "/admin" || path === "/admin/") {
      window.location.replace("/admin/index.html" + window.location.search + window.location.hash);
      return;
    }
    if (path === "/dashboard" || path === "/dashboard/") {
      window.location.replace("/dashboard/index.html" + window.location.search + window.location.hash);
      return;
    }
  }

  // 5. Load the Poppins stylesheet without blocking render (replaces an inline onload handler)
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll('link[data-async-style]').forEach(function (l) { l.media = "all"; });
  });

  // Hosts where the app is ours: official domains, local development and this project's Vercel previews.
  var isOfficial = bareHost === "swiftdatagh.shop" || bareHost === "swiftdatagh.com" ||
    host.slice(-17) === ".swiftdatagh.shop" || host.slice(-16) === ".swiftdatagh.com";
  var isDev = host === "localhost" || host === "127.0.0.1" || /^192\.168\./.test(host) || /^10\./.test(host);
  var isPreview = host === "swiftdatagh.vercel.app" || /-manfreds-projects-19bc2442\.vercel\.app$/.test(host);
  var isCentral = isOfficial || isDev || isPreview;

  function applyMetadata(brand) {
    document.title = brand.name + " | Buy Cheap Data Bundles Ghana";

    var themeMeta = document.querySelector('meta[name="theme-color"]') || document.createElement("meta");
    themeMeta.setAttribute("name", "theme-color");
    themeMeta.setAttribute("content", brand.color);
    document.head.appendChild(themeMeta);

    var appTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]') || document.createElement("meta");
    appTitleMeta.setAttribute("name", "apple-mobile-web-app-title");
    appTitleMeta.setAttribute("content", brand.name);
    document.head.appendChild(appTitleMeta);

    document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach(function (el) {
      el.setAttribute("href", brand.logo);
    });

    var base = window.location.origin;
    var manifest = {
      name: brand.name,
      short_name: brand.shortName || brand.name.slice(0, 12),
      description: brand.description || "Buy cheap non-expiry MTN, Telecel & AirtelTigo data bundles in Ghana. Instant delivery, 24/7.",
      start_url: new URL(brand.startUrl || "/", base).href,
      scope: new URL("/", base).href,
      display: "standalone",
      orientation: "portrait-primary",
      background_color: "#0d0d0d",
      theme_color: brand.color,
      icons: [
        { src: new URL(brand.logo || "/logo.png", base).href, sizes: "192x192", type: "image/png", purpose: "any" },
        { src: new URL(brand.logo || "/logo.png", base).href, sizes: "512x512", type: "image/png", purpose: "any" }
      ]
    };
    document.querySelectorAll('link[rel="manifest"]').forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    var blob = new Blob([JSON.stringify(manifest)], { type: "application/json" });
    var link = document.createElement("link");
    link.setAttribute("rel", "manifest");
    link.setAttribute("href", URL.createObjectURL(blob));
    document.head.appendChild(link);
  }

  if (!isCentral) {
    // 3. Reseller custom domain: brand the app for that store.
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem("reseller_brand_" + host)); } catch (e) {}
    if (cached) applyMetadata(cached);

    // Public (anon) key: safe to ship, it only allows what row-level security allows.
    var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxzb2NkanBmbGVjZHV1bW9waWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2Nzk3NDMsImV4cCI6MjA5MTI1NTc0M30.4RnQ7s2qCXO4Qqlw1WKqTfZBfB-1Kq3toyXpGHnbv_0";
    var url = "https://lsocdjpflecduumopijn.supabase.co/rest/v1/agent_stores?custom_domain=ilike.*" +
      encodeURIComponent(bareHost) + "*&select=store_name,store_logo_url,store_primary_color,slug&limit=1";
    fetch(url, { headers: { apikey: ANON, Authorization: "Bearer " + ANON } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && data[0]) {
          var brand = {
            name: data[0].store_name || "SwiftData Store",
            shortName: (data[0].store_name || "Store").slice(0, 12),
            logo: data[0].store_logo_url || "/logo.png",
            color: data[0].store_primary_color || "#f59e0b",
            slug: data[0].slug
          };
          try { localStorage.setItem("reseller_brand_" + host, JSON.stringify(brand)); } catch (e) {}
          applyMetadata(brand);
        } else if (Array.isArray(data) && data.length === 0 && !cached) {
          // 4. Clone guard: this copy is running on a domain that is neither ours nor a registered
          // agent store. Send visitors to the official site so they never pay on a fake copy.
          window.location.replace(OFFICIAL_HOME + "/?ref=unofficial-copy");
        }
      })
      .catch(function () {});
  } else {
    var isDashboardPath = path.indexOf("/dashboard") === 0;
    var isAdminPath = path.indexOf("/admin") === 0;
    if (isDashboardPath) {
      applyMetadata({
        name: "SwiftData Reseller Dashboard",
        shortName: "SD Dashboard",
        logo: "/logo.png",
        color: "#f59e0b",
        startUrl: "/dashboard",
        description: "SwiftData reseller dashboard to manage client orders and top up float."
      });
    } else if (isAdminPath) {
      applyMetadata({
        name: "SwiftData Admin Portal",
        shortName: "SD Admin",
        logo: "/logo.png",
        color: "#ef4444",
        startUrl: "/admin",
        description: "SwiftData administrator security control and monitoring dashboard."
      });
    } else {
      var defaultThemeMeta = document.createElement("meta");
      defaultThemeMeta.setAttribute("name", "theme-color");
      defaultThemeMeta.setAttribute("content", "#000000");
      document.head.appendChild(defaultThemeMeta);
    }
  }
})();
