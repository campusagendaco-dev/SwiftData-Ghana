import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  build: {
    sourcemap: false, // Ensures source code cannot be reconstructed from the bundle
    minify: "esbuild",
    modulePreload: {
      polyfill: false,
    },
  },
  esbuild: {
    drop: ["console", "debugger"], // Removes all console.logs to prevent leaking sensitive info
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
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
        maximumFileSizeToCacheInBytes: 10000000,
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        // Never serve cached HTML for JS/CSS asset requests — prevents stale chunk errors
        navigateFallback: "index.html",
        navigateFallbackDenylist: [
          /\/assets\//,
          /^\/auth\/callback/,
          /^\/reset-password/,
          /^\/order-status/,
          /^\/agent\/pending/,
          /^\/sub-agent\/pending/
        ],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
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
                statuses: [0, 200],
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
