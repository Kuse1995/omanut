import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConversationsPanel } from './ConversationsPanel';
import { ClientInsightsPanel } from './ClientInsightsPanel';
import { ReservationsPanel } from './ReservationsPanel';
import { CompanySettingsPanel } from './CompanySettingsPanel';
import { BillingPanel } from './BillingPanel';
import { PaymentsPanel } from './PaymentsPanel';
import { AIControlPanel } from './AIControlPanel';
import { AdsPanel } from './AdsPanel';
import { MessageSquare, Info, Calendar, Settings, CreditCard, DollarSign, Bot, Megaphone } from 'lucide-react';
import { useCompany } from '@/context/CompanyContext';

export const CompanyTabs = () => {
  const { selectedCompany } = useCompany();

  return (
    <Tabs defaultValue="conversations" className="flex-1 flex flex-col">
      <TabsList className="w-full justify-start rounded-none border-b border-white/10 bg-[#1A1A1A] p-0 h-auto overflow-x-auto">
        <TabsTrigger 
          value="conversations" 
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#84CC16] data-[state=active]:bg-transparent px-6 py-4"
        >
          <MessageSquare className="w-4 h-4 mr-2" />
          Conversations
        </TabsTrigger>
        <TabsTrigger 
          value="insights" 
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#84CC16] data-[state=active]:bg-transparent px-6 py-4"
        >
          <Info className="w-4 h-4 mr-2" />
          Client Insights
        </TabsTrigger>
        <TabsTrigger 
          value="reservations" 
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#84CC16] data-[state=active]:bg-transparent px-6 py-4"
        >
          <Calendar className="w-4 h-4 mr-2" />
          Reservations
        </TabsTrigger>
        <TabsTrigger 
          value="ai-control" 
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#84CC16] data-[state=active]:bg-transparent px-6 py-4"
        >
          <Bot className="w-4 h-4 mr-2" />
          AI Control
        </TabsTrigger>
        <TabsTrigger 
          value="settings" 
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#84CC16] data-[state=active]:bg-transparent px-6 py-4"
        >
          <Settings className="w-4 h-4 mr-2" />
          Company Settings
        </TabsTrigger>
        <TabsTrigger 
          value="billing" 
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#84CC16] data-[state=active]:bg-transparent px-6 py-4"
        >
          <CreditCard className="w-4 h-4 mr-2" />
          Billing & Credits
        </TabsTrigger>
        <TabsTrigger 
          value="payments" 
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#84CC16] data-[state=active]:bg-transparent px-6 py-4"
        >
          <DollarSign className="w-4 h-4 mr-2" />
          Products & Payments
        </TabsTrigger>
        <TabsTrigger 
          value="ads" 
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#84CC16] data-[state=active]:bg-transparent px-6 py-4"
        >
          <Megaphone className="w-4 h-4 mr-2" />
          Ads
        </TabsTrigger>
      </TabsList>

      <TabsContent value="conversations" className="flex-1 m-0">
        <ConversationsPanel />
      </TabsContent>

      <TabsContent value="insights" className="flex-1 m-0">
        <ClientInsightsPanel />
      </TabsContent>

      <TabsContent value="reservations" className="flex-1 m-0">
        <ReservationsPanel />
      </TabsContent>

      <TabsContent value="ai-control" className="flex-1 m-0 p-6">
        {selectedCompany ? (
          <AIControlPanel companyId={selectedCompany.id} />
        ) : (
          <div className="text-center text-muted-foreground py-12">
            Select a company to access AI Control
          </div>
        )}
      </TabsContent>

      <TabsContent value="settings" className="flex-1 m-0">
        <CompanySettingsPanel />
      </TabsContent>

      <TabsContent value="billing" className="flex-1 m-0">
        <BillingPanel />
      </TabsContent>

      <TabsContent value="payments" className="flex-1 m-0">
        <PaymentsPanel />
      </TabsContent>

      <TabsContent value="ads" className="flex-1 m-0">
        <AdsPanel />
      </TabsContent>
    </Tabs>
  );
};
