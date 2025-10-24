import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const ACCESS_TOKEN_KEY = "admin_access_token";
const TOKEN_EXPIRY_KEY = "admin_token_expiry";

const AdminVerify = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [verifying, setVerifying] = useState(true);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const verifyToken = async () => {
      const token = searchParams.get("token");
      
      if (!token) {
        setVerifying(false);
        toast({
          title: "Invalid Link",
          description: "No access token provided.",
          variant: "destructive",
        });
        return;
      }

      // Check if token exists in session storage
      const storedData = sessionStorage.getItem(`pending_token_${token}`);
      
      if (!storedData) {
        setVerifying(false);
        toast({
          title: "Invalid or Expired Link",
          description: "This access link is no longer valid.",
          variant: "destructive",
        });
        return;
      }

      const { email, expiry } = JSON.parse(storedData);
      const expiryDate = new Date(expiry);

      if (expiryDate < new Date()) {
        setVerifying(false);
        sessionStorage.removeItem(`pending_token_${token}`);
        toast({
          title: "Link Expired",
          description: "This access link has expired. Please request a new one.",
          variant: "destructive",
        });
        return;
      }

      // Valid token - grant access
      localStorage.setItem(ACCESS_TOKEN_KEY, token);
      localStorage.setItem(TOKEN_EXPIRY_KEY, expiry);
      sessionStorage.removeItem(`pending_token_${token}`);

      setSuccess(true);
      setVerifying(false);

      toast({
        title: "Access Granted!",
        description: "Welcome to the admin portal.",
      });

      // Redirect after short delay
      setTimeout(() => {
        navigate("/admin/dashboard");
      }, 1500);
    };

    verifyToken();
  }, [searchParams, navigate, toast]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-destructive/5 p-6">
      <Card className="card-glass w-full max-w-md p-8">
        <div className="flex flex-col items-center text-center space-y-4">
          {verifying ? (
            <>
              <Loader2 className="h-16 w-16 animate-spin text-primary" />
              <h2 className="text-2xl font-bold">Verifying Access</h2>
              <p className="text-muted-foreground">Please wait while we verify your access link...</p>
            </>
          ) : success ? (
            <>
              <CheckCircle className="h-16 w-16 text-green-500" />
              <h2 className="text-2xl font-bold">Access Granted!</h2>
              <p className="text-muted-foreground">Redirecting to admin dashboard...</p>
            </>
          ) : (
            <>
              <XCircle className="h-16 w-16 text-destructive" />
              <h2 className="text-2xl font-bold">Verification Failed</h2>
              <p className="text-muted-foreground">Unable to verify your access link.</p>
              <Button onClick={() => navigate("/admin/login")} className="mt-4">
                Request New Link
              </Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
};

export default AdminVerify;
