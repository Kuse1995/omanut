const logos = [
  { name: "Streamside Resort", initials: "SR" },
  { name: "North Park School", initials: "NP" },
  { name: "Finch Investments", initials: "FI" },
  { name: "Urban Kitchen", initials: "UK" },
  { name: "Metro Dental", initials: "MD" },
  { name: "Prime Fitness", initials: "PF" },
  { name: "Horizon Tech", initials: "HT" },
  { name: "Lakeside Spa", initials: "LS" },
];

const ClientLogosCarousel = () => {
  return (
    <section className="py-16 border-y border-border/50 bg-muted/30">
      <div className="max-w-7xl mx-auto px-6">
        <p className="text-center text-sm text-muted-foreground mb-10 uppercase tracking-wider">
          Trusted by leading businesses across Africa
        </p>
        
        {/* Carousel Container */}
        <div className="relative overflow-hidden">
          {/* Gradient Masks */}
          <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
          
          {/* Scrolling Logos */}
          <div className="flex animate-scroll">
            {[...logos, ...logos].map((logo, index) => (
              <div
                key={index}
                className="flex-shrink-0 mx-8 group"
              >
                <div className="flex items-center gap-3 px-6 py-3 rounded-xl bg-card/50 border border-border/50 hover:border-primary/30 transition-all duration-300 hover:bg-card">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                    <span className="font-semibold text-sm">{logo.initials}</span>
                  </div>
                  <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors whitespace-nowrap">
                    {logo.name}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default ClientLogosCarousel;
