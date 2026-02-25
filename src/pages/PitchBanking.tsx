import { useState, useEffect } from "react";
import { Bot, Send, Phone, Users, Clock, Shield, ArrowRight, Mic, CheckCircle2, MessageSquare, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import omanutLogo from "@/assets/omanut-logo-new.png";
import LiveActivityFeed from "@/components/pitch/LiveActivityFeed";

// Simulated banking chat messages
const bankingChat = [
  { role: "user" as const, content: "Hi, I need to check my account balance", delay: 1000 },
  { role: "assistant" as const, content: "Hello! I can help with that. For security, could you confirm the last 4 digits of your account number?", delay: 2500 },
  { role: "user" as const, content: "4521", delay: 4000 },
  { role: "assistant" as const, content: "Thank you! Your current balance is K12,450.00. Would you like a mini-statement or help with anything else?", delay: 5500 },
  { role: "user" as const, content: "Actually, I think my card was stolen. Can you block it?", delay: 7500 },
  { role: "assistant" as const, content: "I understand the urgency. I'm escalating this to our Card Security team immediately with your details. A specialist will contact you within 2 minutes. In the meantime, I've flagged your account for monitoring.", delay: 9000 },
];

const PitchBanking = () => {
  const [visibleMessages, setVisibleMessages] = useState<typeof bankingChat>([]);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    bankingChat.forEach((msg, i) => {
      if (msg.role === "assistant") {
        setTimeout(() => setIsTyping(true), msg.delay - 1200);
      }
      setTimeout(() => {
        setIsTyping(false);
        setVisibleMessages((prev) => [...prev, msg]);
      }, msg.delay);
    });
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
        <div className="hero-glow top-1/4 left-1/2 -translate-x-1/2 opacity-30" />

        <div className="relative z-10 max-w-5xl mx-auto px-6 text-center py-20">
          <div className="flex items-center justify-center gap-3 mb-8">
            <img src={omanutLogo} alt="Omanut" className="w-12 h-12 object-contain" />
            <span className="text-2xl font-semibold tracking-tight">Omanut</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-[1.1]">
            AI Customer Service
            <br />
            <span className="text-gradient">for Banking</span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-12">
            Automate 70% of Tier 1 inquiries on WhatsApp. 24/7 availability.
            Intelligent handoff to human agents when it matters.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button size="lg" className="hover-glow text-lg px-8 h-14">
              See It Live <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <Button variant="outline" size="lg" className="text-lg px-8 h-14">
              <Phone className="mr-2 w-5 h-5" /> Request Demo
            </Button>
          </div>
        </div>
      </section>

      {/* The Problem */}
      <section className="py-24 px-6 border-t border-border/50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-bold text-center mb-4">
            The Problem
          </h2>
          <p className="text-center text-muted-foreground text-lg mb-16 max-w-2xl mx-auto">
            Banks spend millions on customer service that frustrates both customers and staff.
          </p>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Phone,
                title: "Call Center Queues",
                stat: "$2.5M+",
                description: "Annual cost of Tier 1 call center operations. Average hold time: 12 minutes. Customer satisfaction: declining.",
              },
              {
                icon: Users,
                title: "70% Repetitive Queries",
                stat: "70%",
                description: "Of all inquiries are repetitive Tier 1: balance checks, card status, branch hours, transaction history.",
              },
              {
                icon: Clock,
                title: "Zero After-Hours Support",
                stat: "0",
                description: "Support channels available after 5 PM. Customers wait until morning for urgent issues like card theft.",
              },
            ].map((item, i) => (
              <div key={i} className="group p-8 rounded-2xl border border-destructive/20 bg-destructive/5 hover:border-destructive/40 transition-all">
                <item.icon className="w-8 h-8 text-destructive mb-4" />
                <div className="text-4xl font-bold text-destructive mb-2">{item.stat}</div>
                <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                <p className="text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The Solution */}
      <section className="py-24 px-6 bg-muted/30 border-t border-border/50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-bold text-center mb-4">
            The Solution
          </h2>
          <p className="text-center text-muted-foreground text-lg mb-16 max-w-2xl mx-auto">
            WhatsApp AI that resolves queries conversationally — not another menu bot.
          </p>

          <div className="grid lg:grid-cols-2 gap-12 items-start">
            {/* Left: Key Points */}
            <div className="space-y-8">
              {[
                { icon: MessageSquare, title: "Natural Conversation", desc: "Customers chat naturally — no pressing 1, 2, 3. AI understands context, remembers history, speaks their language." },
                { icon: Shield, title: "Secure Verification", desc: "Identity verification built into conversation flow. Compliant with banking security protocols." },
                { icon: Zap, title: "Intelligent Handoff", desc: "When AI can't resolve — it escalates with full context. Agents get a structured summary, not a cold transfer." },
              ].map((item, i) => (
                <div key={i} className="flex gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <item.icon className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg mb-1">{item.title}</h3>
                    <p className="text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Right: Simulated Chat */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-2xl shadow-primary/5">
              <div className="bg-primary/10 px-4 py-3 border-b border-border flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">Bank AI Assistant</p>
                  <p className="text-xs text-muted-foreground">WhatsApp • Always online</p>
                </div>
              </div>

              <div className="h-80 overflow-y-auto p-4 space-y-3">
                {visibleMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}>
                    <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-muted text-foreground rounded-bl-md"
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex justify-start animate-fade-in">
                    <div className="bg-muted px-4 py-3 rounded-2xl rounded-bl-md">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24 px-6 border-t border-border/50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-bold text-center mb-16">
            How It Works
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: "01", title: "Customer Texts WhatsApp", desc: "Customer sends a message to the bank's WhatsApp number — balance inquiry, card issue, branch question, anything." },
              { step: "02", title: "AI Resolves or Routes", desc: "Omanut AI handles Tier 1 instantly. For complex issues, it classifies priority and routes to the right department." },
              { step: "03", title: "Structured Agent Handoff", desc: "Human agents receive a full context summary: customer identity, issue type, conversation history, and recommended action." },
            ].map((item, i) => (
              <div key={i} className="relative p-8 rounded-2xl border border-border bg-card/50 text-center">
                <div className="text-6xl font-bold text-primary/20 mb-4">{item.step}</div>
                <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                <p className="text-muted-foreground">{item.desc}</p>
                {i < 2 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 -translate-y-1/2 z-10">
                    <ArrowRight className="w-8 h-8 text-primary/30" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Key Metrics */}
      <section className="py-24 px-6 bg-muted/30 border-t border-border/50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-bold text-center mb-16">
            Projected Impact
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { value: "70%", label: "Tier 1 Queries Automated" },
              { value: "24/7", label: "Always Available" },
              { value: "<5s", label: "Average Response Time" },
              { value: "40%", label: "Cost Reduction" },
            ].map((metric, i) => (
              <div key={i} className="text-center p-6 rounded-2xl border border-primary/20 bg-primary/5">
                <div className="text-4xl md:text-5xl font-bold text-primary mb-2">{metric.value}</div>
                <p className="text-sm text-muted-foreground">{metric.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Voice AI Teaser */}
      <section className="py-24 px-6 border-t border-border/50">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-accent/30 bg-accent/10 text-accent mb-8">
            <Mic className="w-4 h-4" />
            <span className="text-sm font-medium">Coming Soon</span>
          </div>

          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            Voice AI for Banking
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            The same intelligent AI — on phone calls. Natural voice conversations for
            customers who prefer calling. Seamless handoff to human agents with full context.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 text-muted-foreground">
            {["Natural language understanding", "Multi-language support", "Real-time transcription", "Compliance recording"].map((feat, i) => (
              <div key={i} className="flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card/50">
                <CheckCircle2 className="w-4 h-4 text-accent" />
                <span className="text-sm">{feat}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 bg-muted/30 border-t border-border/50">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            See It In Action
          </h2>
          <p className="text-xl text-muted-foreground mb-10">
            Scan the QR code below to start a WhatsApp conversation with our AI banking assistant — right now.
          </p>

          <div className="inline-block p-4 bg-white rounded-2xl shadow-lg mb-8">
            <img
              src="https://api.qrserver.com/v1/create-qr-code/?data=https%3A%2F%2Fwa.me%2F13345083612%3Ftext%3DHi&size=200x200&format=png"
              alt="Scan to chat on WhatsApp"
              className="w-48 h-48"
            />
          </div>

          <p className="text-sm text-muted-foreground mb-6">
            Or message directly: <a href="https://wa.me/13345083612?text=Hi" target="_blank" rel="noopener noreferrer" className="text-primary font-medium hover:underline">+1 (334) 508-3612</a>
          </p>

          <Button size="lg" className="hover-glow text-lg px-10 h-14 animate-pulse-glow" asChild>
            <a href="https://wa.me/13345083612?text=Hi" target="_blank" rel="noopener noreferrer">
              Try Live Demo <Send className="ml-2 w-5 h-5" />
            </a>
          </Button>
        </div>
      </section>

      {/* Live Activity Feed */}
      <LiveActivityFeed />

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-border/50 text-center">
        <div className="flex items-center justify-center gap-3">
          <img src={omanutLogo} alt="Omanut" className="w-8 h-8 object-contain" />
          <span className="text-sm text-muted-foreground">© 2025 Omanut — AI Customer Service Platform</span>
        </div>
      </footer>
    </div>
  );
};

export default PitchBanking;
