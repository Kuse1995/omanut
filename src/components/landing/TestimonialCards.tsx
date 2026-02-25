import { Star } from "lucide-react";

const testimonials = [
  {
    quote: "We've never missed a booking since deploying Omanut. The AI handles 95% of inquiries automatically, and our staff can focus on delivering great experiences.",
    author: "Sarah Mwanza",
    role: "General Manager",
    company: "Streamside Resort",
    rating: 5,
  },
  {
    quote: "The multi-agent routing is brilliant. Sales inquiries go to the right AI, support issues get handled properly, and I only get notified when truly needed.",
    author: "James Phiri",
    role: "Operations Director",
    company: "Finch Investments",
    rating: 5,
  },
  {
    quote: "Our call center was drowning in balance inquiries and card status requests. Omanut automated 68% of Tier 1 queries in the first month — our agents now focus on complex cases.",
    author: "David Chisanga",
    role: "Head of Digital Banking",
    company: "Capital Finance Group",
    rating: 5,
  },
];

const TestimonialCards = () => {
  return (
    <section id="testimonials" className="py-24 px-6 bg-muted/30">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Loved by businesses
            <br />
            <span className="text-primary">across Africa</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            See what our customers have to say about transforming their 
            customer service with Omanut.
          </p>
        </div>

        {/* Testimonial Grid */}
        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((testimonial, index) => (
            <div
              key={index}
              className="group relative p-8 rounded-2xl border border-border bg-card hover:border-primary/30 transition-all duration-300"
            >
              {/* Quote Glow */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              
              <div className="relative">
                {/* Stars */}
                <div className="flex gap-1 mb-6">
                  {Array.from({ length: testimonial.rating }).map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-primary text-primary" />
                  ))}
                </div>

                {/* Quote */}
                <blockquote className="text-foreground mb-8 leading-relaxed">
                  "{testimonial.quote}"
                </blockquote>

                {/* Author */}
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-primary font-semibold">
                      {testimonial.author.split(" ").map(n => n[0]).join("")}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium">{testimonial.author}</p>
                    <p className="text-sm text-muted-foreground">
                      {testimonial.role}, {testimonial.company}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonialCards;
