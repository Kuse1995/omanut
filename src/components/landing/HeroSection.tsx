import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import LiveChatDemo from "./LiveChatDemo";

const HeroSection = () => {
  const navigate = useNavigate();

  return (
    <section className="relative min-h-screen flex items-center pt-20 overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px] opacity-50" />
      
      {/* Grid Pattern */}
      <div 
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px),
                           linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative max-w-7xl mx-auto px-6 py-20">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: Copy */}
          <div className="space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-sm">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-muted-foreground">Now with Voice AI</span>
              <ArrowRight className="w-3 h-3 text-primary" />
            </div>

            {/* Headline */}
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
              Your AI-powered
              <br />
              <span className="text-primary">business assistant</span>
            </h1>

            {/* Subtext */}
            <p className="text-xl text-muted-foreground max-w-lg leading-relaxed">
              Never miss a customer inquiry. Omanut handles reservations, answers questions, 
              and processes payments 24/7 via WhatsApp — while you focus on what matters.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap gap-4 pt-4">
              <Button
                size="lg"
                onClick={() => navigate("/admin/login")}
                className="gap-2 text-base px-8"
              >
                Start Free Trial
                <ArrowRight className="w-4 h-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate("/live-demo")}
                className="text-base px-8"
              >
                Watch Demo
              </Button>
            </div>

            {/* Social Proof */}
            <div className="flex items-center gap-6 pt-8 text-sm text-muted-foreground">
              <div className="flex -space-x-2">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="w-8 h-8 rounded-full bg-muted border-2 border-background"
                  />
                ))}
              </div>
              <p>
                <span className="text-foreground font-medium">500+</span> businesses trust Omanut
              </p>
            </div>
          </div>

          {/* Right: Chat Demo */}
          <div className="relative lg:pl-8">
            <div className="animate-float">
              <LiveChatDemo />
            </div>
            
            {/* Decorative Elements */}
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-primary/20 rounded-full blur-3xl" />
            <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-primary/10 rounded-full blur-2xl" />
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
