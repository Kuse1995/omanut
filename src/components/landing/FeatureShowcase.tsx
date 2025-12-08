import { 
  MessageSquare, 
  Phone, 
  Calendar, 
  CreditCard, 
  Bot, 
  Bell,
  Zap,
  Shield
} from "lucide-react";

const features = [
  {
    icon: MessageSquare,
    title: "WhatsApp Integration",
    description: "Native WhatsApp Business API integration. Respond to customers instantly on their favorite platform.",
    size: "large",
  },
  {
    icon: Phone,
    title: "Voice AI Calls",
    description: "Handle phone calls with natural AI voice. Perfect for complex inquiries.",
    size: "small",
  },
  {
    icon: Bot,
    title: "Multi-Agent System",
    description: "Smart routing between sales, support, and human agents.",
    size: "small",
  },
  {
    icon: Calendar,
    title: "Reservation Management",
    description: "Automated booking with calendar sync, conflict detection, and boss approval workflow.",
    size: "medium",
  },
  {
    icon: CreditCard,
    title: "Payment Processing",
    description: "Accept mobile money payments. MTN, Airtel, Zamtel supported.",
    size: "medium",
  },
  {
    icon: Bell,
    title: "Boss Notifications",
    description: "Instant WhatsApp alerts for important events.",
    size: "small",
  },
  {
    icon: Zap,
    title: "Proactive Follow-ups",
    description: "AI-driven sales engagement campaigns.",
    size: "small",
  },
  {
    icon: Shield,
    title: "Enterprise Security",
    description: "RLS policies, JWT auth, encrypted data.",
    size: "small",
  },
];

const FeatureShowcase = () => {
  return (
    <section id="features" className="py-24 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Everything you need to
            <br />
            <span className="text-primary">automate customer service</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            A complete AI-powered platform that handles customer inquiries, bookings, 
            and payments while you focus on growing your business.
          </p>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            const isLarge = feature.size === "large";
            const isMedium = feature.size === "medium";
            
            return (
              <div
                key={index}
                className={`group relative p-6 rounded-2xl border border-border bg-card/50 hover:bg-card hover:border-primary/30 transition-all duration-300 ${
                  isLarge ? "md:col-span-2 md:row-span-2" : ""
                } ${isMedium ? "lg:col-span-2" : ""}`}
              >
                {/* Glow Effect */}
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                
                <div className="relative">
                  <div className={`mb-4 inline-flex items-center justify-center rounded-xl bg-primary/10 text-primary ${isLarge ? "w-14 h-14" : "w-12 h-12"}`}>
                    <Icon className={isLarge ? "w-7 h-7" : "w-5 h-5"} />
                  </div>
                  
                  <h3 className={`font-semibold mb-2 ${isLarge ? "text-2xl" : "text-lg"}`}>
                    {feature.title}
                  </h3>
                  
                  <p className={`text-muted-foreground ${isLarge ? "text-base" : "text-sm"}`}>
                    {feature.description}
                  </p>
                  
                  {isLarge && (
                    <div className="mt-6 p-4 rounded-xl bg-muted/50 border border-border">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                          <Bot className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1">
                          <div className="h-2 bg-muted rounded w-3/4" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="h-2 bg-muted rounded w-full" />
                        <div className="h-2 bg-muted rounded w-5/6" />
                        <div className="h-2 bg-muted rounded w-4/6" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default FeatureShowcase;
