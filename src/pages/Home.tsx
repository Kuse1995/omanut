import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Phone, Clock, Calendar, Shield, Zap, Globe } from "lucide-react";
import { useNavigate } from "react-router-dom";
import omanutLogo from "@/assets/omanut-logo.jpg";
import ThemeToggle from "@/components/ThemeToggle";

const Home = () => {
  const navigate = useNavigate();

  const features = [
    {
      icon: Phone,
      title: "24/7 Call Answering",
      description: "Never miss a booking. Your AI receptionist answers every call, day and night."
    },
    {
      icon: Calendar,
      title: "Smart Booking Management",
      description: "Poolside, VIP, conference halls — your AI handles reservations with local Zambian warmth."
    },
    {
      icon: Clock,
      title: "Instant Response",
      description: "No hold music, no voicemail. Real-time conversations in natural Zambian English."
    },
    {
      icon: Shield,
      title: "Accurate & Reliable",
      description: "Confirms phone numbers, repeats details, never guesses — ensures perfect bookings."
    },
    {
      icon: Zap,
      title: "Credit-Based Billing",
      description: "Pay only for calls handled. No monthly salaries, no overhead costs."
    },
    {
      icon: Globe,
      title: "Multi-Location Support",
      description: "Manage multiple branches, service types, and currencies from one dashboard."
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <header className="border-b border-border/40 backdrop-blur-sm bg-background/80">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={omanutLogo} alt="Omanut" className="h-10 w-10 rounded-lg object-cover" />
            <div>
              <h1 className="text-xl font-bold text-gradient">Omanut Assistant</h1>
              <p className="text-xs text-muted-foreground">Powered by Omanut Technologies</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button variant="ghost" onClick={() => navigate('/login')}>
              Sign In
            </Button>
            <Button onClick={() => navigate('/admin/login')} className="bg-gradient-primary">
              Admin Portal
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-6 py-20 text-center">
        <div className="max-w-4xl mx-auto space-y-6">
          <h2 className="text-5xl md:text-6xl font-bold text-gradient leading-tight">
            Your AI Receptionist for Zambia
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            We answer calls in natural Zambian English, take bookings, collect WhatsApp numbers, 
            and keep your schedule full — even while you sleep.
          </p>
          <div className="flex gap-4 justify-center pt-6">
            <Button size="lg" onClick={() => navigate('/login')} className="bg-gradient-primary text-lg">
              Get Started
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate('/live-demo')}>
              Talk To Us
            </Button>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="container mx-auto px-6 py-16">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <Card key={i} className="card-glass p-6 hover:scale-105 transition-transform">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-lg bg-gradient-primary">
                  <feature.icon className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm">{feature.description}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Use Cases */}
      <section className="container mx-auto px-6 py-16">
        <h3 className="text-3xl font-bold text-center mb-12 text-gradient">
          Perfect For Every Business
        </h3>
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          <Card className="card-glass p-6">
            <h4 className="font-semibold text-lg mb-3">Lodges & Restaurants</h4>
            <p className="text-muted-foreground text-sm">
              Poolside bookings, VIP table reservations, conference hall scheduling, 
              birthday parties, and group braais.
            </p>
          </Card>
          <Card className="card-glass p-6">
            <h4 className="font-semibold text-lg mb-3">Schools & Training Centers</h4>
            <p className="text-muted-foreground text-sm">
              Tour bookings, fee inquiries, enrollment questions, and parent callbacks.
            </p>
          </Card>
          <Card className="card-glass p-6">
            <h4 className="font-semibold text-lg mb-3">Financial Services</h4>
            <p className="text-muted-foreground text-sm">
              Loan consultation scheduling, account inquiries, and appointment management.
            </p>
          </Card>
          <Card className="card-glass p-6">
            <h4 className="font-semibold text-lg mb-3">Multi-Branch Businesses</h4>
            <p className="text-muted-foreground text-sm">
              Unified AI receptionist across multiple locations with branch-specific routing.
            </p>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-6 py-20 text-center">
        <Card className="card-glass p-12 max-w-3xl mx-auto">
          <h3 className="text-3xl font-bold mb-4 text-gradient">
            Ready to Transform Your Business?
          </h3>
          <p className="text-muted-foreground mb-8 text-lg">
            Join Zambian businesses already using Omanut Assistant to never miss a call.
          </p>
          <div className="flex gap-4 justify-center">
            <Button size="lg" onClick={() => navigate('/login')} className="bg-gradient-primary">
              Start Free Trial
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate('/live-demo')}>
              Test the AI Now
            </Button>
          </div>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 py-8">
        <div className="container mx-auto px-6 text-center text-sm text-muted-foreground">
          <p>© 2025 Omanut Technologies. Transforming Zambian businesses with AI.</p>
        </div>
      </footer>
    </div>
  );
};

export default Home;
