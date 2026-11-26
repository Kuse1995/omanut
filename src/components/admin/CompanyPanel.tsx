import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCompany } from "@/context/CompanyContext";
import { supabase } from "@/integrations/supabase/client";
import { logAdminAction } from "@/lib/adminAudit";
import {
  Building2,
  Phone,
  MessageSquare,
  CreditCard,
  ChevronsUpDown,
  Plug,
  ExternalLink,
  Bot,
  FlaskConical,
  Rocket,
  Loader2,
  LayoutGrid,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

interface CompanyPanelProps {
  onOpenCommandPalette?: () => void;
  onNavigateTab?: (tab: string) => void;
}

export const CompanyPanel = ({ onOpenCommandPalette, onNavigateTab }: CompanyPanelProps) => {
  const { selectedCompany, refreshCompanies } = useCompany();
  const navigate = useNavigate();
  const [togglingMode, setTogglingMode] = useState(false);
  const [confirmProdOpen, setConfirmProdOpen] = useState(false);

  if (!selectedCompany) {
    return (
      <div className="p-6 border-b border-border bg-card/50 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No company selected</p>
            <p className="text-xs text-muted-foreground">
              Press <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-[10px]">⌘K</kbd> or open Fleet to pick a tenant
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onOpenCommandPalette && (
            <Button size="sm" variant="outline" onClick={onOpenCommandPalette}>
              Select Company (⌘K)
            </Button>
          )}
          <Button size="sm" onClick={() => navigate("/admin/companies")}>
            <LayoutGrid className="w-4 h-4 mr-1.5" />
            Open Fleet
          </Button>
        </div>
      </div>
    );
  }

  const md = (selectedCompany.metadata as Record<string, unknown> | null) || {};
  const harnessMode = String(md.harness_mode || "off");

  const applyTestMode = async (nextTestMode: boolean) => {
    setTogglingMode(true);
    try {
      const { error } = await supabase
        .from("companies")
        .update({ test_mode: nextTestMode })
        .eq("id", selectedCompany.id);
      if (error) throw error;

      await logAdminAction({
        eventType: "admin_test_mode_toggled",
        companyId: selectedCompany.id,
        severity: nextTestMode ? "info" : "warning",
        message: `Switched ${selectedCompany.name} to ${nextTestMode ? "Test Mode (sandbox)" : "Production (live outbound)"}`,
        details: { test_mode: nextTestMode },
      });

      await refreshCompanies();
      toast.success(
        nextTestMode
          ? `${selectedCompany.name} switched to Test Mode`
          : `${selectedCompany.name} is now LIVE in Production`
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update mode");
    } finally {
      setTogglingMode(false);
      setConfirmProdOpen(false);
    }
  };

  const handleModeClick = () => {
    if (selectedCompany.test_mode) {
      setConfirmProdOpen(true);
    } else {
      applyTestMode(true);
    }
  };

  const jumpToHarness = () => {
    navigate("/admin/dashboard?tab=ai-control&subtab=config&section=harness");
  };

  const jumpToBilling = () => {
    if (onNavigateTab) onNavigateTab("billing");
    else navigate("/admin/dashboard?tab=billing");
  };

  return (
    <>
      <div className="px-5 py-3.5 border-b border-border bg-card/50">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Left: Clickable Switcher & Metadata */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={onOpenCommandPalette}
                  className="group flex items-center gap-1.5 text-left hover:text-primary transition-colors"
                  title="Switch company (⌘K)"
                >
                  <h1 className="text-lg font-semibold text-foreground group-hover:text-primary truncate max-w-[260px] sm:max-w-sm">
                    {selectedCompany.name}
                  </h1>
                  <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <kbd className="hidden sm:inline-block text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                    ⌘K
                  </kbd>
                </button>
                <span className="text-xs text-muted-foreground capitalize">
                  • {selectedCompany.business_type || "Business"}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                {selectedCompany.whatsapp_number && (
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3 text-emerald-500" />
                    {selectedCompany.whatsapp_number}
                  </span>
                )}
                {selectedCompany.twilio_number && (
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {selectedCompany.twilio_number}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Live Mode, Harness, Credits, Quick Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant={selectedCompany.test_mode ? "secondary" : "default"}
              onClick={handleModeClick}
              disabled={togglingMode}
              className="h-8 text-xs gap-1.5"
              title="Click to toggle Test Mode vs Production"
            >
              {togglingMode ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : selectedCompany.test_mode ? (
                <FlaskConical className="w-3.5 h-3.5" />
              ) : (
                <Rocket className="w-3.5 h-3.5" />
              )}
              {selectedCompany.test_mode ? "Test Mode" : "Production"}
            </Button>

            <button
              type="button"
              onClick={jumpToHarness}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border bg-background hover:bg-muted text-xs transition-colors"
              title="Configure External Harness"
            >
              <Bot className="w-3.5 h-3.5 text-primary" />
              <span className="text-muted-foreground">Harness:</span>
              <Badge
                variant={harnessMode === "off" ? "secondary" : "default"}
                className="h-4 px-1.5 text-[10px]"
              >
                {harnessMode}
              </Badge>
            </button>

            <button
              type="button"
              onClick={jumpToBilling}
              className="flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-primary/10 hover:bg-primary/15 text-primary text-xs transition-colors"
              title="Open Billing & Spend"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span className="font-semibold">{selectedCompany.credit_balance ?? 0}</span>
              <span className="opacity-75">credits</span>
            </button>

            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1"
              onClick={() => navigate("/setup")}
            >
              <Plug className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Setup</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1"
              onClick={() => navigate("/dashboard")}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden md:inline">View as Owner</span>
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs gap-1"
              onClick={() => navigate("/admin/companies")}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Fleet</span>
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmProdOpen} onOpenChange={setConfirmProdOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch {selectedCompany.name} to Production?</AlertDialogTitle>
            <AlertDialogDescription>
              Turning off Test Mode enables real outbound WhatsApp, Messenger, and Instagram sends for this tenant. Make sure KB pricing, boss phones, and channel connections are verified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={togglingMode}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => applyTestMode(false)} disabled={togglingMode}>
              {togglingMode ? "Switching…" : "Go Live (Production)"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
