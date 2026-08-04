const businessTypes = [
  { name: "Restaurants & Lodges", initials: "RL" },
  { name: "Retail & Shops", initials: "RS" },
  { name: "Salons & Studios", initials: "SS" },
  { name: "Schools & Training", initials: "ST" },
  { name: "Clinics & Pharmacies", initials: "CP" },
  { name: "Real Estate", initials: "RE" },
  { name: "Logistics", initials: "LG" },
  { name: "Professional Services", initials: "PS" },
];

const ClientLogosCarousel = () => {
  return (
    <section className="py-16 border-y border-border/50 bg-muted/30">
      <div className="max-w-7xl mx-auto px-6">
        <p className="text-center text-sm text-muted-foreground mb-10 uppercase tracking-wider">
          Purpose-built for African businesses
        </p>

        {/* Carousel Container */}
        <div className="relative overflow-hidden">
          {/* Gradient Masks */}
          <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />

          {/* Scrolling Chips */}
          <div className="flex animate-scroll">
            {[...businessTypes, ...businessTypes].map((type, index) => (
              <div
                key={index}
                className="flex-shrink-0 mx-8 group"
              >
                <div className="flex items-center gap-3 px-6 py-3 rounded-xl bg-card/50 border border-border/50 hover:border-primary/30 transition-all duration-300 hover:bg-card">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                    <span className="font-semibold text-sm">{type.initials}</span>
                  </div>
                  <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors whitespace-nowrap">
                    {type.name}
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
