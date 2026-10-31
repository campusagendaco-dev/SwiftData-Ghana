import { useEffect } from "react";

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  url?: string;
  image?: string;
  type?: string;
  canonical?: string;
  jsonLd?: object | object[];
  structuredData?: object | object[];
}

const SEO = ({
  title,
  description,
  keywords,
  url = "https://swiftdatagh.shop",
  image = "https://swiftdatagh.shop/og-image.png",
  type = "website",
  canonical,
  jsonLd,
  structuredData,
}: SEOProps) => {
  useEffect(() => {
    if (title) {
      document.title = title.includes("SwiftData")
        ? title
        : `${title} | SwiftData Ghana`;
    }

    const updateMeta = (name: string, content: string, attr: "name" | "property" = "name") => {
      let element = document.querySelector(`meta[${attr}="${name}"]`);
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attr, name);
        document.head.appendChild(element);
      }
      element.setAttribute("content", content);
    };

    if (description) {
      updateMeta("description", description);
      updateMeta("og:description", description, "property");
      updateMeta("twitter:description", description);
    }

    if (keywords) {
      updateMeta("keywords", keywords);
    }

    if (title) {
      updateMeta("og:title", title, "property");
      updateMeta("twitter:title", title);
    }

    const rawCanonical = canonical || url || window.location.href;
    const finalCanonical = rawCanonical.replace(/^https:\/\/swiftdatagh\.com/i, "https://swiftdatagh.shop");
    const finalImage = image.replace(/^https:\/\/swiftdatagh\.com/i, "https://swiftdatagh.shop");

    updateMeta("og:url", finalCanonical, "property");
    updateMeta("og:type", type, "property");
    updateMeta("og:image", finalImage, "property");
    updateMeta("twitter:image", finalImage);
    updateMeta("twitter:card", "summary_large_image");

    let link = document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.setAttribute("href", finalCanonical);

    // Ensure hreflang tags point to canonical URL for Ghana & global English
    const upsertHreflang = (hreflang: string, href: string) => {
      let hl = document.querySelector(`link[rel="alternate"][hreflang="${hreflang}"]`);
      if (!hl) {
        hl = document.createElement("link");
        hl.setAttribute("rel", "alternate");
        hl.setAttribute("hreflang", hreflang);
        document.head.appendChild(hl);
      }
      hl.setAttribute("href", href);
    };
    upsertHreflang("en-GH", finalCanonical);
    upsertHreflang("en", finalCanonical);
    upsertHreflang("x-default", finalCanonical);

    // JSON-LD Schema (supports either jsonLd or structuredData prop)
    const schemaPayload = structuredData || jsonLd;
    if (schemaPayload) {
      const existingScript = document.getElementById("page-json-ld");
      if (existingScript) existingScript.remove();

      const script = document.createElement("script");
      script.id = "page-json-ld";
      script.type = "application/ld+json";
      script.innerHTML = JSON.stringify(schemaPayload);
      document.head.appendChild(script);
    }
  }, [title, description, keywords, url, image, type, canonical, jsonLd, structuredData]);

  return null;
};

export default SEO;
