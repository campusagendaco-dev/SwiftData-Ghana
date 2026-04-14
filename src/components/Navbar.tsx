import { Link, useLocation, useNavigate } from "react-router-dom";
import { Menu, X, LogOut } from "lucide-react";
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
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#162316] shadow-lg">
      <div className="container mx-auto flex items-center justify-between h-16 px-4">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center shrink-0">
            <span className="text-[#162316] font-black text-[9px] text-center leading-tight">SWIFT<br/>DATA</span>
          </div>
          <div className="leading-tight">
            <span className="text-white font-bold text-sm block leading-none">SwiftData GH</span>
            <span className="text-amber-400 text-[10px] leading-none">Data Reselling Platform</span>
          </div>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                location.pathname === link.to
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              }`}
            >
              {link.label}
            </Link>
          ))}
          {user ? (
            <button
              onClick={handleSignOut}
              className="ml-2 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          ) : (
            <Link
              to="/login"
              className="ml-2 bg-amber-400 hover:bg-amber-300 text-black text-sm font-bold px-4 py-2 rounded-lg transition-colors"
            >
              Get Started
            </Link>
          )}
        </div>

        {/* Mobile toggle */}
        <button className="md:hidden text-white/80 hover:text-white" onClick={() => setOpen(!open)}>
          {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-[#1a2e1a] border-t border-white/10 px-4 pb-4">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setOpen(false)}
              className={`block px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                location.pathname === link.to
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              }`}
            >
              {link.label}
            </Link>
          ))}
          {user ? (
            <button
              onClick={() => { handleSignOut(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors mt-1"
            >
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          ) : (
            <Link
              to="/login"
              onClick={() => setOpen(false)}
              className="block w-full text-center mt-2 bg-amber-400 hover:bg-amber-300 text-black text-sm font-bold px-4 py-2.5 rounded-lg transition-colors"
            >
              Get Started
            </Link>
          )}
        </div>
      )}
    </nav>
  );
};

export default Navbar;
