import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, KeyRound, LogOut } from "lucide-react";
import omanutLogo from "@/assets/omanut-logo-new.png";

const ClaimCompany = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/login");
        return;
      }
      setEmail(session.user.email ?? "");
      const { data: companies } = await supabase.rpc("get_user_companies");
      if (companies && companies.length > 0) {
        navigate("/dashboard");
        return;
      }
      setChecking(false);
    })();
  }, [navigate]);

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("claim_company", { _code: code.trim() });
      if (error) throw error;
      const result = data as any;
      toast({
        title: "Company claimed",
        description: `Welcome to ${result?.company_name ?? "your business"}!`,
      });
      navigate("/dashboard");
    } catch (e: any) {
      toast({ title: "Could not claim", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-app p-6">
      <Card className="card-glass w-full max-w-md">
        <CardHeader className="text-center">
          <img src={omanutLogo} alt="Omanut" className="w-16 h-16 mx-auto mb-2 object-contain" />
          <CardTitle className="text-2xl text-gradient">Claim your business</CardTitle>
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="text-foreground">{email}</span>
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter the claim code your Omanut admin shared with you. It looks like
            <span className="font-mono text-foreground"> ABCD-EFGH-JKLM</span>.
          </p>
          <form onSubmit={handleClaim} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Claim code</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="code"
                  required
                  placeholder="ABCD-EFGH-JKLM"
                  className="pl-9 font-mono uppercase tracking-wider"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </div>
            </div>
            <Button type="submit" className="w-full bg-gradient-primary" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Claim business"}
            </Button>
          </form>
          <div className="text-center pt-2">
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-1" /> Sign out
            </Button>
          </div>
          <p className="text-xs text-center text-muted-foreground">
            Don't have a code? Contact Omanut support on WhatsApp.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default ClaimCompany;
