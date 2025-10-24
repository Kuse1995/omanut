import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Shield } from "lucide-react";
import omanutLogo from "@/assets/omanut-logo.jpg";
import ThemeToggle from "@/components/ThemeToggle";

const AUTHORIZED_ADMIN_EMAIL = "Abkanyanta@gmail.com";

const AdminLogin = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    // Check if already logged in as admin
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const { data: isAdmin } = await supabase.rpc('has_role', {
          _user_id: session.user.id,
          _role: 'admin'
        });
        
        if (isAdmin) {
          navigate("/admin/dashboard");
        }
      }
    });
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate admin email first
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
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      // Check if user has admin role
      const { data: isAdmin } = await supabase.rpc('has_role', {
        _user_id: data.user.id,
        _role: 'admin'
      });

      if (!isAdmin) {
        await supabase.auth.signOut();
        throw new Error("Access denied. Admin privileges required.");
      }

      // Send login confirmation email
      await supabase.functions.invoke('send-admin-login-notification', {
        body: {
          email: email,
          timestamp: new Date().toISOString(),
          ipAddress: 'Client IP' // Browser can't access real IP
        }
      });

      toast({
        title: "Welcome, Admin!",
        description: "Login confirmation email sent. Successfully logged in to admin portal.",
      });
      navigate("/admin/dashboard");
    } catch (error: any) {
      toast({
        title: "Login failed",
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

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Admin Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="Abkanyanta@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">Only authorized admin emails can access this portal</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full bg-gradient-primary" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign In as Admin"}
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
