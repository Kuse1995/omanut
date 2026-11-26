import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ClientSidebar from "./ClientSidebar";
import MobileBottomNav from "./MobileBottomNav";
import { cn } from "@/lib/utils";
import { useCompany } from "@/context/CompanyContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, ShieldCheck } from "lucide-react";

const ClientLayout = ({ children }: { children: React.ReactNode }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { isPlatformAdmin, selectedCompany } = useCompany();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar hidden on mobile, bottom nav takes over */}
      <div className="hidden md:block">
        <ClientSidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      </div>
      <main
        className={cn(
          "min-h-screen transition-all duration-300",
          "md:ml-60",
          sidebarCollapsed && "md:ml-16",
        )}
      >
        {isPlatformAdmin && (
          <div className="sticky top-0 z-30 border-b border-amber-500/30 bg-amber-500/10 backdrop-blur-md px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400 gap-1">
                <ShieldCheck className="h-3 w-3" />
                Admin Mode
              </Badge>
              <span className="text-muted-foreground">
                operating as{" "}
                <strong className="text-foreground">
                  {selectedCompany?.name || "No company selected"}
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => navigate("/admin/companies")}
              >
                <Building2 className="h-3 w-3" />
                Switch Company
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                onClick={() => navigate("/admin/dashboard")}
              >
                Back to Admin
              </Button>
            </div>
          </div>
        )}
        {children}
      </main>
      <MobileBottomNav />
    </div>
  );
};

export default ClientLayout;
