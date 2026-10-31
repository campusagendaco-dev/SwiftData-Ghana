import React from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { ArrowLeft, Clock, Calendar, User, Zap, ChevronRight } from "lucide-react";
import { BLOG_POSTS } from "@/data/blogData";
import SEO from "@/components/SEO";

const BlogPost = () => {
  const { slug } = useParams<{ slug: string }>();
  const post = BLOG_POSTS.find((p) => p.slug === slug);

  if (!post) {
    return <Navigate to="/blog" replace />;
  }

  const canonicalUrl = `https://swiftdatagh.shop/blog/${post.slug}`;
  const fullImageUrl = post.image.startsWith("http")
    ? post.image
    : `https://swiftdatagh.shop${post.image}`;
  const isoDate = new Date(post.date).toISOString().split("T")[0] + "T08:00:00+00:00";

  // Schema.org Article + BreadcrumbList Structured Data
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: post.title,
      image: [fullImageUrl],
      datePublished: isoDate,
      dateModified: isoDate,
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": canonicalUrl,
      },
      author: {
        "@type": "Organization",
        name: "SwiftData Ghana",
        url: "https://swiftdatagh.shop",
      },
      publisher: {
        "@type": "Organization",
        name: "SwiftData Ghana",
        logo: {
          "@type": "ImageObject",
          url: "https://swiftdatagh.shop/logo.png",
        },
      },
      description: post.excerpt,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://swiftdatagh.shop/" },
        { "@type": "ListItem", position: 2, name: "Guides & Blog", item: "https://swiftdatagh.shop/blog" },
        { "@type": "ListItem", position: 3, name: post.title, item: canonicalUrl },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white pt-28 pb-20 px-4">
      <SEO
        title={post.title}
        description={post.excerpt}
        keywords={post.keywords.join(", ")}
        url={canonicalUrl}
        canonical={canonicalUrl}
        image={fullImageUrl}
        type="article"
        structuredData={structuredData}
      />

      <div className="max-w-3xl mx-auto">
        <Link to="/blog" className="inline-flex items-center gap-2 text-muted-foreground hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to Guides
        </Link>

        <article className="space-y-6">
          <header className="space-y-4">
            <span className="bg-amber-400/10 text-amber-400 text-xs font-black uppercase tracking-wider px-3 py-1 rounded-full border border-amber-400/20">
              {post.category}
            </span>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-black leading-tight tracking-tight">
              {post.title}
            </h1>

            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground pt-2 border-b border-white/5 pb-4">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" /> {post.date}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" /> {post.readTime}
              </span>
              <span className="flex items-center gap-1.5">
                <User className="w-4 h-4" /> By {post.author}
              </span>
              <a
                href={`https://api.whatsapp.com/send?text=${encodeURIComponent("Hey! Check out this helpful guide: " + post.title + " - " + canonicalUrl)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-bold text-[#25D366] hover:text-[#128C7E] transition-colors ml-auto sm:ml-auto"
              >
                <span className="inline-block w-2 h-2 rounded-full bg-[#25D366] animate-pulse"></span>
                Share to WhatsApp
              </a>
            </div>
          </header>

          <div className="aspect-[16/9] rounded-2xl overflow-hidden bg-secondary/30 border border-white/5">
            <img src={post.image} alt={post.title} width={1200} height={675} loading="lazy" className="w-full h-full object-cover" />
          </div>

          {/* Render blog post content */}
          <div
            className="prose prose-invert prose-amber max-w-none pt-4 leading-relaxed space-y-6 text-gray-300
              prose-headings:text-white prose-headings:font-black prose-headings:tracking-tight
              prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-4 prose-h2:border-b prose-h2:border-white/5 prose-h2:pb-2
              prose-p:text-base prose-p:leading-relaxed
              prose-a:text-amber-400 prose-a:no-underline hover:prose-a:underline
              prose-ol:list-decimal prose-ol:pl-5 prose-ol:space-y-2
              prose-ul:list-disc prose-ul:pl-5 prose-ul:space-y-2
              prose-table:w-full prose-table:text-sm prose-table:my-6 prose-table:border-collapse
              prose-th:bg-white/[0.03] prose-th:px-4 prose-th:py-2.5 prose-th:text-left prose-th:font-bold prose-th:border prose-th:border-white/5
              prose-td:px-4 prose-td:py-2.5 prose-td:border prose-td:border-white/5 prose-td:text-gray-400"
            dangerouslySetInnerHTML={{ __html: post.content }}
          />

          {/* CTA Box to increase conversions */}
          <div className="mt-12 p-6 sm:p-8 rounded-2xl bg-gradient-to-r from-amber-500/10 via-amber-500/[0.02] to-transparent border border-amber-500/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div className="space-y-1">
              <h3 className="text-lg font-black flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-400 fill-amber-400" />
                Ready to Save on Data?
              </h3>
              <p className="text-sm text-muted-foreground">
                Get non-expiry MTN, Telecel & AirtelTigo bundles instantly.
              </p>
            </div>
            <Link
              to="/buy-data"
              className="inline-flex items-center justify-center gap-2 bg-amber-400 hover:bg-amber-300 text-black font-black text-sm px-6 py-3 rounded-xl transition-all shadow-lg shadow-amber-400/10 shrink-0 hover:scale-[1.02]"
            >
              Buy Cheap Data Now <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </article>
      </div>
    </div>
  );
};

export default BlogPost;
