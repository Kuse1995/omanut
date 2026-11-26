import { useCompany } from "@/context/CompanyContext";
import { ConversationsPanel } from "./ConversationsPanel";
import { ClientInsightsPanel } from "./ClientInsightsPanel";
import { ReservationsPanel } from "./ReservationsPanel";
import { CompanySettingsPanel } from "./CompanySettingsPanel";
import { BillingPanel } from "./BillingPanel";
import { PaymentsPanel } from "./PaymentsPanel";
import { AIControlPanel } from "./AIControlPanel";
import { ImageGenerationPanel } from "./ImageGenerationPanel";
import { MediaLibraryPanel } from "./MediaLibraryPanel";
import { TicketsPanel } from "./TicketsPanel";
import { AgentWorkspace } from "./AgentWorkspace";
import { MetaIntegrationsPanel } from "./MetaIntegrationsPanel";
import { ContentSchedulerPanel } from "./ContentSchedulerPanel";
import { VideoStudioPanel } from "./VideoStudioPanel";
import { AdsPanel } from "./AdsPanel";
import { RuleViolationsPanel } from "./RuleViolationsPanel";

interface AdminContentTabsProps {
  activeTab: string;
  onNavigateTab?: (tab: string) => void;
}

export const AdminContentTabs = ({ activeTab, onNavigateTab }: AdminContentTabsProps) => {
  const { selectedCompany } = useCompany();

  const renderContent = () => {
    switch (activeTab) {
      case "conversations":
        return <ConversationsPanel />;
      case "insights":
        return <ClientInsightsPanel />;
      case "reservations":
        return <ReservationsPanel />;
      case "ai-control":
        return selectedCompany ? (
          <div className="p-6">
            <AIControlPanel companyId={selectedCompany.id} />
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-12">
            Select a company to access AI Control
          </div>
        );
      case "rule-violations":
        return selectedCompany ? (
          <RuleViolationsPanel companyId={selectedCompany.id} mode="admin" onNavigateTab={onNavigateTab} />
        ) : (
          <div className="text-center text-muted-foreground py-12">
            Select a company to review Rule Violations
          </div>
        );
      case "video-studio":
        return <VideoStudioPanel />;
      case "image-gen":
        return <ImageGenerationPanel />;
      case "media":
        return <MediaLibraryPanel />;
      case "ads":
        return <AdsPanel />;
      case "tickets":
        return <TicketsPanel />;
      case "workspace":
        return <AgentWorkspace />;
      case "settings":
        return <CompanySettingsPanel />;
      case "billing":
        return <BillingPanel />;
      case "payments":
        return <PaymentsPanel />;
      case "meta-integrations":
        return <MetaIntegrationsPanel />;
      case "content-scheduler":
        return <ContentSchedulerPanel />;
      default:
        return <ConversationsPanel />;
    }
  };

  return <div className="flex-1 overflow-auto bg-background">{renderContent()}</div>;
};
