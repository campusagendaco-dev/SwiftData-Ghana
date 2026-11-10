// IP to city lookup (ipgeolocation.io). The API key travels in the query string,
// so neither the key nor the request URL is ever logged here.
const TIMEOUT_MS = 3000;

export function isPrivateIp(ip: string): boolean {
  const v = String(ip ?? "").trim().toLowerCase();
  if (!v || v === "::1") return true;
  if (v.startsWith("127.") || v.startsWith("10.") || v.startsWith("192.168.")) return true;
  const m = v.match(/^172\.(\d{1,3})\./);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

export async function lookupIpCity(
  ip: string,
  apiKey: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<{ city: string; countryCode: string } | null> {
  if (!apiKey || isPrivateIp(ip)) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const url = `https://api.ipgeolocation.io/v3/ipgeo?apiKey=${encodeURIComponent(apiKey)}&ip=${encodeURIComponent(ip.trim())}`;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, TIMEOUT_MS);
    });
    const work = (async () => {
      const res = await fetchFn(url, { signal: controller.signal });
      if (res.status !== 200) return null;
      const body = await res.json();
      const city = body?.location?.city;
      const countryCode = body?.location?.country_code2;
      if (typeof city !== "string" || !city || typeof countryCode !== "string" || !countryCode) return null;
      return { city, countryCode };
    })();
    // A late rejection after the timeout wins the race must not go unhandled.
    work.catch(() => {});
    return await Promise.race([work, timeout]);
  } catch {
    return null; // deliberately silent: the error text could contain the URL
  } finally {
    if (timer) clearTimeout(timer);
  }
}
