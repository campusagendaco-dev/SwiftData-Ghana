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
}

const SEO = ({
  title,
  description,
  keywords,
  url = "https://swiftdatagh.com",
  image = "https://swiftdatagh.com/og-image.png",
  type = "website",
  canonical,
  jsonLd,
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

    const currentUrl = url || window.location.href;
    const finalCanonical = canonical || currentUrl;

    updateMeta("og:url", currentUrl, "property");
    updateMeta("og:type", type, "property");
    updateMeta("og:image", image, "property");
    updateMeta("twitter:image", image);
    updateMeta("twitter:card", "summary_large_image");

    let link = document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.setAttribute("href", finalCanonical);

    // JSON-LD Schema
    if (jsonLd) {
      const existingScript = document.getElementById("page-json-ld");
      if (existingScript) existingScript.remove();

      const script = document.createElement("script");
      script.id = "page-json-ld";
      script.type = "application/ld+json";
      script.innerHTML = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }
  }, [title, description, keywords, url, image, type, canonical, jsonLd]);

  return null;
};

export default SEO;
