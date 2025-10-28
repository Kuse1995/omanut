import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConversationsPanel } from './ConversationsPanel';
import { MessageSquare, Info, Calendar, Settings, CreditCard } from 'lucide-react';

export const CompanyTabs = () => {
  return (
    <Tabs defaultValue="conversations" className="flex-1 flex flex-col">
      <TabsList className="w-full justify-start rounded-none border-b border-white/10 bg-[#1A1A1A] p-0 h-auto">
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
      </TabsList>

      <TabsContent value="conversations" className="flex-1 m-0">
        <ConversationsPanel />
      </TabsContent>

      <TabsContent value="insights" className="flex-1 m-0 p-6">
        <div className="flex items-center justify-center h-full">
          <p className="text-white/60">Client Insights coming soon</p>
        </div>
      </TabsContent>

      <TabsContent value="reservations" className="flex-1 m-0 p-6">
        <div className="flex items-center justify-center h-full">
          <p className="text-white/60">Reservations coming soon</p>
        </div>
      </TabsContent>

      <TabsContent value="settings" className="flex-1 m-0 p-6">
        <div className="flex items-center justify-center h-full">
          <p className="text-white/60">Company Settings coming soon</p>
        </div>
      </TabsContent>

      <TabsContent value="billing" className="flex-1 m-0 p-6">
        <div className="flex items-center justify-center h-full">
          <p className="text-white/60">Billing & Credits coming soon</p>
        </div>
      </TabsContent>
    </Tabs>
  );
};
