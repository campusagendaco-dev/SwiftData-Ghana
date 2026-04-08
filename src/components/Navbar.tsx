import { Link, useLocation, useNavigate } from "react-router-dom";
import { Menu, X, Zap, LogOut } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

const Navbar = () => {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, isAdmin, signOut } = useAuth();

  const navLinks = [
    { to: "/", label: "Home" },
    { to: "/buy-data", label: "Buy Data" },
    { to: "/afa-bundles", label: "AFA Bundle" },
    { to: "/agent-program", label: "Become a Reseller" },
    ...(user && profile?.is_agent ? [{ to: "/dashboard", label: "Dashboard" }] : []),
    ...(user && isAdmin ? [{ to: "/admin", label: "Admin" }] : []),
  ];

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border">
      <div className="container mx-auto flex items-center justify-between h-16 px-4">
        <Link to="/" className="flex items-center gap-2 font-display font-bold text-xl">
          <Zap className="w-6 h-6 text-primary" />
          <span className="text-foreground">Data</span>
          <span className="text-gradient">Hive</span>
          <span className="text-muted-foreground text-sm font-medium ml-1">GH</span>
        </Link>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                location.pathname === link.to
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {link.label}
            </Link>
          ))}
          {user ? (
            <Button size="sm" variant="outline" className="ml-3" onClick={handleSignOut}>
              <LogOut className="w-4 h-4 mr-1" /> Sign Out
            </Button>
          ) : (
            <Button size="sm" className="ml-3" asChild>
              <Link to="/login">Get Started</Link>
            </Button>
          )}
        </div>

        {/* Mobile toggle */}
        <button className="md:hidden text-foreground" onClick={() => setOpen(!open)}>
          {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-background border-b border-border px-4 pb-4">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setOpen(false)}
              className={`block px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                location.pathname === link.to
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          ))}
          {user ? (
            <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => { handleSignOut(); setOpen(false); }}>
              <LogOut className="w-4 h-4 mr-1" /> Sign Out
            </Button>
          ) : (
            <Button size="sm" className="w-full mt-2" asChild>
              <Link to="/login" onClick={() => setOpen(false)}>Get Started</Link>
            </Button>
          )}
        </div>
      )}
    </nav>
  );
};

export default Navbar;
