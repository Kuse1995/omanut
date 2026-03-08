import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import omanutLogo from "@/assets/omanut-logo-new.png";

const TermsOfService = () => {
  const navigate = useNavigate();
  const lastUpdated = "March 8, 2026";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-3">
            <img src={omanutLogo} alt="Omanut" className="w-8 h-8 object-contain" />
            <span className="font-semibold text-lg">Omanut</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-bold tracking-tight mb-2">Terms of Service</h1>
        <p className="text-muted-foreground mb-10">Last updated: {lastUpdated}</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-foreground/90">
          <section>
            <h2 className="text-2xl font-semibold text-foreground">1. Acceptance of Terms</h2>
            <p>By accessing or using the Omanut platform ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service. These Terms apply to all users, including business clients and end-users who interact with businesses through our platform.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">2. Description of Service</h2>
            <p>Omanut is an AI-powered customer engagement platform that enables businesses to automate and manage customer interactions across messaging platforms including WhatsApp, Facebook Messenger, and Instagram Direct. Our services include:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>AI-powered automated customer service responses</li>
              <li>Multi-channel conversation management</li>
              <li>Customer analytics and insights</li>
              <li>Reservation and booking management</li>
              <li>Payment processing facilitation</li>
              <li>Content creation and social media management</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">3. User Accounts</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>You must provide accurate and complete information when creating an account.</li>
              <li>You are responsible for maintaining the security of your account credentials.</li>
              <li>You must notify us immediately of any unauthorized use of your account.</li>
              <li>You must be at least 18 years old to create a business account.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">4. Acceptable Use</h2>
            <p>You agree not to use the Service to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Violate any applicable laws or regulations</li>
              <li>Send spam, unsolicited messages, or bulk communications</li>
              <li>Harass, abuse, or harm other users</li>
              <li>Transmit malicious code, viruses, or harmful content</li>
              <li>Impersonate any person or entity</li>
              <li>Violate Meta's Platform Terms, WhatsApp Business Policy, or any third-party platform policies</li>
              <li>Collect or store personal data of end-users beyond what is necessary for customer service</li>
              <li>Use the AI features to generate misleading, deceptive, or harmful content</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">5. Third-Party Integrations</h2>
            <p>The Service integrates with third-party platforms including Meta (Facebook, Instagram, WhatsApp). By using these integrations:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>You agree to comply with Meta's Platform Terms and Developer Policies</li>
              <li>You acknowledge that Meta may modify or discontinue API access at any time</li>
              <li>You are responsible for obtaining necessary permissions from your customers</li>
              <li>You understand that data exchanged through these platforms is subject to their respective privacy policies</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">6. AI-Generated Content</h2>
            <p>Our platform uses AI to generate responses and content. You acknowledge that:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>AI-generated responses may not always be accurate or appropriate</li>
              <li>You are responsible for reviewing and monitoring AI-generated content sent on your behalf</li>
              <li>We provide tools for human oversight and intervention in AI conversations</li>
              <li>You should configure AI behavior settings appropriate for your business</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">7. Data Processing and Privacy</h2>
            <p>Your use of the Service is also governed by our <a href="/privacy" className="text-primary underline">Privacy Policy</a>. By using the Service, you consent to the collection and processing of data as described therein. As a business user, you act as a data controller for your customer data, and Omanut acts as a data processor.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">8. Intellectual Property</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>The Service, including its design, features, and technology, is owned by Omanut Technologies.</li>
              <li>You retain ownership of your business content and customer data.</li>
              <li>You grant us a limited license to process your content as necessary to provide the Service.</li>
              <li>AI-generated content created through our platform may be used by you for your business purposes.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">9. Payment and Billing</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Certain features require a paid subscription or credit balance.</li>
              <li>Fees are billed in advance on a monthly or annual basis.</li>
              <li>Credits are non-refundable once used.</li>
              <li>We reserve the right to modify pricing with 30 days' notice.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">10. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>The Service is provided "as is" without warranties of any kind.</li>
              <li>We are not liable for any indirect, incidental, special, or consequential damages.</li>
              <li>Our total liability shall not exceed the amount you paid us in the 12 months preceding the claim.</li>
              <li>We are not responsible for actions taken by AI that result in customer dissatisfaction or business losses.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">11. Termination</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>You may terminate your account at any time by contacting us.</li>
              <li>We may suspend or terminate your account for violation of these Terms.</li>
              <li>Upon termination, your data will be retained for 90 days and then deleted.</li>
              <li>Provisions that by their nature should survive termination will remain in effect.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">12. Modifications to Terms</h2>
            <p>We reserve the right to modify these Terms at any time. Material changes will be communicated via email or through the platform. Continued use of the Service after changes constitutes acceptance of the modified Terms.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">13. Governing Law</h2>
            <p>These Terms shall be governed by and construed in accordance with the laws of the Republic of Zambia, without regard to conflict of law principles. Any disputes shall be resolved through binding arbitration or in the courts of Lusaka, Zambia.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">14. Contact</h2>
            <p>For questions about these Terms, contact us at:</p>
            <ul className="list-none space-y-1">
              <li><strong>Email:</strong> legal@omanut.com</li>
              <li><strong>Company:</strong> Omanut Technologies</li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
};

export default TermsOfService;
