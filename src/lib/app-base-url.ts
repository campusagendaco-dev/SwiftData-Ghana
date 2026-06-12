export const getAppBaseUrl = () => {
  const envSiteUrl = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim();
  const isLocalDevHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "[::1]" ||
    window.location.hostname.startsWith("192.168.") ||
    window.location.hostname.startsWith("10.") ||
    window.location.hostname.startsWith("172.");

  if (isLocalDevHost) return window.location.origin;
  if (!envSiteUrl) return window.location.origin;
  return envSiteUrl.replace(/\/+$/, "");
};

export const getActiveStoreDomain = (): string | null => {
  const host = window.location.hostname;
  const centralDomain = "swiftdatagh.shop";
  const devHosts = ["localhost", "127.0.0.1", "[::1]"];

  const isLocalDev = devHosts.some(
    (dh) => host === dh || host.startsWith("192.168.") || host.startsWith("10.") || host.startsWith("172.")
  );

  const isCentral =
    host === centralDomain ||
    host.endsWith("." + centralDomain) ||
    host.endsWith(".vercel.app") ||
    host.endsWith(".lovableproject.com");

  if (isLocalDev) {
    // Allow local development testing via a query parameter or localStorage
    const params = new URLSearchParams(window.location.search);
    const mockDomain = params.get("domain") || localStorage.getItem("dev_mock_domain");
    if (mockDomain) return mockDomain;
  }

  return (isLocalDev || isCentral) ? null : host;
};
