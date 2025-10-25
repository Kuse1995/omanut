import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Mail, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

const RequestAccess = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState("abkanyanta@gmail.com");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const redirectUrl = `${window.location.origin}/admin/dashboard`;
      
      const { error } = await supabase.auth.signInWithOtp({
        email: email,
        options: {
          emailRedirectTo: redirectUrl,
        },
      });

      if (error) throw error;

      setSent(true);
      toast({
        title: "Magic link sent!",
        description: "Check your email for the login link",
      });
    } catch (error) {
      console.error("Error sending magic link:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send magic link",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-app flex items-center justify-center p-4">
      <Card className="card-glass w-full max-w-md">
        <CardHeader>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/admin/login')}
            className="absolute top-4 left-4"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Mail className="h-8 w-8 text-white" />
            </div>
          </div>
          <CardTitle className="text-center text-gradient">
            Request Admin Access
          </CardTitle>
          <CardDescription className="text-center">
            {sent
              ? "Check your email for the magic link"
              : "Enter your admin email to receive a login link"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!sent ? (
            <form onSubmit={handleSendLink} className="space-y-4">
              <div className="space-y-2">
                <Input
                  type="email"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-background/50"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-primary to-accent"
              >
                {loading ? "Sending..." : "Send Magic Link"}
              </Button>
            </form>
          ) : (
            <div className="space-y-4 text-center">
              <div className="p-4 bg-green-500/10 rounded-lg border border-green-500/20">
                <p className="text-sm text-muted-foreground">
                  A magic link has been sent to <strong>{email}</strong>
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Click the link in your email to access the admin dashboard
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setSent(false)}
                className="w-full"
              >
                Send Another Link
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default RequestAccess;