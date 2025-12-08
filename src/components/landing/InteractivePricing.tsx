import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const plans = [
  {
    name: "Starter",
    description: "Perfect for small businesses getting started",
    monthlyPrice: 0,
    yearlyPrice: 0,
    credits: 100,
    features: [
      "100 AI credits/month",
      "1 company",
      "WhatsApp messaging",
      "Basic analytics",
      "Email support",
    ],
    cta: "Start Free",
    popular: false,
  },
  {
    name: "Growth",
    description: "For growing businesses with more volume",
    monthlyPrice: 99,
    yearlyPrice: 79,
    credits: 1000,
    features: [
      "1,000 AI credits/month",
      "3 companies",
      "WhatsApp + Voice AI",
      "Multi-agent routing",
      "Calendar integration",
      "Priority support",
    ],
    cta: "Start Trial",
    popular: true,
  },
  {
    name: "Business",
    description: "Full-featured for established businesses",
    monthlyPrice: 299,
    yearlyPrice: 249,
    credits: 5000,
    features: [
      "5,000 AI credits/month",
      "Unlimited companies",
      "All channels",
      "Custom agent prompts",
      "Advanced analytics",
      "API access",
      "Dedicated support",
    ],
    cta: "Start Trial",
    popular: false,
  },
  {
    name: "Enterprise",
    description: "Custom solutions for large organizations",
    monthlyPrice: null,
    yearlyPrice: null,
    credits: null,
    features: [
      "Unlimited credits",
      "White-label solution",
      "Custom integrations",
      "SLA guarantees",
      "On-premise option",
      "24/7 phone support",
      "Dedicated success manager",
    ],
    cta: "Contact Sales",
    popular: false,
  },
];

const InteractivePricing = () => {
  const navigate = useNavigate();
  const [yearly, setYearly] = useState(false);

  return (
    <section id="pricing" className="py-24 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Simple, transparent
            <br />
            <span className="text-primary">credit-based pricing</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            Pay only for what you use. Each message, call, or action uses credits. 
            No hidden fees, no surprises.
          </p>

          {/* Billing Toggle */}
          <div className="flex items-center justify-center gap-4">
            <span className={`text-sm ${!yearly ? "text-foreground" : "text-muted-foreground"}`}>
              Monthly
            </span>
            <Switch
              checked={yearly}
              onCheckedChange={setYearly}
            />
            <span className={`text-sm ${yearly ? "text-foreground" : "text-muted-foreground"}`}>
              Yearly
              <span className="ml-2 text-xs text-primary font-medium">Save 20%</span>
            </span>
          </div>
        </div>

        {/* Pricing Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan, index) => (
            <div
              key={index}
              className={`relative p-6 rounded-2xl border transition-all duration-300 ${
                plan.popular
                  ? "border-primary bg-primary/5 scale-105 shadow-xl shadow-primary/10"
                  : "border-border bg-card hover:border-primary/30"
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    Most Popular
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-xl font-semibold mb-1">{plan.name}</h3>
                <p className="text-sm text-muted-foreground">{plan.description}</p>
              </div>

              <div className="mb-6">
                {plan.monthlyPrice !== null ? (
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">
                      ${yearly ? plan.yearlyPrice : plan.monthlyPrice}
                    </span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                ) : (
                  <div className="text-4xl font-bold">Custom</div>
                )}
                {plan.credits && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {plan.credits.toLocaleString()} credits/month
                  </p>
                )}
              </div>

              <Button
                className="w-full mb-6"
                variant={plan.popular ? "default" : "outline"}
                onClick={() => navigate("/admin/login")}
              >
                {plan.cta}
              </Button>

              <ul className="space-y-3">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default InteractivePricing;
