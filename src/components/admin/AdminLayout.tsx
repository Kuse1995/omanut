import { ReactNode, useEffect, useState } from "react";
import { AdminIconSidebar } from "./AdminIconSidebar";
import { CompanyPanel } from "./CompanyPanel";
import { CompanyCommandPalette } from "./CompanyCommandPalette";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import CompanyForm from "@/components/CompanyForm";
import { toast } from "sonner";
import { useCompany } from "@/context/CompanyContext";
import { logAdminAction } from "@/lib/adminAudit";

interface AdminLayoutProps {
  children: ReactNode;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  showCompanyHeader?: boolean;
}

export function AdminLayout({
  children,
  activeTab,
  onTabChange,
  showCompanyHeader = false,
}: AdminLayoutProps) {
  const { refreshCompanies } = useCompany();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleCreateSuccess = async () => {
    setCreateDialogOpen(false);
    toast.success("Company created successfully");
    await refreshCompanies();
    await logAdminAction({
      eventType: "admin_company_created",
      message: "Admin created a new company via command palette",
    });
  };

  return (
    <div className="min-h-screen bg-background flex w-full">
      <AdminIconSidebar
        activeTab={activeTab}
        onTabChange={onTabChange}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {showCompanyHeader && (
          <CompanyPanel
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            onNavigateTab={onTabChange}
          />
        )}
        <div className="flex-1 min-h-0 flex flex-col overflow-auto">{children}</div>
      </div>

      <CompanyCommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onCreateCompany={() => setCreateDialogOpen(true)}
      />

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">Create New Company</DialogTitle>
          </DialogHeader>
          <CompanyForm
            onSuccess={handleCreateSuccess}
            onCancel={() => setCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
