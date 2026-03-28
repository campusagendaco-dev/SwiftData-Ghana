import type { FunctionsHttpError } from "@supabase/supabase-js";

const isFunctionsHttpError = (error: unknown): error is FunctionsHttpError => {
  return !!error && typeof error === "object" && "context" in error;
};

export const getFunctionErrorMessage = async (
  error: unknown,
  fallback: string,
): Promise<string> => {
  if (!error) return fallback;

  if (isFunctionsHttpError(error) && error.context) {
    try {
      const payload = await error.context.json();
      if (payload && typeof payload === "object") {
        if (typeof (payload as { error?: unknown }).error === "string") {
          return (payload as { error: string }).error;
        }
        if (typeof (payload as { message?: unknown }).message === "string") {
          return (payload as { message: string }).message;
        }
      }
    } catch {
      // Fall back to generic error message below.
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
};
