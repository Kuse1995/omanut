import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";

const FloatingNav = () => {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
    setMobileMenuOpen(false);
  };

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-background/80 backdrop-blur-xl border-b border-border/50"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">O</span>
            </div>
            <span className="font-semibold text-lg tracking-tight">Omanut</span>
          </div>

          {/* Desktop Menu */}
          <div className="hidden md:flex items-center gap-8">
            <button
              onClick={() => scrollToSection("features")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Features
            </button>
            <button
              onClick={() => scrollToSection("testimonials")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Customers
            </button>
            <button
              onClick={() => scrollToSection("pricing")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Pricing
            </button>
          </div>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/login")}
              className="text-muted-foreground hover:text-foreground"
            >
              Sign In
            </Button>
            <Button
              size="sm"
              onClick={() => navigate("/admin/login")}
              className="bg-primary hover:bg-primary/90"
            >
              Get Started
            </Button>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className="md:hidden p-2"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden pt-4 pb-6 space-y-4 animate-fade-in">
            <button
              onClick={() => scrollToSection("features")}
              className="block w-full text-left text-sm text-muted-foreground hover:text-foreground py-2"
            >
              Features
            </button>
            <button
              onClick={() => scrollToSection("testimonials")}
              className="block w-full text-left text-sm text-muted-foreground hover:text-foreground py-2"
            >
              Customers
            </button>
            <button
              onClick={() => scrollToSection("pricing")}
              className="block w-full text-left text-sm text-muted-foreground hover:text-foreground py-2"
            >
              Pricing
            </button>
            <div className="flex gap-3 pt-4">
              <Button variant="outline" size="sm" onClick={() => navigate("/login")} className="flex-1">
                Sign In
              </Button>
              <Button size="sm" onClick={() => navigate("/admin/login")} className="flex-1">
                Get Started
              </Button>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default FloatingNav;
