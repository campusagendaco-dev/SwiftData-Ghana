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
    const isChunkError =
      msg.includes("failed to fetch dynamically imported module") ||
      msg.includes("expected a javascript-or-wasm module script") ||
      msg.includes("importing a module script failed") ||
      msg.includes("error loading dynamically imported module") ||
      error?.name === "ChunkLoadError";

    if (isChunkError) {
      const retryKey = "chunk_boundary_retry_timestamp";
      const lastRetry = sessionStorage.getItem(retryKey);
      const now = Date.now();

      // Attempt to recover automatically if we haven't retried in the last 20 seconds
      if (!lastRetry || now - parseInt(lastRetry, 10) > 20000) {
        sessionStorage.setItem(retryKey, now.toString());
        
        // Use the enhanced global recovery system to unregister SW, purge cache & reload
        if (typeof (window as any).forceAssetRecovery === "function") {
          (window as any).forceAssetRecovery(`ErrorBoundaryCatch: ${error.message}`);
        } else {
          // Fallback to simple reload if main.tsx hasn't exposed the helper
          window.location.reload();
        }
        return;
      }

      // Persistent failures within 20 seconds — display user-facing fallback state
      console.error("Persistent chunk loading error detected. Showing safety fallback screen.", error);
      this.setState({ hasError: true });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-6 bg-[#030407]/95 backdrop-blur-md overflow-y-auto">
          <div className="text-left space-y-4 max-w-xl w-full bg-red-900/50 p-6 rounded-xl border border-red-500/50">
            <h2 className="text-white font-black text-xl text-red-400">Application Crashed!</h2>
            <pre className="text-white/80 text-xs whitespace-pre-wrap font-mono bg-black/50 p-4 rounded-lg overflow-x-auto">
              {(this.state as any).error?.stack || (this.state as any).error?.message || "Unknown Error"}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
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
