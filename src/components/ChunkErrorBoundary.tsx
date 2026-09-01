import { Component, ReactNode } from "react";

interface Props { children: ReactNode }
interface State { hasError: boolean; retried: boolean }

/**
 * Catches dynamic-import chunk failures (stale hashes after deploy)
 * and auto-reloads once. On a second failure it shows a manual refresh prompt.
 */
export class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, retried: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error } as any;
  }

  componentDidCatch(error: Error) {
    const msg = error?.message?.toLowerCase() || "";
    const isStaleOrChunkError =
      msg.includes("failed to fetch dynamically imported module") ||
      msg.includes("expected a javascript-or-wasm module script") ||
      msg.includes("importing a module script failed") ||
      msg.includes("error loading dynamically imported module") ||
      msg.includes("referenceerror") ||
      msg.includes("is not defined") ||
      msg.includes("postgres_changes") ||
      msg.includes("wallet-balance-header") ||
      msg.includes("subscribe()") ||
      error?.name === "ChunkLoadError" ||
      error?.name === "ReferenceError";

    if (isStaleOrChunkError) {
      const retryKey = "chunk_boundary_retry_timestamp";
      const lastRetry = sessionStorage.getItem(retryKey);
      const now = Date.now();

      // Attempt to recover automatically if we haven't retried in the last 2 seconds
      if (!lastRetry || now - parseInt(lastRetry, 10) > 2000) {
        sessionStorage.setItem(retryKey, now.toString());
        
        if (typeof (window as any).forceAssetRecovery === "function") {
          (window as any).forceAssetRecovery(`ErrorBoundaryCatch: ${error.message}`);
        } else {
          window.location.reload();
        }
        return;
      }

      console.error("Persistent error detected. Showing safety fallback screen.", error);
      this.setState({ hasError: true });
    }
  }

  handleManualReload = async () => {
    try {
      sessionStorage.removeItem("chunk_boundary_retry_timestamp");
      localStorage.removeItem("asset-failure-reload");

      if ("caches" in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map(key => caches.delete(key)));
      }

      // Safety fallback: Unregister all service workers on manual reload to guarantee a fresh copy of everything.
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      }
    } catch (err) {
      console.error("Manual reload cleanup failed:", err);
    }

    const url = new URL(window.location.href);
    url.searchParams.set("t", Date.now().toString());
    window.location.href = url.toString();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-6 bg-[#030407]/95 backdrop-blur-md overflow-y-auto">
          <div className="text-left space-y-4 max-w-xl w-full bg-red-900/50 p-6 rounded-xl border border-red-500/50">
            <h2 className="font-black text-xl text-red-400">Application Crashed!</h2>
            <pre className="text-white/80 text-xs whitespace-pre-wrap font-mono bg-black/50 p-4 rounded-lg overflow-x-auto">
              {(this.state as any).error?.stack || (this.state as any).error?.message || "Unknown Error"}
            </pre>
            <button
              type="button"
              onClick={this.handleManualReload}
              className="w-full py-3 rounded-2xl bg-amber-400 text-black font-black text-sm hover:bg-amber-300 active:scale-95 transition-all"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
