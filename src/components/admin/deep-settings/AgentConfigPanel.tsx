import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AIConfig } from "../AIDeepSettings";
import { BossReportingPanel } from "./BossReportingPanel";
import { SupervisorConfigPanel } from "./SupervisorConfigPanel";
import { Users, HeadphonesIcon, TrendingUp, Crown, X, Plus, Router, AlertTriangle, ChevronDown, Settings, Brain } from "lucide-react";

interface AgentConfigPanelProps {
  config: AIConfig;
  updateConfig: (updates: Partial<AIConfig>) => void;
}

export const AgentConfigPanel = ({ config, updateConfig }: AgentConfigPanelProps) => {
  const [newTrigger, setNewTrigger] = useState('');
  const [agentTab, setAgentTab] = useState('routing');
  const [bossReportingOpen, setBossReportingOpen] = useState(false);
  const [supervisorConfigOpen, setSupervisorConfigOpen] = useState(false);

  const addHandoffTrigger = () => {
    if (newTrigger.trim() && !config.auto_handoff_triggers.includes(newTrigger.trim())) {
      updateConfig({ auto_handoff_triggers: [...config.auto_handoff_triggers, newTrigger.trim()] });
      setNewTrigger('');
    }
  };

  const removeTrigger = (trigger: string) => {
    updateConfig({ auto_handoff_triggers: config.auto_handoff_triggers.filter(t => t !== trigger) });
  };

  return (
    <div className="space-y-6">
      {/* Routing Configuration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Router className="h-4 w-4 text-primary" />
            Agent Routing
          </CardTitle>
          <CardDescription>Configure how messages are routed to different agents</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Multi-Agent Routing</Label>
              <p className="text-xs text-muted-foreground">Route messages to specialized agents</p>
            </div>
            <Switch
              checked={config.routing_enabled}
              onCheckedChange={(v) => updateConfig({ routing_enabled: v })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Supervisor Analysis</Label>
              <p className="text-xs text-muted-foreground">Deep analysis for complex queries</p>
            </div>
            <Switch
              checked={config.supervisor_enabled}
              onCheckedChange={(v) => updateConfig({ supervisor_enabled: v })}
            />
          </div>

          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Routing Confidence Threshold</span>
              <span className="font-mono font-medium">{config.routing_confidence_threshold.toFixed(1)}</span>
            </div>
            <Slider
              value={[config.routing_confidence_threshold]}
              onValueChange={([v]) => updateConfig({ routing_confidence_threshold: v })}
              min={0.3}
              max={0.9}
              step={0.1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>More switching (0.3)</span>
              <span>Stable (0.9)</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Complexity Threshold (characters)</Label>
            <Input
              type="number"
              value={config.complexity_threshold}
              onChange={(e) => updateConfig({ complexity_threshold: parseInt(e.target.value) || 50 })}
              min={20}
              max={200}
            />
            <p className="text-xs text-muted-foreground">
              Messages shorter than this are treated as "simple"
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Agent-Specific Prompts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-500" />
            Agent Prompts
          </CardTitle>
          <CardDescription>Custom system prompts for each agent type</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={agentTab} onValueChange={setAgentTab}>
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="routing" className="flex items-center gap-1">
                <Router className="h-3 w-3" />
                <span className="hidden sm:inline">General</span>
              </TabsTrigger>
              <TabsTrigger value="support" className="flex items-center gap-1">
                <HeadphonesIcon className="h-3 w-3" />
                <span className="hidden sm:inline">Support</span>
              </TabsTrigger>
              <TabsTrigger value="sales" className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                <span className="hidden sm:inline">Sales</span>
              </TabsTrigger>
              <TabsTrigger value="boss" className="flex items-center gap-1">
                <Crown className="h-3 w-3" />
                <span className="hidden sm:inline">Boss</span>
              </TabsTrigger>
              <TabsTrigger value="supervisor" className="flex items-center gap-1">
                <Brain className="h-3 w-3" />
                <span className="hidden sm:inline">Supervisor</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="routing" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label>System Instructions</Label>
                <Textarea
                  value={config.system_instructions}
                  onChange={(e) => updateConfig({ system_instructions: e.target.value })}
                  placeholder="Core AI behavior instructions that apply to all agents..."
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label>Q&A Style</Label>
                <Textarea
                  value={config.qa_style}
                  onChange={(e) => updateConfig({ qa_style: e.target.value })}
                  placeholder="Define the tone, language, and response patterns..."
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Banned Topics</Label>
                <Textarea
                  value={config.banned_topics}
                  onChange={(e) => updateConfig({ banned_topics: e.target.value })}
                  placeholder="Topics the AI should avoid discussing..."
                  rows={2}
                />
              </div>
            </TabsContent>

            <TabsContent value="support" className="mt-4 space-y-4">
              <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <div className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-400">
                  <HeadphonesIcon className="h-4 w-4" />
                  Support Agent Focus
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Empathy, issue resolution, complaint handling
                </p>
              </div>
              <div className="space-y-2">
                <Label>Support Agent Prompt</Label>
                <Textarea
                  value={config.support_agent_prompt}
                  onChange={(e) => updateConfig({ support_agent_prompt: e.target.value })}
                  placeholder="You are the Support Agent. Be empathetic, listen carefully to complaints, acknowledge frustration, and provide clear solutions..."
                  rows={6}
                />
              </div>
            </TabsContent>

            <TabsContent value="sales" className="mt-4 space-y-4">
              <div className="p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
                  <TrendingUp className="h-4 w-4" />
                  Sales Agent Focus
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Persuasion, product knowledge, closing deals
                </p>
              </div>
              <div className="space-y-2">
                <Label>Sales Agent Prompt</Label>
                <Textarea
                  value={config.sales_agent_prompt}
                  onChange={(e) => updateConfig({ sales_agent_prompt: e.target.value })}
                  placeholder="You are the Sales Agent. Highlight product benefits, create urgency, ask qualifying questions, and guide customers toward purchase..."
                  rows={6}
                />
              </div>
            </TabsContent>

            <TabsContent value="boss" className="mt-4 space-y-4">
              <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                  <Crown className="h-4 w-4" />
                  Boss/Management Agent Focus
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Strategic insights, business intelligence, sales advice
                </p>
              </div>
              <div className="space-y-2">
                <Label>Boss Agent Prompt</Label>
                <Textarea
                  value={config.boss_agent_prompt}
                  onChange={(e) => updateConfig({ boss_agent_prompt: e.target.value })}
                  placeholder="You are the Head of Sales & Marketing advisor. Provide strategic insights, analyze data, and give actionable recommendations..."
                  rows={6}
                />
              </div>
              
              {/* Boss Reporting Configuration */}
              <Collapsible open={bossReportingOpen} onOpenChange={setBossReportingOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="w-full justify-between mt-4">
                    <div className="flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      Advanced Boss Reporting Configuration
                    </div>
                    <ChevronDown className={`h-4 w-4 transition-transform ${bossReportingOpen ? 'rotate-180' : ''}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4">
                  <BossReportingPanel config={config} updateConfig={updateConfig} />
                </CollapsibleContent>
              </Collapsible>
            </TabsContent>

            <TabsContent value="supervisor" className="mt-4 space-y-4">
              <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
                <div className="flex items-center gap-2 text-sm font-medium text-purple-700 dark:text-purple-400">
                  <Brain className="h-4 w-4" />
                  Supervisor Agent Focus
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Strategic analysis, pattern detection, and conversation optimization
                </p>
              </div>
              
              {/* Supervisor Configuration */}
              <Collapsible open={supervisorConfigOpen} onOpenChange={setSupervisorConfigOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <div className="flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      Supervisor Analysis Configuration
                    </div>
                    <ChevronDown className={`h-4 w-4 transition-transform ${supervisorConfigOpen ? 'rotate-180' : ''}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4">
                  <SupervisorConfigPanel 
                    config={{
                      supervisor_enabled: config.supervisor_enabled,
                      supervisor_live_analysis_enabled: config.supervisor_live_analysis_enabled,
                      supervisor_analysis_depth: config.supervisor_analysis_depth,
                      supervisor_focus_areas: config.supervisor_focus_areas,
                      supervisor_recommendation_style: config.supervisor_recommendation_style,
                      supervisor_context_window: config.supervisor_context_window,
                      supervisor_research_enabled: config.supervisor_research_enabled,
                      supervisor_pattern_detection: config.supervisor_pattern_detection,
                      supervisor_urgency_triggers: config.supervisor_urgency_triggers,
                      supervisor_output_format: config.supervisor_output_format,
                    }}
                    onConfigChange={updateConfig}
                  />
                </CollapsibleContent>
              </Collapsible>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Auto-Handoff Triggers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Auto-Handoff Triggers
          </CardTitle>
          <CardDescription>Keywords that automatically escalate to boss/human</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {config.auto_handoff_triggers.map(trigger => (
              <Badge key={trigger} variant="secondary" className="flex items-center gap-1 px-3 py-1">
                {trigger}
                <button
                  onClick={() => removeTrigger(trigger)}
                  className="ml-1 hover:text-destructive transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newTrigger}
              onChange={(e) => setNewTrigger(e.target.value)}
              placeholder="Add trigger keyword..."
              onKeyDown={(e) => e.key === 'Enter' && addHandoffTrigger()}
            />
            <Button variant="outline" size="icon" onClick={addHandoffTrigger}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
