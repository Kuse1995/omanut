import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft } from "lucide-react";
import omanutLogo from "@/assets/omanut-logo-new.png";
import ThemeToggle from "@/components/ThemeToggle";

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const routeAfterAuth = async (userId: string) => {
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (isAdmin) {
      navigate("/admin/dashboard");
      return;
    }
    const { data: companies } = await supabase.rpc("get_user_companies");
    if (companies && companies.length > 0) navigate("/dashboard");
    else navigate("/claim-company");
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) routeAfterAuth(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setTimeout(() => routeAfterAuth(session.user.id), 0);
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Routing handled by onAuthStateChange
    } catch (error: any) {
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/login`,
      });
      if (result.error) throw result.error;
    } catch (e: any) {
      toast({ title: "Google sign-in failed", description: e.message, variant: "destructive" });
      setGoogleLoading(false);
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
              className="w-20 h-20 object-contain mb-4" 
            />
            <CardTitle className="text-3xl font-bold tracking-tight text-center">
              <span className="text-gradient">Omanut</span>
              <span className="text-foreground"> Assistant</span>
            </CardTitle>
            <p className="text-[11px] text-muted-foreground -mt-1">we'll figure it out!</p>
            <p className="text-sm text-muted-foreground mt-3">Client Portal</p>
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
