import { useLocation, useNavigate, Link } from "react-router-dom";
import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Home,
  LayoutDashboard,
  ArrowLeft,
  Search,
  Wifi,
  PhoneCall,
  Zap,
  Users,
  HelpCircle,
  Compass,
  Sparkles,
  BookOpen,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface QuickLink {
  title: string;
  description: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
  color: string;
}

const QUICK_LINKS: QuickLink[] = [
  {
    title: "Buy Data Bundles",
    description: "Instant high-speed internet data for all networks",
    href: "/buy-data",
    icon: Wifi,
    badge: "Popular",
    color: "from-blue-500/20 to-cyan-500/20 text-blue-500 border-blue-500/30",
  },
  {
    title: "Buy Airtime",
    description: "Instant airtime top-up with fast delivery",
    href: "/buy-airtime",
    icon: PhoneCall,
    color: "from-emerald-500/20 to-teal-500/20 text-emerald-500 border-emerald-500/30",
  },
  {
    title: "Pay Utilities & Bills",
    description: "ECG power, bill payments & instant services",
    href: "/buy-utility",
    icon: Zap,
    color: "from-amber-500/20 to-yellow-500/20 text-amber-500 border-amber-500/30",
  },
  {
    title: "Agent Program",
    description: "Join as an agent, set prices & earn daily commission",
    href: "/agent-program",
    icon: Users,
    badge: "Earn Money",
    color: "from-purple-500/20 to-pink-500/20 text-purple-500 border-purple-500/30",
  },
  {
    title: "User Dashboard",
    description: "Manage orders, check wallet & account details",
    href: "/dashboard",
    icon: LayoutDashboard,
    color: "from-indigo-500/20 to-violet-500/20 text-indigo-500 border-indigo-500/30",
  },
  {
    title: "Developer Portal",
    description: "Integrate automated VTU & data APIs seamlessly",
    href: "/agent-dev-docs",
    icon: BookOpen,
    color: "from-rose-500/20 to-orange-500/20 text-rose-500 border-rose-500/30",
  },
];

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [isRotating, setIsRotating] = useState(false);

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  const filteredLinks = useMemo(() => {
    if (!searchQuery.trim()) return QUICK_LINKS;
    const query = searchQuery.toLowerCase();
    return QUICK_LINKS.filter(
      (link) =>
        link.title.toLowerCase().includes(query) ||
        link.description.toLowerCase().includes(query) ||
        link.href.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const handleRefresh = () => {
    setIsRotating(true);
    setTimeout(() => {
      window.location.reload();
    }, 400);
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background text-foreground flex flex-col items-center justify-center px-4 py-12 md:py-20 selection:bg-primary/20">
      {/* Background Ambient Glow & Radial Gradients */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-primary/15 blur-[120px] animate-pulse" />
        <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-purple-600/15 blur-[120px] animate-pulse delay-700" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-blue-500/10 blur-[150px]" />
        
        {/* Subtle grid backdrop overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:36px_36px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
      </div>

      <div className="w-full max-w-4xl mx-auto flex flex-col items-center text-center z-10">
        {/* Animated 404 Hero Illustration */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="relative mb-6"
        >
          {/* Glowing Ring around compass icon */}
          <div className="relative inline-flex items-center justify-center p-6 rounded-full bg-card/70 border border-border/80 shadow-2xl backdrop-blur-xl">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
              className="absolute inset-0 rounded-full border border-dashed border-primary/40 p-1"
            />
            <Compass className="h-16 w-16 md:h-20 md:w-20 text-primary drop-shadow-[0_0_15px_rgba(var(--primary),0.5)]" />
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground shadow-lg"
            >
              !
            </motion.div>
          </div>

          {/* Big 404 Text */}
          <motion.h1
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="mt-4 text-7xl md:text-9xl font-extrabold tracking-tight bg-gradient-to-b from-foreground via-foreground/90 to-foreground/40 bg-clip-text text-transparent select-none drop-shadow-sm"
          >
            404
          </motion.h1>
        </motion.div>

        {/* Heading & Path Info */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="space-y-3 max-w-xl"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Destination Not Found</span>
          </div>

          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
            Lost in Cyberspace?
          </h2>

          <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
            The page you are looking for at{" "}
            <code className="px-2 py-0.5 rounded bg-muted font-mono text-xs font-semibold text-primary break-all border border-border">
              {location.pathname}
            </code>{" "}
            doesn&apos;t exist, may have been moved, or is temporarily offline.
          </p>
        </motion.div>

        {/* Primary Action Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3 w-full max-w-md"
        >
          <Button
            asChild
            size="lg"
            className="w-full sm:w-auto font-semibold shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all gap-2"
          >
            <Link to="/">
              <Home className="h-4 w-4" />
              Return Home
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            size="lg"
            className="w-full sm:w-auto font-semibold gap-2 border-border/80 hover:bg-muted"
          >
            <Link to="/dashboard">
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Link>
          </Button>

          <Button
            variant="ghost"
            size="lg"
            onClick={() => navigate(-1)}
            className="w-full sm:w-auto font-semibold gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            title="Reload Page"
            className="hidden sm:inline-flex text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-4 w-4 ${isRotating ? "animate-spin" : ""}`} />
          </Button>
        </motion.div>

        {/* Search Bar for Quick Navigation */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="mt-10 w-full max-w-md"
        >
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search services or pages (e.g. data, airtime, api)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 h-11 bg-card/80 backdrop-blur border-border/80 shadow-sm focus-visible:ring-primary rounded-xl text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
        </motion.div>

        {/* Quick Access Destinations Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="mt-8 w-full"
        >
          <div className="text-left mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {searchQuery ? `Search Results (${filteredLinks.length})` : "Popular Destinations"}
            </h3>
            {searchQuery && (
              <span className="text-xs text-muted-foreground">Showing matches for &quot;{searchQuery}&quot;</span>
            )}
          </div>

          {filteredLinks.length === 0 ? (
            <div className="p-8 rounded-2xl border border-dashed border-border bg-card/50 text-center space-y-2">
              <HelpCircle className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-medium">No destinations found matching &quot;{searchQuery}&quot;</p>
              <p className="text-xs text-muted-foreground">Try searching for &quot;data&quot;, &quot;airtime&quot;, or &quot;dashboard&quot;</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 text-left">
              {filteredLinks.map((link, index) => {
                const IconComponent = link.icon;
                return (
                  <motion.div
                    key={link.href}
                    whileHover={{ y: -3, scale: 1.01 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  >
                    <Link
                      to={link.href}
                      className="group flex flex-col justify-between p-4 rounded-xl border border-border/70 bg-card/60 hover:bg-card hover:border-primary/40 backdrop-blur-md shadow-sm hover:shadow-md transition-all h-full"
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className={`p-2.5 rounded-lg border bg-gradient-to-br ${link.color}`}>
                          <IconComponent className="h-5 w-5" />
                        </div>
                        {link.badge && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                            {link.badge}
                          </span>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-1.5 text-sm font-semibold group-hover:text-primary transition-colors">
                          <span>{link.title}</span>
                          <ArrowRight className="h-3.5 w-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-primary" />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                          {link.description}
                        </p>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* Footer Support Banner */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="mt-12 pt-6 border-t border-border/50 w-full flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground"
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
            <span>SwiftData Systems Operational</span>
          </div>

          <div className="flex items-center gap-4">
            <Link to="/dashboard/report-issue" className="hover:text-primary transition-colors">
              Report Broken Link
            </Link>
            <span>•</span>
            <a
              href="https://wa.me/233000000000"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors flex items-center gap-1"
            >
              Customer Support
            </a>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default NotFound;

