import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import omanutLogo from "@/assets/omanut-logo-new.png";

const PrivacyPolicy = () => {
  const navigate = useNavigate();
  const lastUpdated = "March 8, 2026";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
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
        <h1 className="text-4xl font-bold tracking-tight mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-10">Last updated: {lastUpdated}</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-foreground/90">
          <section>
            <h2 className="text-2xl font-semibold text-foreground">1. Introduction</h2>
            <p>Omanut Technologies ("Omanut," "we," "us," or "our") operates an AI-powered customer engagement platform that integrates with messaging services including WhatsApp, Facebook Messenger, and Instagram Direct. This Privacy Policy explains how we collect, use, store, share, and protect your personal information when you use our services or interact with businesses that use Omanut.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">2. Information We Collect</h2>
            <h3 className="text-xl font-medium text-foreground">2.1 Information from Meta Platforms (Facebook & Instagram)</h3>
            <p>When businesses connect their Facebook Pages or Instagram accounts to Omanut, we may receive:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Your name and profile information as provided by Meta</li>
              <li>Messages you send to businesses via Facebook Messenger or Instagram Direct</li>
              <li>Media files (images, videos, documents) shared in conversations</li>
              <li>Page-scoped or app-scoped user IDs</li>
              <li>Comments on Facebook posts (when businesses enable comment management)</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-4">2.2 Information from WhatsApp</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>Your phone number</li>
              <li>Messages you send to businesses via WhatsApp Business API</li>
              <li>Media files shared in conversations</li>
              <li>Your display name as provided by WhatsApp</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-4">2.3 Information from Business Users</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>Account registration details (name, email, phone number)</li>
              <li>Business information (company name, services, hours of operation)</li>
              <li>Payment and billing information</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-4">2.4 Automatically Collected Information</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>Usage data and analytics</li>
              <li>IP addresses and browser information</li>
              <li>Device information</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">3. How We Use Your Information</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>AI-Powered Customer Service:</strong> We process messages using artificial intelligence to generate automated responses, route conversations, and assist businesses in serving their customers.</li>
              <li><strong>Conversation Management:</strong> Storing and organizing conversations between customers and businesses.</li>
              <li><strong>Analytics and Insights:</strong> Providing businesses with aggregated analytics about customer interactions, sentiment, and engagement patterns.</li>
              <li><strong>Service Improvement:</strong> Improving our AI models and platform features.</li>
              <li><strong>Notifications:</strong> Sending relevant alerts to business owners about customer interactions that require attention.</li>
              <li><strong>Compliance:</strong> Meeting legal obligations and enforcing our terms of service.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">4. AI-Powered Processing</h2>
            <p>Omanut uses artificial intelligence to process customer messages. This includes:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Natural language understanding to interpret customer intent</li>
              <li>Automated response generation based on business-specific knowledge</li>
              <li>Sentiment analysis and conversation quality monitoring</li>
              <li>Customer segmentation and engagement scoring</li>
            </ul>
            <p>AI processing is performed to assist businesses in providing better customer service. Customers can request human assistance at any time during a conversation.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">5. Data Sharing and Third-Party Services</h2>
            <p>We may share your information with:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Meta Platforms:</strong> To send and receive messages via Facebook Messenger, Instagram Direct, and WhatsApp Business API.</li>
              <li><strong>AI Service Providers:</strong> To process messages and generate responses (data is processed in accordance with their privacy policies).</li>
              <li><strong>Cloud Infrastructure:</strong> Our platform is hosted on secure cloud infrastructure.</li>
              <li><strong>Business Clients:</strong> Businesses using Omanut have access to conversations with their customers.</li>
            </ul>
            <p>We do <strong>not</strong> sell your personal information to third parties.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">6. Data Retention</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Conversation data is retained for as long as the business maintains an active Omanut account, unless deletion is requested.</li>
              <li>After account termination, data is deleted within 90 days.</li>
              <li>You may request deletion of your data at any time (see our <a href="/data-deletion" className="text-primary underline">Data Deletion page</a>).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">7. Data Security</h2>
            <p>We implement industry-standard security measures to protect your data, including:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Encryption in transit (TLS/SSL) and at rest</li>
              <li>Row-level security policies on database tables</li>
              <li>Regular security audits and monitoring</li>
              <li>Access controls and authentication</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">8. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Access:</strong> Request a copy of the personal data we hold about you.</li>
              <li><strong>Correction:</strong> Request correction of inaccurate personal data.</li>
              <li><strong>Deletion:</strong> Request deletion of your personal data (see our <a href="/data-deletion" className="text-primary underline">Data Deletion Instructions</a>).</li>
              <li><strong>Portability:</strong> Request your data in a machine-readable format.</li>
              <li><strong>Objection:</strong> Object to processing of your personal data.</li>
              <li><strong>Restriction:</strong> Request restriction of processing in certain circumstances.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">9. GDPR Compliance</h2>
            <p>For users in the European Economic Area (EEA), we process personal data under the following legal bases:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Legitimate Interest:</strong> Processing messages to provide customer service on behalf of businesses.</li>
              <li><strong>Contract:</strong> Processing necessary to fulfill our service agreements with businesses.</li>
              <li><strong>Consent:</strong> Where required, we obtain explicit consent before processing.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">10. Children's Privacy</h2>
            <p>Our services are not directed to individuals under the age of 13. We do not knowingly collect personal information from children under 13. If we become aware that we have collected personal information from a child under 13, we will take steps to delete that information.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">11. Cookies and Tracking</h2>
            <p>Our website uses essential cookies for authentication and session management. We do not use third-party tracking cookies for advertising purposes.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">12. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify users of material changes by posting the updated policy on this page with a new "Last updated" date.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">13. Contact Us</h2>
            <p>If you have questions about this Privacy Policy or wish to exercise your data rights, contact us at:</p>
            <ul className="list-none space-y-1">
              <li><strong>Email:</strong> privacy@omanut.com</li>
              <li><strong>Company:</strong> Omanut Technologies</li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
};

export default PrivacyPolicy;
