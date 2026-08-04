import { Clock, Bot, Bell } from "lucide-react";

const highlights = [
  {
    icon: Clock,
    title: "Reply in seconds, 24/7",
    description: "Customers get instant answers on WhatsApp, Messenger, and Instagram - even at 2am. No queues, no missed messages.",
  },
  {
    icon: Bot,
    title: "AI that knows your business",
    description: "Train Omanut on your menu, prices, services, and hours. It answers like your best staff member, in natural local English.",
  },
  {
    icon: Bell,
    title: "You stay in control",
    description: "Bookings and important requests are forwarded to you on WhatsApp. Approve, edit, or take over any conversation in seconds.",
  },
];

const TestimonialCards = () => {
  return (
    <section id="highlights" className="py-24 px-6 bg-muted/30">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Why businesses choose
            <br />
            <span className="text-primary">Omanut</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Real results, without the heavy lifting. Here is what Omanut does for
            you from day one.
          </p>
        </div>

        {/* Highlight Grid */}
        <div className="grid md:grid-cols-3 gap-6">
          {highlights.map((highlight, index) => {
            const Icon = highlight.icon;
            return (
              <div
                key={index}
                className="group relative p-8 rounded-2xl border border-border bg-card hover:border-primary/30 transition-all duration-300"
              >
                {/* Glow Effect */}
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                <div className="relative">
                  <div className="mb-6 inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary">
                    <Icon className="w-7 h-7" />
                  </div>

                  <h3 className="text-xl font-semibold mb-3">{highlight.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {highlight.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default TestimonialCards;
