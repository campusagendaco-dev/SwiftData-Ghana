import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen, Clock, Calendar, ChevronRight } from "lucide-react";
import { BLOG_POSTS } from "@/data/blogData";
import SEO from "@/components/SEO";

const BlogList = () => {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white pt-28 pb-16 px-4">
      <SEO
        title="Guides & Resource Center"
        description="Learn how to buy cheap data bundles in Ghana, get MTN Mashup, Telecel Cash bundles, and build your own profitable data reselling business."
        keywords="cheap data bundles, ghana tech guides, buy cheap mtn data, reselling data bundles"
        url="https://swiftdatagh.shop/blog"
      />

      <div className="max-w-4xl mx-auto">
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to Home
        </Link>

        <div className="flex items-center gap-4 mb-10">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <BookOpen className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight">Guides & Tutorials</h1>
            <p className="text-muted-foreground text-sm mt-1">Get the latest insights on data bundles, saving money, and reseller tools in Ghana.</p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {BLOG_POSTS.map((post) => (
            <Link
              key={post.slug}
              to={`/blog/${post.slug}`}
              className="group flex flex-col bg-white/[0.02] border border-white/5 hover:border-amber-400/20 rounded-2xl overflow-hidden transition-all hover:shadow-xl hover:shadow-amber-400/[0.02]"
            >
              <div className="aspect-[16/9] w-full bg-secondary/50 overflow-hidden relative">
                <img
                  src={post.image}
                  alt={post.title}
                  loading="lazy"
                  width={800}
                  height={450}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <span className="absolute top-3 left-3 bg-amber-400 text-black text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md">
                  {post.category}
                </span>
              </div>
              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> {post.date}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {post.readTime}
                    </span>
                  </div>
                  <h2 className="text-lg font-black group-hover:text-amber-400 transition-colors line-clamp-2">
                    {post.title}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-3 leading-relaxed">
                    {post.excerpt}
                  </p>
                </div>
                <div className="flex items-center gap-1 text-xs font-bold text-amber-400 mt-4 group-hover:gap-2 transition-all">
                  Read Article <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BlogList;
