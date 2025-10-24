import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Shield } from "lucide-react";
import omanutLogo from "@/assets/omanut-logo.jpg";
import ThemeToggle from "@/components/ThemeToggle";

const AUTHORIZED_ADMIN_EMAIL = "Abkanyanta@gmail.com";
const ACCESS_TOKEN_KEY = "admin_access_token";
const TOKEN_EXPIRY_KEY = "admin_token_expiry";

const AdminLogin = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    // Check if already has valid access token
    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    
    if (token && expiry) {
      const expiryDate = new Date(expiry);
      if (expiryDate > new Date()) {
        navigate("/admin/dashboard");
      } else {
        // Token expired, clear it
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(TOKEN_EXPIRY_KEY);
      }
    }
  }, [navigate]);

  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate admin email
    if (email.toLowerCase() !== AUTHORIZED_ADMIN_EMAIL.toLowerCase()) {
      toast({
        title: "Access Denied",
        description: "This email is not authorized for admin access.",
        variant: "destructive",
      });
      return;
    }
    
    setLoading(true);

    try {
      // Generate access token and grant immediate access
      const accessToken = crypto.randomUUID();
      const expiryDate = new Date();
      expiryDate.setHours(expiryDate.getHours() + 24); // 24 hour access

      // Grant immediate access
      localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
      localStorage.setItem(TOKEN_EXPIRY_KEY, expiryDate.toISOString());

      // Send notification email in background (don't wait for it)
      supabase.functions.invoke('send-admin-login-notification', {
        body: {
          email,
          timestamp: new Date().toISOString(),
          ipAddress: 'Direct Access'
        }
      }).catch(err => console.log('Email notification failed:', err));

      toast({
        title: "Welcome, Admin!",
        description: "Access granted. Redirecting to dashboard...",
      });

      // Redirect to dashboard
      setTimeout(() => {
        navigate("/admin/dashboard");
      }, 500);
    } catch (error: any) {
      toast({
        title: "Access failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-destructive/5 p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="card-glass w-full max-w-md p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="p-4 rounded-full bg-gradient-primary mb-4">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <img src={omanutLogo} alt="Omanut" className="h-12 w-12 rounded-lg object-cover mb-4" />
          <h1 className="text-2xl font-bold text-gradient">Omanut Technologies</h1>
          <p className="text-sm text-muted-foreground">Admin Portal</p>
        </div>

        <form onSubmit={handleRequestAccess} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Admin Email</Label>
            <input
              id="email"
              type="email"
              placeholder="Abkanyanta@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
            />
            <p className="text-xs text-muted-foreground">Only authorized admin email can access this portal</p>
          </div>
          <Button type="submit" className="w-full bg-gradient-primary" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
              <>
                <Shield className="h-4 w-4 mr-2" />
                Access Admin Portal
              </>
            )}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <Button variant="link" onClick={() => navigate('/')}>
            ← Back to Home
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default AdminLogin;
