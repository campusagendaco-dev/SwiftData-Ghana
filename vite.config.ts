import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  build: {
    sourcemap: false, // Ensures source code cannot be reconstructed from the bundle
    minify: "esbuild",
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("xlsx")) return "vendor-xlsx";
          if (id.includes("recharts")) return "vendor-recharts";
          if (id.includes("d3-") || id.includes("victory-vendor")) return "vendor-d3";
          if (id.includes("framer-motion") || id.includes("motion-dom") || id.includes("motion-utils")) return "vendor-motion";
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("@tanstack")) return "vendor-query";
          if (id.includes("html2canvas")) return "vendor-canvas";
          if (id.includes("date-fns")) return "vendor-date";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("\\react\\") ||
            id.includes("\\react-dom\\") ||
            id.includes("react-router") ||
            id.includes("@remix-run/router") ||
            id.includes("scheduler")
          ) {
            return "vendor-react";
          }
          return undefined;
        },
      },
    },
  },
  esbuild: {
    drop: ["console", "debugger"], // Removes all console.logs to prevent leaking sensitive info
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "logo.png"],
      manifest: {
        name: "SwiftData Ghana — Cheapest Data Bundles",
        short_name: "SwiftData GH",
        description: "Buy cheap non-expiry MTN, Telecel & AirtelTigo data bundles in Ghana. Instant delivery, 24/7.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#0d0d0d",
        theme_color: "#f59e0b",
        categories: ["shopping", "finance", "utilities"],
        lang: "en-GH",
        dir: "ltr",
        icons: [
          {
            src: "logo.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "logo.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          }
        ],
        shortcuts: [
          {
            name: "Buy MTN Data",
            short_name: "MTN Data",
            description: "Buy cheap MTN data bundles in Ghana",
            url: "/buy-data",
            icons: [{ src: "logo.png", sizes: "96x96", type: "image/png" }]
          },
          {
            name: "Track My Order",
            short_name: "Track Order",
            description: "Check the status of your data delivery",
            url: "/order-status",
            icons: [{ src: "logo.png", sizes: "96x96", type: "image/png" }]
          },
          {
            name: "Become an Agent",
            short_name: "Agent",
            description: "Join the SwiftData Ghana agent programme",
            url: "/agent-program",
            icons: [{ src: "logo.png", sizes: "96x96", type: "image/png" }]
          }
        ]
      },
      workbox: {
        importScripts: ["push-sw.js"],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        globPatterns: ["**/*.{ico,png,svg,html}"],
        // Never serve cached HTML for JS/CSS asset requests — prevents stale chunk errors
        navigateFallback: "index.html",
        navigateFallbackDenylist: [
          /\/assets\//,
          /^\/auth\/callback/,
          /^\/reset-password/,
          /^\/agent\/pending/,
          /^\/sub-agent\/pending/
        ],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/.*\.(?:js|css)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "swiftdata-hashed-bundles-v1",
              expiration: {
                maxEntries: 120,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /\.(?:webp|png|jpg|jpeg|svg|gif|ico|woff2?)(?:\?.*)?$/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "swiftdata-media-assets-v1",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\/(?:public_system_settings|global_package_settings|datamart_packages|promo_banners|menu_banners|agent_stores).*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "swiftdata-catalog-api-v1",
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days offline fallback
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /\.(?:mp3|wav|ogg)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "audio-cache",
              rangeRequests: true,
              cacheableResponse: {
                statuses: [0, 200, 206],
              },
            },
          },
          {
            urlPattern: /\.(?:mp4|webm|mov)(?:\?.*)?$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "swiftdata-hero-video-sw-cache",
              rangeRequests: true,
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 60, // 60 days
              },
              cacheableResponse: {
                statuses: [0, 200, 206],
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
}));
