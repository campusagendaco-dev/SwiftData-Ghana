export interface CachedBuyCatalog {
  globalSettings: Record<string, any>;
  korbaMappings: { package_name: string; network: string; raw_data: any }[];
  networkStatusMap: Record<string, string>;
  priceMultipliers: Record<string, number>;
  activeGateway?: string;
  mtnExpressModeEnabled?: boolean;
  holidayMode?: boolean;
  holidayMessage?: string;
  orderingDisabled?: boolean;
  updatedAt: number;
}

export interface CachedRecipientMeta {
  resolvedName?: string | null;
  beneficiaryStatus?: "verified" | "not_verified" | "not_required";
  beneficiaryMessage?: string;
  updatedAt: number;
}

export interface PendingGuestOrderDraft {
  network: "MTN" | "MTN Mash Up" | "Telecel" | "AirtelTigo" | string;
  category: string;
  pkg?: { size: string; price: number };
  packageSize?: string;
  price?: number;
  total?: number;
  fee?: number;
  phone: string;
  email?: string;
  resolvedName?: string | null;
  metadata?: Record<string, any>;
  savedAt: number;
}

export interface CachedOrderLookupEntry {
  orders?: any[];
  orderData?: any;
  orderNetwork?: string;
  orderPackageSize?: string;
  orderPhone?: string;
  orderType?: any;
  orderStatus?: any;
  statusMessage?: string | null;
  failed?: boolean;
  updatedAt: number;
}

const CATALOG_CACHE_KEY = "swiftdata_buy_catalog_v1";
const RECIPIENT_META_CACHE_KEY = "swiftdata_recipient_meta_v1";
const GUEST_DRAFT_CACHE_KEY = "swiftdata_pending_guest_draft_v1";
const ORDER_LOOKUP_CACHE_KEY = "swiftdata_order_lookup_cache_v1";

export function getCachedBuyCatalog(): CachedBuyCatalog | null {
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedBuyCatalog;
    if (!parsed || typeof parsed !== "object" || !parsed.globalSettings) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCachedBuyCatalog(data: Omit<CachedBuyCatalog, "updatedAt">): void {
  try {
    const payload: CachedBuyCatalog = {
      ...data,
      updatedAt: Date.now(),
    };
    localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
}

export function getCachedRecipientMeta(phoneDigits: string, network: string): CachedRecipientMeta | null {
  if (!phoneDigits || phoneDigits.length < 9) return null;
  try {
    const raw = localStorage.getItem(RECIPIENT_META_CACHE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, CachedRecipientMeta>;
    const key = `${network.toUpperCase()}-${phoneDigits}`;
    const entry = map[key] || map[`ANY-${phoneDigits}`];
    if (!entry) return null;
    // Keep recipient metadata valid for 14 days
    if (Date.now() - entry.updatedAt > 14 * 24 * 60 * 60 * 1000) return null;
    return entry;
  } catch {
    return null;
  }
}

export function saveCachedRecipientMeta(
  phoneDigits: string,
  network: string,
  meta: Partial<Omit<CachedRecipientMeta, "updatedAt">>
): void {
  if (!phoneDigits || phoneDigits.length < 9) return;
  try {
    const raw = localStorage.getItem(RECIPIENT_META_CACHE_KEY);
    const map: Record<string, CachedRecipientMeta> = raw ? JSON.parse(raw) : {};
    const key = `${network.toUpperCase()}-${phoneDigits}`;
    const existing = map[key] || { updatedAt: Date.now() };
    map[key] = {
      ...existing,
      ...meta,
      updatedAt: Date.now(),
    };
    if (meta.resolvedName) {
      map[`ANY-${phoneDigits}`] = {
        ...(map[`ANY-${phoneDigits}`] || {}),
        resolvedName: meta.resolvedName,
        updatedAt: Date.now(),
      };
    }
    // Cap to 40 entries
    const keys = Object.keys(map);
    if (keys.length > 40) {
      const oldestKey = keys.sort((a, b) => (map[a]?.updatedAt || 0) - (map[b]?.updatedAt || 0))[0];
      if (oldestKey) delete map[oldestKey];
    }
    localStorage.setItem(RECIPIENT_META_CACHE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

export function savePendingGuestOrderDraft(draft: Omit<PendingGuestOrderDraft, "savedAt">): void {
  try {
    const payload: PendingGuestOrderDraft = {
      ...draft,
      savedAt: Date.now(),
    };
    localStorage.setItem(GUEST_DRAFT_CACHE_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent("offline-draft-changed", { detail: payload }));
  } catch {
    // Ignore storage errors
  }
}

export function getPendingGuestOrderDraft(): PendingGuestOrderDraft | null {
  try {
    const raw = localStorage.getItem(GUEST_DRAFT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingGuestOrderDraft;
    // Expire drafts older than 2 hours
    if (Date.now() - parsed.savedAt > 2 * 60 * 60 * 1000) {
      localStorage.removeItem(GUEST_DRAFT_CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingGuestOrderDraft(): void {
  try {
    localStorage.removeItem(GUEST_DRAFT_CACHE_KEY);
    window.dispatchEvent(new CustomEvent("offline-draft-changed", { detail: null }));
  } catch {
    // Ignore
  }
}

export function saveCachedOrderLookup(queryKey: string, payload: any[] | Partial<Omit<CachedOrderLookupEntry, "updatedAt">>): void {
  const cleanKey = queryKey.trim().toLowerCase();
  if (!cleanKey || !payload) return;
  if (Array.isArray(payload) && payload.length === 0) return;
  try {
    const raw = localStorage.getItem(ORDER_LOOKUP_CACHE_KEY);
    const map: Record<string, CachedOrderLookupEntry> = raw ? JSON.parse(raw) : {};
    const existing = map[cleanKey] || { updatedAt: Date.now() };
    map[cleanKey] = Array.isArray(payload)
      ? {
          ...existing,
          orders: payload.slice(0, 15),
          updatedAt: Date.now(),
        }
      : {
          ...existing,
          ...payload,
          updatedAt: Date.now(),
        };
    const keys = Object.keys(map);
    if (keys.length > 20) {
      const oldest = keys.sort((a, b) => (map[a]?.updatedAt || 0) - (map[b]?.updatedAt || 0))[0];
      if (oldest) delete map[oldest];
    }
    localStorage.setItem(ORDER_LOOKUP_CACHE_KEY, JSON.stringify(map));
  } catch {
    // Ignore
  }
}

export function getCachedOrderLookup(queryKey: string): CachedOrderLookupEntry | null {
  const cleanKey = queryKey.trim().toLowerCase();
  if (!cleanKey) return null;
  try {
    const raw = localStorage.getItem(ORDER_LOOKUP_CACHE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, CachedOrderLookupEntry>;
    return map[cleanKey] || null;
  } catch {
    return null;
  }
}

