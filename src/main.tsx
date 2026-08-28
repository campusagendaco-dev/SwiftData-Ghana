import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Global Asset Recovery & Production Build v1.2.1: Intercepts dynamic JS module import failures (typical after new app deployments or SW cache corruption)
// and seamlessly triggers an automatic hard-refresh to fetch the newest production assets, while clearing problematic service workers.
const forceAssetRecovery = async (sourceMsg?: string) => {
  console.warn("Global Asset Recovery triggered:", sourceMsg);
  
  const lastReload = localStorage.getItem("asset-failure-reload");
  const now = Date.now();
  
  // Debounce reload to prevent infinite reload loops (minimum 15 seconds interval)
  if (!lastReload || now - parseInt(lastReload, 10) > 15000) {
    localStorage.setItem("asset-failure-reload", now.toString());
    
    try {
      // 1. Clear only Workbox/asset caches — do NOT unregister service workers.
      //    Unregistering would destroy push subscriptions on devices that have
      //    already granted notification permission, causing silent notification loss.
      if ("caches" in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map(key => caches.delete(key)));
        console.log("Cleared all cache storages.");
      }
    } catch (err) {
      console.error("Asset recovery cleanup failed:", err);
    }
    
    // 3. Reload the page cleanly
    window.location.reload();
  }
};

// Expose globally so React Error Boundaries can leverage the exact same logic
(window as any).forceAssetRecovery = forceAssetRecovery;

window.addEventListener("error", (e) => {
  const msg = e.message?.toLowerCase() || "";
  const target = e.target as HTMLElement;
  const isScriptError = target && target.tagName === "SCRIPT";
  
  if (
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("expected a javascript-or-wasm module script") ||
    msg.includes("error loading dynamically imported module") ||
    msg.includes("postgres_changes") ||
    msg.includes("wallet-balance-header") ||
    msg.includes("subscribe()") ||
    isScriptError
  ) {
    forceAssetRecovery(`ErrorEvent: ${msg || "Script failed to load"}`);
  }
}, true);

window.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason?.message?.toLowerCase() || String(e.reason || "").toLowerCase();
  if (
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("expected a javascript-or-wasm module script") ||
    msg.includes("postgres_changes") ||
    msg.includes("wallet-balance-header") ||
    msg.includes("subscribe()")
  ) {
    forceAssetRecovery(`UnhandledRejection: ${msg}`);
  }
});

// Catch Vite's explicit preload failure event
window.addEventListener("vite:preloadError", (e: any) => {
  forceAssetRecovery(`VitePreloadError: Failed to load ${e.payload || "chunk"}`);
});

createRoot(document.getElementById("root")!).render(<App />);
