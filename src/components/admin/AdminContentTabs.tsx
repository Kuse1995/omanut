import { useCompany } from '@/context/CompanyContext';
import { ConversationsPanel } from './ConversationsPanel';
import { ClientInsightsPanel } from './ClientInsightsPanel';
import { ReservationsPanel } from './ReservationsPanel';
import { CompanySettingsPanel } from './CompanySettingsPanel';
import { BillingPanel } from './BillingPanel';
import { PaymentsPanel } from './PaymentsPanel';
import { AIControlPanel } from './AIControlPanel';
import { ImageGenerationPanel } from './ImageGenerationPanel';

interface AdminContentTabsProps {
  activeTab: string;
}

export const AdminContentTabs = ({ activeTab }: AdminContentTabsProps) => {
  const { selectedCompany } = useCompany();

  const renderContent = () => {
    switch (activeTab) {
      case 'conversations':
        return <ConversationsPanel />;
      case 'insights':
        return <ClientInsightsPanel />;
      case 'reservations':
        return <ReservationsPanel />;
      case 'ai-control':
        return selectedCompany ? (
          <div className="p-6">
            <AIControlPanel companyId={selectedCompany.id} />
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-12">
            Select a company to access AI Control
          </div>
        );
      case 'image-gen':
        return <ImageGenerationPanel />;
      case 'settings':
        return <CompanySettingsPanel />;
      case 'billing':
        return <BillingPanel />;
      case 'payments':
        return <PaymentsPanel />;
      default:
        return <ConversationsPanel />;
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-background">
      {renderContent()}
    </div>
  );
};
