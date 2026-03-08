import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import omanutLogo from "@/assets/omanut-logo-new.png";

const DataDeletion = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !description.trim()) {
      toast.error("Please fill in all fields.");
      return;
    }
    setLoading(true);
    // Simulate submission
    await new Promise((r) => setTimeout(r, 1000));
    setSubmitted(true);
    setLoading(false);
    toast.success("Your deletion request has been submitted.");
  };

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
        <h1 className="text-4xl font-bold tracking-tight mb-2">Data Deletion Instructions</h1>
        <p className="text-muted-foreground mb-10">Learn how to request deletion of your personal data from Omanut.</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-foreground/90">
          <section>
            <h2 className="text-2xl font-semibold text-foreground">What Data We Store</h2>
            <p>When you interact with a business that uses Omanut, we may store the following data:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Your name and profile information (as provided by Facebook, Instagram, or WhatsApp)</li>
              <li>Messages exchanged with businesses through our platform</li>
              <li>Media files (images, documents) shared in conversations</li>
              <li>Phone number (for WhatsApp interactions)</li>
              <li>Interaction analytics (message timestamps, response times)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">How to Request Data Deletion</h2>
            <p>You can request deletion of your personal data in any of the following ways:</p>

            <h3 className="text-xl font-medium text-foreground mt-4">Option 1: Submit a Request Below</h3>
            <p>Use the form at the bottom of this page to submit a deletion request directly.</p>

            <h3 className="text-xl font-medium text-foreground mt-4">Option 2: Email Us</h3>
            <p>Send an email to <strong>privacy@omanut.com</strong> with the subject line "Data Deletion Request" and include:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Your full name</li>
              <li>The phone number or email associated with your interactions</li>
              <li>The name of the business you interacted with (if known)</li>
              <li>A description of the data you want deleted</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-4">Option 3: Facebook/Instagram Settings</h3>
            <p>You can also remove Omanut's access to your data through your Facebook or Instagram account settings:</p>
            <ol className="list-decimal pl-6 space-y-1">
              <li>Go to <strong>Facebook Settings → Apps and Websites</strong></li>
              <li>Find Omanut in the list of active apps</li>
              <li>Click "Remove" to revoke access and request data deletion</li>
            </ol>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">What Happens After a Request</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Confirmation:</strong> You will receive an email confirming receipt of your request within 48 hours.</li>
              <li><strong>Processing:</strong> Your data will be deleted within 30 days of the request.</li>
              <li><strong>Verification:</strong> We may contact you to verify your identity before processing the deletion.</li>
              <li><strong>Completion:</strong> You will receive a final confirmation once your data has been deleted.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">Data We Cannot Delete</h2>
            <p>In some cases, we may be required to retain certain data for legal or regulatory purposes, including:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Transaction records required by financial regulations</li>
              <li>Data necessary to resolve ongoing disputes</li>
              <li>Aggregated, anonymized data that cannot be linked back to you</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground">Meta Data Deletion Callback</h2>
            <p>Omanut supports Meta's data deletion callback. When you remove Omanut from your Facebook or Instagram settings, Meta notifies us automatically, and we initiate the deletion process without requiring any additional action from you.</p>
          </section>
        </div>

        {/* Deletion Request Form */}
        <div className="mt-12 border border-border rounded-lg p-8 bg-muted/30">
          <div className="flex items-center gap-3 mb-6">
            <Trash2 className="w-6 h-6 text-destructive" />
            <h2 className="text-2xl font-semibold">Submit a Deletion Request</h2>
          </div>

          {submitted ? (
            <div className="flex flex-col items-center py-8 text-center">
              <CheckCircle className="w-16 h-16 text-primary mb-4" />
              <h3 className="text-xl font-semibold mb-2">Request Submitted</h3>
              <p className="text-muted-foreground max-w-md">
                We've received your data deletion request. You'll receive a confirmation email within 48 hours, and your data will be deleted within 30 days.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
              <div className="space-y-2">
                <Label htmlFor="email">Your Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={255}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">What data should be deleted?</Label>
                <Textarea
                  id="description"
                  placeholder="Please describe the data you want deleted and include any identifying information (phone number, business name, etc.)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  maxLength={1000}
                  rows={4}
                />
              </div>
              <Button type="submit" disabled={loading} className="gap-2">
                {loading ? "Submitting…" : "Submit Deletion Request"}
              </Button>
            </form>
          )}
        </div>

        <div className="mt-8 text-sm text-muted-foreground">
          <p>For any questions about data deletion, contact us at <strong>privacy@omanut.com</strong>.</p>
        </div>
      </main>
    </div>
  );
};

export default DataDeletion;
