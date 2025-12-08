import FloatingNav from "@/components/landing/FloatingNav";
import HeroSection from "@/components/landing/HeroSection";
import ClientLogosCarousel from "@/components/landing/ClientLogosCarousel";
import FeatureShowcase from "@/components/landing/FeatureShowcase";
import TestimonialCards from "@/components/landing/TestimonialCards";
import InteractivePricing from "@/components/landing/InteractivePricing";
import Footer from "@/components/landing/Footer";

const Home = () => {
  return (
    <>
      <title>Omanut - AI-Powered Business Assistant for WhatsApp</title>
      <meta 
        name="description" 
        content="Never miss a customer inquiry. Omanut handles reservations, answers questions, and processes payments 24/7 via WhatsApp. Start your free trial today." 
      />

      <div className="min-h-screen bg-background text-foreground">
        <FloatingNav />
        <HeroSection />
        <ClientLogosCarousel />
        <FeatureShowcase />
        <TestimonialCards />
        <InteractivePricing />
        <Footer />
      </div>
    </>
  );
};

export default Home;
