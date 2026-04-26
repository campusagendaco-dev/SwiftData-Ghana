import type { FunctionsHttpError } from "@supabase/supabase-js";

const isFunctionsHttpError = (error: unknown): error is FunctionsHttpError => {
  return !!error && typeof error === "object" && "context" in error;
};

const isRelayError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("Failed to send a request to the Edge Function") ||
    error.message.includes("FunctionsRelayError") ||
    error.message.includes("NetworkError") ||
    error.message.includes("Failed to fetch")
  );
};

const stripHtml = (html: string): string => {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    
    // Remove style and script tags entirely
    const elementsToRemove = doc.querySelectorAll("style, script");
    elementsToRemove.forEach(el => el.remove());
    
    const text = doc.body.textContent || "";
    return text.replace(/\s+/g, " ").trim();
  } catch (e) {
    console.error("HTML stripping failed:", e);
    // Simple regex fallback if DOMParser fails
    return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
               .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
               .replace(/<[^>]+>/g, ' ')
               .replace(/\s+/g, ' ')
               .trim();
  }
};

export const getFunctionErrorMessage = async (
  error: unknown,
  fallback: string,
): Promise<string> => {
  if (!error) return fallback;

  // Relay/network error — the function is unreachable (not deployed, or network issue)
  if (isRelayError(error)) {
    return "Service temporarily unavailable. Please check your connection and try again.";
  }

  // Handle direct string errors (like data?.error when it's a string)
  if (typeof error === "string" && error.trim()) {
    const msg = error.trim();
    if (msg.toLowerCase().includes("<html") || msg.toLowerCase().includes("<!doctype")) {
      return stripHtml(msg);
    }
    return msg;
  }

  if (isFunctionsHttpError(error) && error.context) {
    try {
      const payload = await error.context.json();
      if (payload && typeof payload === "object") {
        const errorMsg = (payload as { error?: string }).error || (payload as { message?: string }).message;
        if (typeof errorMsg === "string" && errorMsg.trim()) {
          const msg = errorMsg.trim();
          if (msg.toLowerCase().includes("<html") || msg.toLowerCase().includes("<!doctype")) {
            return stripHtml(msg);
          }
          return msg;
        }
      }
    } catch {
      // Fall back
    }
  }

  if (error instanceof Error && error.message) {
    const msg = error.message;
    if (msg.toLowerCase().includes("<html") || msg.toLowerCase().includes("<!doctype")) {
      return stripHtml(msg);
    }
    return msg;
  }

  const finalStr = String(fallback);
  if (finalStr.toLowerCase().includes("<html") || finalStr.toLowerCase().includes("<!doctype")) {
    return stripHtml(finalStr);
  }
  return finalStr;
};
