import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft } from "lucide-react";
import omanutLogo from "@/assets/omanut-logo.jpg";
import ThemeToggle from "@/components/ThemeToggle";

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: isAdmin } = await supabase.rpc('has_role', {
          _user_id: session.user.id,
          _role: 'admin'
        });
        navigate(isAdmin ? '/admin/dashboard' : '/dashboard');
      }
    };
    
    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        // Defer async calls to prevent deadlock
        setTimeout(async () => {
          const { data: isAdmin } = await supabase.rpc('has_role', {
            _user_id: session.user.id,
            _role: 'admin'
          });
          navigate(isAdmin ? '/admin/dashboard' : '/dashboard');
        }, 0);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      const { data: isClient } = await supabase.rpc('has_role', {
        _user_id: data.user.id,
        _role: 'client'
      });

      if (!isClient) {
        const { data: isAdmin } = await supabase.rpc('has_role', {
          _user_id: data.user.id,
          _role: 'admin'
        });
        
        await supabase.auth.signOut();
        
        if (isAdmin) {
          throw new Error("Admin users must login at /admin/login");
        } else {
          throw new Error("Your account does not have access to this portal. Please contact your administrator.");
        }
      }

      toast({
        title: "Success",
        description: "Logged in successfully",
      });
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-app p-6 relative overflow-hidden">
      {/* Hero Glow */}
      <div className="hero-glow absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
      
      {/* Theme Toggle */}
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>
      
      {/* Back Button */}
      <Button 
        variant="ghost" 
        onClick={() => navigate('/')}
        className="absolute top-4 left-4 z-10"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Home
      </Button>
      
      <Card className="card-glass w-full max-w-md relative animate-scale-in">
        <CardHeader className="space-y-4 pb-8">
          <div className="flex flex-col items-center">
            <img 
              src={omanutLogo} 
              alt="Omanut" 
              className="h-20 w-20 rounded-2xl object-cover mb-6 ring-2 ring-primary/20" 
            />
            <CardTitle className="text-3xl font-bold tracking-tight text-center">
              <span className="text-gradient">Omanut</span>
              <span className="text-foreground"> Assistant</span>
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-2">Client Portal</p>
          </div>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password" className="text-foreground">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11"
              />
            </div>
            
            <Button 
              type="submit" 
              className="w-full bg-gradient-primary hover-glow h-11 text-base font-medium" 
              disabled={loading}
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign In"}
            </Button>
          </form>
          
          <div className="mt-8 pt-6 border-t border-border/40 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Don't have an account?
            </p>
            <p className="text-sm text-foreground font-medium">
              Contact your administrator for access
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
