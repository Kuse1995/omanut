import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Phone, Clock, Calendar, Shield, Zap, Globe, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import omanutLogo from "@/assets/omanut-logo.jpg";
import ThemeToggle from "@/components/ThemeToggle";

const Home = () => {
  const navigate = useNavigate();

  const features = [
    {
      icon: Phone,
      title: "Always Available",
      description: "24/7 calls & WhatsApp replies. Your assistant never sleeps."
    },
    {
      icon: Sparkles,
      title: "Trained For Your Brand",
      description: "Dynamic per-company context. Speaks naturally in warm Zambian English."
    },
    {
      icon: Clock,
      title: "Crystal-Clear Conversations",
      description: "Powered by OpenAI Realtime. Local speech models for perfect understanding."
    },
    {
      icon: Shield,
      title: "Never Guesses",
      description: "Confirms details, repeats phone numbers in pairs, asks for clarity when needed."
    },
    {
      icon: Zap,
      title: "Credit-Based Pricing",
      description: "Pay only for what you use. No monthly salaries, no overhead."
    },
    {
      icon: Globe,
      title: "Built In Zambia • For Africa",
      description: "Multi-branch support. Multiple currencies. Real African businesses."
    }
  ];

  return (
    <div className="min-h-screen bg-app">
      {/* Header */}
      <header className="relative border-b border-border/40 backdrop-blur-sm bg-background/50">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={omanutLogo} alt="Omanut" className="h-12 w-12 rounded-xl object-cover" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                <span className="text-foreground">Omanut</span>{" "}
                <span className="font-medium text-muted-foreground">Assistant</span>
              </h1>
              <p className="text-xs text-muted-foreground">Powered by Omanut Technologies</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button variant="ghost" onClick={() => navigate('/login')}>
              Sign In
            </Button>
            <Button onClick={() => navigate('/admin/login')} className="bg-gradient-primary hover-glow">
              Admin Portal
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative container mx-auto px-6 py-32 text-center overflow-hidden">
        {/* Hero Glow Effect */}
        <div className="hero-glow absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        
        <div className="relative max-w-5xl mx-auto space-y-8 animate-fade-in">
          <div className="inline-block px-4 py-2 rounded-full border border-primary/20 bg-primary/5 text-sm text-primary mb-4">
            By Invitation Only • 2025 Beta
          </div>
          
          <h2 className="text-6xl md:text-7xl font-bold leading-[1.1] tracking-tight">
            <span className="text-gradient">The Voice of Your Business</span>
            <br />
            <span className="text-foreground">Powered by AI</span>
          </h2>
          
          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            Omanut Assistant answers every call and WhatsApp message in warm Zambian English.
            <br />
            <span className="text-foreground/80">24/7. Never misses. Always professional.</span>
          </p>
          
          <div className="flex gap-4 justify-center pt-8">
            <Button 
              size="lg" 
              onClick={() => navigate('/live-demo')} 
              className="bg-gradient-primary hover-glow text-lg px-8 h-14"
            >
              Start Free Demo
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              onClick={() => navigate('/admin/login')}
              className="text-lg px-8 h-14 border-2"
            >
              Request Access
            </Button>
          </div>
          
          <div className="pt-8 text-sm text-muted-foreground">
            Trusted by <span className="text-foreground font-medium">Streamside Resort</span> • <span className="text-foreground font-medium">North Park School</span> • <span className="text-foreground font-medium">50+ businesses</span>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="container mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h3 className="text-4xl font-bold mb-4">
            <span className="text-gradient">Always On. Always Accurate.</span>
          </h3>
          <p className="text-xl text-muted-foreground">
            The receptionist that never takes a day off
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <Card 
              key={i} 
              className="card-glass p-8 hover-scale transition-all duration-300 animate-fade-in"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="flex flex-col gap-4">
                <div className="inline-flex p-4 rounded-xl bg-gradient-primary w-fit">
                  <feature.icon className="h-7 w-7 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-xl mb-3 text-foreground">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Use Cases */}
      <section className="container mx-auto px-6 py-24">
        <h3 className="text-4xl font-bold text-center mb-4">
          <span className="text-gradient">Built For Africa's Best</span>
        </h3>
        <p className="text-xl text-center text-muted-foreground mb-16">
          We build voice assistants for Africa's most trusted brands
        </p>
        
        <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          <Card className="card-glass p-8 hover-scale transition-all">
            <h4 className="font-bold text-2xl mb-4 text-foreground">Lodges & Restaurants</h4>
            <p className="text-muted-foreground leading-relaxed">
              Poolside bookings, VIP table reservations, conference hall scheduling, 
              birthday parties, and group braais — all handled with warmth and precision.
            </p>
          </Card>
          
          <Card className="card-glass p-8 hover-scale transition-all">
            <h4 className="font-bold text-2xl mb-4 text-foreground">Schools & Training Centers</h4>
            <p className="text-muted-foreground leading-relaxed">
              Tour bookings, fee inquiries, enrollment questions, parent callbacks, 
              and detailed program information — answered instantly.
            </p>
          </Card>
          
          <Card className="card-glass p-8 hover-scale transition-all">
            <h4 className="font-bold text-2xl mb-4 text-foreground">Financial Services</h4>
            <p className="text-muted-foreground leading-relaxed">
              Loan consultation scheduling, account inquiries, appointment management, 
              and customer service — professional and compliant.
            </p>
          </Card>
          
          <Card className="card-glass p-8 hover-scale transition-all">
            <h4 className="font-bold text-2xl mb-4 text-foreground">Multi-Branch Operations</h4>
            <p className="text-muted-foreground leading-relaxed">
              Unified AI receptionist across Lusaka, Ndola, Solwezi, and beyond. 
              Branch-specific routing with centralized management.
            </p>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-6 py-32 text-center">
        <Card className="card-glass p-16 max-w-4xl mx-auto relative overflow-hidden">
          <div className="hero-glow absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          
          <div className="relative">
            <h3 className="text-5xl font-bold mb-6 leading-tight">
              <span className="text-gradient">Ready To Never Miss A Call?</span>
            </h3>
            <p className="text-muted-foreground mb-10 text-xl max-w-2xl mx-auto">
              Join the exclusive group of businesses using AI to handle every customer interaction perfectly.
            </p>
            <div className="flex gap-4 justify-center">
              <Button 
                size="lg" 
                onClick={() => navigate('/live-demo')} 
                className="bg-gradient-primary hover-glow text-lg px-10 h-14"
              >
                Talk To The AI Now
              </Button>
              <Button 
                size="lg" 
                variant="outline" 
                onClick={() => navigate('/admin/login')}
                className="text-lg px-10 h-14 border-2"
              >
                Request Access
              </Button>
            </div>
          </div>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 py-12">
        <div className="container mx-auto px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={omanutLogo} alt="Omanut" className="h-8 w-8 rounded-lg object-cover opacity-70" />
              <span className="text-sm text-muted-foreground">
                © 2025 Omanut Technologies
              </span>
            </div>
            <span className="text-sm text-muted-foreground">
              Transforming Africa's businesses with AI
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Home;
