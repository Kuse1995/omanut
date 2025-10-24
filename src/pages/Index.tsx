import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { Phone, MessageSquare, Calendar, Zap, Clock, Globe } from "lucide-react";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-app">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-accent/20 to-primary/20 animate-gradient" />
        <div className="relative max-w-7xl mx-auto px-4 py-20 sm:px-6 lg:px-8">
          <div className="text-center space-y-8">
            <h1 className="text-5xl md:text-7xl font-bold text-gradient">
              AI Receptionist for Zambia
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto">
              Never miss a booking. Answer calls, WhatsApp messages, and manage reservations 24/7 with warm, intelligent AI — in fluent Zambian English.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button 
                size="lg" 
                onClick={() => navigate('/login')}
                className="text-lg px-8 py-6"
              >
                Get Started
              </Button>
              <Button 
                size="lg" 
                variant="outline"
                onClick={() => navigate('/live-demo')}
                className="text-lg px-8 py-6"
              >
                Try Live Demo
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="max-w-7xl mx-auto px-4 py-20 sm:px-6 lg:px-8">
        <h2 className="text-3xl md:text-4xl font-bold text-center text-gradient mb-12">
          Everything Your Business Needs
        </h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          <Card className="card-glass">
            <CardContent className="pt-6 space-y-4">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                <Phone className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Phone Calls</h3>
              <p className="text-muted-foreground">
                Answer incoming calls automatically with natural-sounding AI that understands Zambian accents and local context.
              </p>
            </CardContent>
          </Card>

          <Card className="card-glass">
            <CardContent className="pt-6 space-y-4">
              <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-accent" />
              </div>
              <h3 className="text-xl font-bold text-foreground">WhatsApp Integration</h3>
              <p className="text-muted-foreground">
                <strong>WhatsApp-native receptionist</strong> — customers can text or call you in WhatsApp, and our AI answers instantly in warm Zambian English.
              </p>
            </CardContent>
          </Card>

          <Card className="card-glass">
            <CardContent className="pt-6 space-y-4">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                <Calendar className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Smart Booking</h3>
              <p className="text-muted-foreground">
                Automatically capture reservations with guest details, dates, times, and preferences — always confirming before saving.
              </p>
            </CardContent>
          </Card>

          <Card className="card-glass">
            <CardContent className="pt-6 space-y-4">
              <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center">
                <Clock className="w-6 h-6 text-accent" />
              </div>
              <h3 className="text-xl font-bold text-foreground">24/7 Availability</h3>
              <p className="text-muted-foreground">
                Never miss a booking opportunity. Your AI receptionist works around the clock, even during holidays.
              </p>
            </CardContent>
          </Card>

          <Card className="card-glass">
            <CardContent className="pt-6 space-y-4">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Instant Setup</h3>
              <p className="text-muted-foreground">
                Configure your business details, voice style, and menu in minutes. No technical knowledge required.
              </p>
            </CardContent>
          </Card>

          <Card className="card-glass">
            <CardContent className="pt-6 space-y-4">
              <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center">
                <Globe className="w-6 h-6 text-accent" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Built for Zambia</h3>
              <p className="text-muted-foreground">
                Speaks natural Zambian English, uses Kwacha pricing, and understands local business culture and etiquette.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* CTA Section */}
      <div className="bg-gradient-to-r from-primary/20 via-accent/20 to-primary/20">
        <div className="max-w-4xl mx-auto px-4 py-16 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-gradient mb-6">
            Ready to Transform Your Customer Service?
          </h2>
          <p className="text-xl text-muted-foreground mb-8">
            Join Zambian businesses already using AI to handle calls, WhatsApp messages, and bookings automatically.
          </p>
          <Button 
            size="lg" 
            onClick={() => navigate('/login')}
            className="text-lg px-8 py-6"
          >
            Start Free Trial
          </Button>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border/40">
        <div className="max-w-7xl mx-auto px-4 py-8 text-center text-muted-foreground">
          <p>© 2024 AI Receptionist. Built with ❤️ for Zambian businesses.</p>
        </div>
      </div>
    </div>
  );
};

export default Index;
