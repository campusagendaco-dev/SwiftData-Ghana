// Persistent Offline-First Hero Video Cache Engine
// Uses CacheStorage + Blob Object URLs + localStorage metadata so the Hero background
// video plays smoothly even when the device is in offline mode or on unstable networks.

export const DEFAULT_HERO_VIDEO_URL =
  "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/site-assets/home-bg-1793265383509.mp4";

const HERO_VIDEO_CACHE_NAME = "swiftdata-hero-video-v1";
const HERO_VIDEO_META_KEY = "swiftdata_hero_video_meta_v1";

// Session-level memory map of sourceUrl -> blobUrl to avoid re-creating Blob URLs on route transitions
const sessionBlobUrlMap = new Map<string, string>();
const inFlightDownloads = new Map<string, Promise<string | null>>();

export interface HeroVideoMeta {
  url: string;
  muted: boolean;
  updatedAt: number;
}

export function normalizeHeroVideoUrl(url?: string | null): string {
  const trimmed = (url || "").trim();
  // Guard against legacy non-existent local fallback path
  if (!trimmed || trimmed === "/assets/videos/ai_video.mp4") {
    return DEFAULT_HERO_VIDEO_URL;
  }
  return trimmed;
}

export function getCachedHeroVideoMeta(): HeroVideoMeta {
  try {
    const raw = localStorage.getItem(HERO_VIDEO_META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const validUrl = normalizeHeroVideoUrl(parsed?.url);
      return {
        url: validUrl,
        muted: typeof parsed?.muted === "boolean" ? parsed.muted : true,
        updatedAt: Number(parsed?.updatedAt) || Date.now(),
      };
    }
  } catch {
    // Ignore storage read errors in private browsing
  }
  return {
    url: DEFAULT_HERO_VIDEO_URL,
    muted: true,
    updatedAt: 0,
  };
}

export function saveCachedHeroVideoMeta(url: string, muted: boolean): void {
  try {
    const validUrl = normalizeHeroVideoUrl(url);
    const payload: HeroVideoMeta = {
      url: validUrl,
      muted,
      updatedAt: Date.now(),
    };
    localStorage.setItem(HERO_VIDEO_META_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Checks if the video is already stored in CacheStorage and returns a local `blob:` URL.
 */
export async function getCachedVideoBlobUrl(rawUrl: string): Promise<string | null> {
  const targetUrl = normalizeHeroVideoUrl(rawUrl);

  if (sessionBlobUrlMap.has(targetUrl)) {
    return sessionBlobUrlMap.get(targetUrl)!;
  }

  if (typeof window === "undefined" || !("caches" in window)) {
    return null;
  }

  try {
    const cache = await window.caches.open(HERO_VIDEO_CACHE_NAME);
    const cachedResponse = await cache.match(targetUrl, { ignoreVary: true });
    if (!cachedResponse || !cachedResponse.ok) {
      return null;
    }

    const rawBlob = await cachedResponse.blob();
    if (!rawBlob || rawBlob.size < 4096) {
      // Corrupted or empty entry — remove it
      await cache.delete(targetUrl);
      return null;
    }

    const videoBlob = rawBlob.type.includes("video")
      ? rawBlob
      : new Blob([rawBlob], { type: "video/mp4" });

    const blobUrl = URL.createObjectURL(videoBlob);
    sessionBlobUrlMap.set(targetUrl, blobUrl);
    return blobUrl;
  } catch {
    return null;
  }
}

/**
 * Downloads and caches the MP4 into CacheStorage in the background so future loads
 * and offline mode work without network access. Also prunes stale video entries.
 */
export async function cacheHeroVideoInBackground(rawUrl: string): Promise<string | null> {
  const targetUrl = normalizeHeroVideoUrl(rawUrl);

  if (sessionBlobUrlMap.has(targetUrl)) {
    return sessionBlobUrlMap.get(targetUrl)!;
  }

  if (typeof window === "undefined" || !("caches" in window)) {
    return null;
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return getCachedVideoBlobUrl(targetUrl);
  }

  if (inFlightDownloads.has(targetUrl)) {
    return inFlightDownloads.get(targetUrl)!;
  }

  const downloadPromise = (async (): Promise<string | null> => {
    try {
      const existingBlobUrl = await getCachedVideoBlobUrl(targetUrl);
      if (existingBlobUrl) return existingBlobUrl;

      const response = await fetch(targetUrl, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "force-cache",
      });

      if (!response.ok || response.status !== 200) {
        return null;
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html")) {
        // Never cache an HTML 404/fallback response as a video
        return null;
      }

      const cache = await window.caches.open(HERO_VIDEO_CACHE_NAME);

      // Put cloned response into CacheStorage for persistent offline playback
      const responseClone = response.clone();
      await cache.put(targetUrl, responseClone);

      // Prune older hero videos so CacheStorage stays lean
      try {
        const keys = await cache.keys();
        for (const req of keys) {
          if (req.url !== targetUrl) {
            await cache.delete(req);
          }
        }
      } catch {
        // Ignore cleanup errors
      }

      const rawBlob = await response.blob();
      if (rawBlob && rawBlob.size >= 4096) {
        const videoBlob = rawBlob.type.includes("video")
          ? rawBlob
          : new Blob([rawBlob], { type: "video/mp4" });
        const blobUrl = URL.createObjectURL(videoBlob);
        sessionBlobUrlMap.set(targetUrl, blobUrl);
        return blobUrl;
      }
      return null;
    } catch {
      return null;
    } finally {
      inFlightDownloads.delete(targetUrl);
    }
  })();

  inFlightDownloads.set(targetUrl, downloadPromise);
  return downloadPromise;
}

/**
 * Resolves the optimal playback URL for the Hero `<video>`:
 * - Returns a cached `blob:` URL immediately if available in CacheStorage (works 100% offline).
 * - Otherwise returns the network URL for instant streaming and caches the video in the background.
 */
export async function resolveOfflineFirstVideoUrl(
  rawUrl?: string | null
): Promise<{ playbackUrl: string; isOfflineCached: boolean }> {
  const targetUrl = normalizeHeroVideoUrl(rawUrl);

  const cachedBlobUrl = await getCachedVideoBlobUrl(targetUrl);
  if (cachedBlobUrl) {
    return { playbackUrl: cachedBlobUrl, isOfflineCached: true };
  }

  // Trigger background caching without blocking initial stream playback
  void cacheHeroVideoInBackground(targetUrl);

  return { playbackUrl: targetUrl, isOfflineCached: false };
}

