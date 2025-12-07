import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageSquare, AlertTriangle, Settings, BarChart3, BookOpen, Cpu } from "lucide-react";
import { AIPlayground } from "./AIPlayground";
import { AIErrorTracker } from "./AIErrorTracker";
import { AIDeepSettings } from "./AIDeepSettings";
import { AIPerformanceMetrics } from "./AIPerformanceMetrics";
import { AITrainingEditor } from "./AITrainingEditor";

interface AIControlPanelProps {
  companyId: string;
}

export const AIControlPanel = ({ companyId }: AIControlPanelProps) => {
  const [activeTab, setActiveTab] = useState("playground");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">AI Control Center</h2>
        <p className="text-muted-foreground">Test, train, and optimize your AI assistant</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
          <TabsTrigger value="playground" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            <span className="hidden sm:inline">Playground</span>
          </TabsTrigger>
          <TabsTrigger value="errors" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span className="hidden sm:inline">Errors</span>
          </TabsTrigger>
          <TabsTrigger value="config" className="flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            <span className="hidden sm:inline">Deep Config</span>
          </TabsTrigger>
          <TabsTrigger value="metrics" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Metrics</span>
          </TabsTrigger>
          <TabsTrigger value="training" className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Training</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="playground" className="mt-6">
          <AIPlayground companyId={companyId} />
        </TabsContent>

        <TabsContent value="errors" className="mt-6">
          <AIErrorTracker companyId={companyId} />
        </TabsContent>

        <TabsContent value="config" className="mt-6">
          <AIDeepSettings companyId={companyId} />
        </TabsContent>

        <TabsContent value="metrics" className="mt-6">
          <AIPerformanceMetrics companyId={companyId} />
        </TabsContent>

        <TabsContent value="training" className="mt-6">
          <AITrainingEditor companyId={companyId} />
        </TabsContent>
      </Tabs>
    </div>
  );
};
