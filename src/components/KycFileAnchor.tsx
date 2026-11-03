import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * KYC documents live in a PRIVATE storage bucket. Records still hold the old
 * public-style URL, so this extracts the object path and swaps it for a
 * short-lived signed URL (readable by the owner and admins only).
 */
const KYC_BUCKET = "kyc-documents";

function kycPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/${KYC_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  return decodeURIComponent(url.slice(i + marker.length).split("?")[0]);
}

export function useKycSignedUrl(url: string | null | undefined, ttlSeconds = 600): string | null {
  const [signed, setSigned] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const path = kycPathFromUrl(url);
    if (!path) {
      setSigned(url || null);
      return;
    }
    supabase.storage
      .from(KYC_BUCKET)
      .createSignedUrl(path, ttlSeconds)
      .then(({ data }) => {
        if (!cancelled) setSigned(data?.signedUrl || null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, ttlSeconds]);
  return signed;
}

export function KycFileAnchor({
  url,
  className,
  children,
}: {
  url: string | null | undefined;
  className?: string;
  children: ReactNode | ((signedUrl: string | null) => ReactNode);
}) {
  const signed = useKycSignedUrl(url);
  return (
    <a
      href={signed || undefined}
      target="_blank"
      rel="noreferrer"
      aria-disabled={!signed}
      className={className}
    >
      {typeof children === "function" ? children(signed) : children}
    </a>
  );
}
