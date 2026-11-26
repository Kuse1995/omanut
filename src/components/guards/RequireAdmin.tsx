import { ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface RequireAdminProps {
  children: ReactNode;
}

/**
 * Route guard ensuring only authenticated platform admins (user_roles.role = 'admin')
 * can access /admin/* routes. Redirects unauthenticated users to /admin/login
 * and non-admins to /.
 */
export function RequireAdmin({ children }: RequireAdminProps) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"checking" | "authorized" | "denied">("checking");

  useEffect(() => {
    let mounted = true;

    const verify = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          if (mounted) {
            setStatus("denied");
            navigate("/admin/login", { replace: true });
          }
          return;
        }

        const { data: isAdmin, error } = await supabase.rpc("has_role", {
          _user_id: session.user.id,
          _role: "admin",
        });

        if (!mounted) return;

        if (error || !isAdmin) {
          setStatus("denied");
          toast.error("Admin access required");
          navigate("/", { replace: true });
          return;
        }

        setStatus("authorized");
      } catch {
        if (mounted) {
          setStatus("denied");
          navigate("/admin/login", { replace: true });
        }
      }
    };

    verify();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setStatus("denied");
        navigate("/admin/login", { replace: true });
      } else {
        verify();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [navigate]);

  if (status !== "authorized") {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p className="text-xs">Verifying admin access…</p>
      </div>
    );
  }

  return <>{children}</>;
}

export default RequireAdmin;
