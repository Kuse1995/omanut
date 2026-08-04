import { useNavigate } from "react-router-dom";
import { ArrowRight, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import omanutLogo from "@/assets/omanut-logo-new.png";

const Footer = () => {
  const navigate = useNavigate();

  return (
    <footer className="border-t border-border">
      {/* CTA Section */}
      <section className="py-24 px-6 bg-gradient-to-b from-transparent to-primary/5">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
            Ready to transform your
            <br />
            customer experience?
          </h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Omanut answers your customers on WhatsApp, Messenger, and Instagram 24/7 -
            so you never miss a booking, order, or inquiry. Start your free trial today.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button
              size="lg"
              onClick={() => navigate("/signup")}
              className="gap-2 text-base px-8"
            >
              Start Free Trial
              <ArrowRight className="w-4 h-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => window.open("https://wa.me/260971234567?text=Hi, I'd like to learn more about Omanut", "_blank")}
              className="gap-2 text-base px-8"
            >
              <MessageSquare className="w-4 h-4" />
              Chat with Us
            </Button>
          </div>
        </div>
      </section>

      {/* Footer Links */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <img src={omanutLogo} alt="Omanut" className="w-10 h-10 object-contain" />
              <div className="flex flex-col">
                <span className="font-semibold text-lg">Omanut</span>
                <span className="text-[10px] text-muted-foreground -mt-1">we'll figure it out!</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              AI-powered customer service for African businesses.
              Available 24/7 on WhatsApp, Messenger, and Instagram.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-medium mb-4">Product</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><a href="#features" className="hover:text-foreground transition-colors">Features</a></li>
              <li><a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a></li>
              <li><button onClick={() => navigate("/demo")} className="hover:text-foreground transition-colors">Live Demo</button></li>
              <li><button onClick={() => navigate("/signup")} className="hover:text-foreground transition-colors">Get Started</button></li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="font-medium mb-4">Company</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li>
                <a
                  href="https://wa.me/260971234567?text=Hi, I'd like to learn more about Omanut"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  Contact Us
                </a>
              </li>
              <li><button onClick={() => navigate("/demo")} className="hover:text-foreground transition-colors">Live Demo</button></li>
              <li><button onClick={() => navigate("/login")} className="hover:text-foreground transition-colors">Log In</button></li>
              <li><button onClick={() => navigate("/signup")} className="hover:text-foreground transition-colors">Create Account</button></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-medium mb-4">Legal</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><button onClick={() => navigate("/privacy")} className="hover:text-foreground transition-colors">Privacy Policy</button></li>
              <li><button onClick={() => navigate("/terms")} className="hover:text-foreground transition-colors">Terms of Service</button></li>
              <li><button onClick={() => navigate("/data-deletion")} className="hover:text-foreground transition-colors">Data Deletion</button></li>
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-12 pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Omanut Technologies Limited. All rights reserved.
          </p>
          <p className="text-sm text-muted-foreground">
            Made for African businesses.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
