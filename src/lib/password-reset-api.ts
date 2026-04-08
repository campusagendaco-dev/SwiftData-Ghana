type ApiResult<T = any> = {
  ok: boolean;
  status: number;
  data: T | null;
  message: string;
};

const BASE_URL =
  (import.meta.env.VITE_AUTH_API_BASE_URL as string | undefined)?.trim().replace(/\/+$/, "") ||
  "http://localhost:3000";

export const callPasswordResetApi = async <T = any>(endpoint: string, data: Record<string, any>): Promise<ApiResult<T>> => {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return {
        ok: false,
        status: response.status,
        data: null,
        message: "Password reset API is not configured correctly yet.",
      };
    }

    const json = await response.json().catch(() => null);
    const message = (json as any)?.message || (response.ok ? "Success" : "Request failed");

    return {
      ok: response.ok,
      status: response.status,
      data: json,
      message,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      message: "Password reset service is unreachable. Please try again soon.",
    };
  }
};
