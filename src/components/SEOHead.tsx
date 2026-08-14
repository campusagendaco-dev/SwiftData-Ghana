import { useEffect } from "react";

interface SEOHeadProps {
  title?: string;
  description?: string;
  keywords?: string;
  canonical?: string;
  ogImage?: string;
  ogType?: string;
  jsonLd?: object | object[];
}

export function SEOHead({
  title = "Buy Cheap Data Bundles Ghana 2026 | #1 Best Data Site ★★★★★ — SwiftData",
  description = "Ghana's #1 rated data bundle site ★★★★★. Buy cheapest non-expiry MTN, Telecel & AirtelTigo data bundles with instant MoMo delivery. Trusted by 5,000+ customers.",
  keywords = "mtnupu, mtn upu, mtn up2u, mtnupu sites, mtn upu sites, cheapest data bundle in ghana, buy cheap data in ghana, datamart alternative, best data site in ghana, SwiftData Ghana, swiftdatagh, swiftdatagh.com",
  canonical = "https://swiftdatagh.com/",
  ogImage = "https://swiftdatagh.com/og-image.png",
  ogType = "website",
  jsonLd,
}: SEOHeadProps) {
  useEffect(() => {
    // Update Document Title
    document.title = title;

    // Helper function to set or create meta tag
    const setMeta = (attrName: string, attrVal: string, contentVal: string) => {
      let element = document.querySelector(`meta[${attrName}="${attrVal}"]`);
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attrName, attrVal);
        document.head.appendChild(element);
      }
      element.setAttribute("content", contentVal);
    };

    // Helper function to set link tag
    const setLink = (relVal: string, hrefVal: string) => {
      let element = document.querySelector(`link[rel="${relVal}"]`);
      if (!element) {
        element = document.createElement("link");
        element.setAttribute("rel", relVal);
        document.head.appendChild(element);
      }
      element.setAttribute("href", hrefVal);
    };

    // Primary Meta
    setMeta("name", "description", description);
    setMeta("name", "keywords", keywords);
    setLink("canonical", canonical);

    // OpenGraph Meta
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", canonical);
    setMeta("property", "og:image", ogImage);
    setMeta("property", "og:type", ogType);

    // Twitter Card Meta
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", ogImage);

    // JSON-LD Structured Data
    if (jsonLd) {
      const existingScript = document.getElementById("page-json-ld");
      if (existingScript) {
        existingScript.remove();
      }

      const script = document.createElement("script");
      script.id = "page-json-ld";
      script.type = "application/ld+json";
      script.innerHTML = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }
  }, [title, description, keywords, canonical, ogImage, ogType, jsonLd]);

  return null;
}
