import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import FloatingNav from "@/components/landing/FloatingNav";
import HeroSection from "@/components/landing/HeroSection";
import ClientLogosCarousel from "@/components/landing/ClientLogosCarousel";
import FeatureShowcase from "@/components/landing/FeatureShowcase";
import TestimonialCards from "@/components/landing/TestimonialCards";
import InteractivePricing from "@/components/landing/InteractivePricing";
import Footer from "@/components/landing/Footer";
import { supabase } from "@/integrations/supabase/client";

const Home = () => {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    // The AI Agent IS the front door: signed-in users go straight to /agent.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate("/agent", { replace: true });
      setChecking(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (checking) return <div className="min-h-screen" />;
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
