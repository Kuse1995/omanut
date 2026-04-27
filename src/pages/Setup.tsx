import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle, Facebook, CreditCard, Database, Sparkles, ImageIcon, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ClientLayout from "@/components/dashboard/ClientLayout";
import IntegrationCard from "@/components/setup/IntegrationCard";
import { MetaIntegrationsPanel } from "@/components/admin/MetaIntegrationsPanel";
import { useSetupStatus } from "@/hooks/useSetupStatus";
import { useCompany } from "@/context/CompanyContext";
import { Skeleton } from "@/components/ui/skeleton";

const Setup = () => {
  const navigate = useNavigate();
  const { selectedCompany } = useCompany();
  const { data: status, isLoading } = useSetupStatus();
  const [metaOpen, setMetaOpen] = useState(false);

  const completed = status
    ? [status.whatsapp, status.meta, status.payments, status.bms, status.ai, status.brand].filter(
        (s) => s === "connected",
      ).length
    : 0;

  return (
    <ClientLayout>
      <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto pb-24 md:pb-8">
        {/* Header */}
        <div className="mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/dashboard")}
            className="mb-3 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Connect your business</h1>
          <p className="text-muted-foreground mt-1">
            Set up the channels and tools your AI assistant needs. Each step takes a minute or two.
          </p>
        </div>

        {/* Progress banner */}
        {status && (
          <Card className="mb-6 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
            <CardContent className="flex items-center justify-between p-4 sm:p-5">
              <div>
                <p className="font-semibold">
                  {completed === 6 ? "You're all set 🎉" : `${completed} of 6 connected`}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {completed === 6
                    ? "Your AI assistant is fully equipped."
                    : "Finish the steps below to unlock everything."}
                </p>
              </div>
              <div className="hidden sm:flex items-center gap-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 w-8 rounded-full ${
                      i < completed ? "bg-primary" : "bg-muted"
                    }`}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Integration cards */}
        <div className="space-y-3">
          {isLoading || !status ? (
            <>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </>
          ) : (
            <>
              <IntegrationCard
                icon={MessageCircle}
                iconBg="bg-green-500/10"
                iconColor="text-green-600"
                title="WhatsApp"
                description={
                  status.whatsappLabel ??
                  "Connect a WhatsApp number so customers can chat with your AI 24/7."
                }
                status={status.whatsapp}
                onClick={() => navigate("/settings")}
              />
              <IntegrationCard
                icon={Facebook}
                iconBg="bg-blue-500/10"
                iconColor="text-blue-600"
                title="Facebook & Instagram"
                description={
                  status.meta === "connected"
                    ? `${status.metaCount} page${status.metaCount > 1 ? "s" : ""} connected. Auto-replies on DMs and comments are live.`
                    : "One-click connect — we handle DMs, comments and scheduled posts."
                }
                status={status.meta}
                onClick={() => setMetaOpen(true)}
              />
              <IntegrationCard
                icon={CreditCard}
                iconBg="bg-purple-500/10"
                iconColor="text-purple-600"
                title="Payments"
                description={
                  status.payments === "connected"
                    ? `${status.paymentsCount} product${status.paymentsCount > 1 ? "s" : ""} ready to sell. AI can generate payment links.`
                    : "Add products or services so the AI can take payments via MoMo, card or Selar."
                }
                status={status.payments}
                statusLabel={status.payments === "not_set_up" ? "Set up" : undefined}
                onClick={() => navigate("/settings")}
              />
              <IntegrationCard
                icon={Database}
                iconBg="bg-amber-500/10"
                iconColor="text-amber-600"
                title="Business System (BMS)"
                description={
                  status.bms === "connected"
                    ? "Catalog, stock and orders sync automatically every 15 minutes."
                    : "Optional — link your inventory so the AI quotes live stock and prices."
                }
                status={status.bms}
                onClick={() => navigate("/settings")}
              />
              <IntegrationCard
                icon={Sparkles}
                iconBg="bg-pink-500/10"
                iconColor="text-pink-600"
                title="AI Personality"
                description={
                  status.ai === "connected"
                    ? "Voice, tone and special instructions are configured."
                    : "Tell the AI how to speak and what to never say."
                }
                status={status.ai}
                statusLabel={status.ai === "action_needed" ? "Customize" : undefined}
                onClick={() => navigate("/settings")}
              />
              <IntegrationCard
                icon={ImageIcon}
                iconBg="bg-cyan-500/10"
                iconColor="text-cyan-600"
                title="Brand Kit"
                description={
                  status.brand === "connected"
                    ? "Logo and visuals are ready for posts and reels."
                    : "Upload your logo and product photos for branded social content."
                }
                status={status.brand}
                onClick={() => navigate("/settings")}
              />
            </>
          )}
        </div>

        {/* Help footer */}
        <Card className="mt-8 border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Need a hand?</CardTitle>
            <CardDescription>
              Most setups take less than 10 minutes. WhatsApp our team and we'll walk you through it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open("https://wa.me/260977000000", "_blank")}
            >
              <MessageCircle className="w-4 h-4 mr-2" /> Chat with support
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Meta connect dialog — embeds existing admin panel which already uses useCompany */}
      <Dialog open={metaOpen} onOpenChange={setMetaOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle>Connect Facebook & Instagram</DialogTitle>
          </DialogHeader>
          <MetaIntegrationsPanel />
        </DialogContent>
      </Dialog>
    </ClientLayout>
  );
};

export default Setup;
