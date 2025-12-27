import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Brain, Eye, Target, Zap, AlertTriangle, FileText } from "lucide-react";

interface SupervisorConfig {
  supervisor_enabled: boolean;
  supervisor_live_analysis_enabled: boolean;
  supervisor_analysis_depth: string;
  supervisor_focus_areas: string[];
  supervisor_recommendation_style: string;
  supervisor_context_window: number;
  supervisor_research_enabled: boolean;
  supervisor_pattern_detection: string[];
  supervisor_urgency_triggers: {
    high_value_customer: boolean;
    complaint: boolean;
    churn_risk: boolean;
    escalation_needed: boolean;
    competitor_mention: boolean;
  };
  supervisor_output_format: string;
}

interface SupervisorConfigPanelProps {
  config: SupervisorConfig;
  onConfigChange: (updates: Partial<SupervisorConfig>) => void;
}

const focusAreaOptions = [
  { id: 'conversion_optimization', label: 'Conversion Optimization', description: 'Focus on converting leads to customers' },
  { id: 'customer_satisfaction', label: 'Customer Satisfaction', description: 'Prioritize customer happiness and retention' },
  { id: 'upselling', label: 'Upselling Opportunities', description: 'Identify opportunities for additional sales' },
  { id: 'issue_resolution', label: 'Issue Resolution', description: 'Focus on resolving customer problems quickly' },
  { id: 'sentiment_analysis', label: 'Sentiment Analysis', description: 'Deep analysis of customer emotions and tone' },
  { id: 'competitor_intelligence', label: 'Competitor Intelligence', description: 'Track competitor mentions and comparisons' },
];

const patternOptions = [
  { id: 'buying_signals', label: 'Buying Signals', description: 'Detect when customers are ready to buy' },
  { id: 'objections', label: 'Objections', description: 'Identify customer objections and concerns' },
  { id: 'sentiment_shifts', label: 'Sentiment Shifts', description: 'Track changes in customer mood' },
  { id: 'urgency_indicators', label: 'Urgency Indicators', description: 'Detect time-sensitive requests' },
  { id: 'loyalty_signals', label: 'Loyalty Signals', description: 'Identify returning or loyal customers' },
  { id: 'churn_risk', label: 'Churn Risk', description: 'Detect customers at risk of leaving' },
];

export function SupervisorConfigPanel({ config, onConfigChange }: SupervisorConfigPanelProps) {
  const handleFocusAreaToggle = (areaId: string, checked: boolean) => {
    const currentAreas = config.supervisor_focus_areas || [];
    const newAreas = checked
      ? [...currentAreas, areaId]
      : currentAreas.filter(a => a !== areaId);
    onConfigChange({ supervisor_focus_areas: newAreas });
  };

  const handlePatternToggle = (patternId: string, checked: boolean) => {
    const currentPatterns = config.supervisor_pattern_detection || [];
    const newPatterns = checked
      ? [...currentPatterns, patternId]
      : currentPatterns.filter(p => p !== patternId);
    onConfigChange({ supervisor_pattern_detection: newPatterns });
  };

  const handleUrgencyTriggerToggle = (trigger: keyof SupervisorConfig['supervisor_urgency_triggers'], checked: boolean) => {
    const defaultTriggers = {
      high_value_customer: false,
      complaint: false,
      churn_risk: false,
      escalation_needed: false,
      competitor_mention: false,
    };
    const currentTriggers = config.supervisor_urgency_triggers || defaultTriggers;
    onConfigChange({
      supervisor_urgency_triggers: {
        ...defaultTriggers,
        ...currentTriggers,
        [trigger]: checked,
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Enable/Disable Supervisor */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Supervisor Agent</CardTitle>
            </div>
            <Switch
              checked={config.supervisor_enabled}
              onCheckedChange={(checked) => onConfigChange({ supervisor_enabled: checked })}
            />
          </div>
          <CardDescription>
            Enable the supervisor agent to analyze conversations and provide strategic recommendations
          </CardDescription>
        </CardHeader>
        {config.supervisor_enabled && (
          <CardContent className="pt-0">
            <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
              <div className="space-y-0.5">
                <Label className="font-medium flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  Live Analysis in Chat
                </Label>
                <p className="text-xs text-muted-foreground">
                  Show real-time insights bar in the conversation view as messages arrive
                </p>
              </div>
              <Switch
                checked={config.supervisor_live_analysis_enabled}
                onCheckedChange={(checked) => onConfigChange({ supervisor_live_analysis_enabled: checked })}
              />
            </div>
          </CardContent>
        )}
      </Card>

      {config.supervisor_enabled && (
        <>
          {/* Analysis Settings */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Analysis Settings</CardTitle>
              </div>
              <CardDescription>Configure how deeply the supervisor analyzes conversations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Analysis Depth</Label>
                <Select
                  value={config.supervisor_analysis_depth || 'balanced'}
                  onValueChange={(value) => onConfigChange({ supervisor_analysis_depth: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quick">Quick Glance - Fast, surface-level analysis</SelectItem>
                    <SelectItem value="balanced">Balanced - Good mix of speed and depth</SelectItem>
                    <SelectItem value="deep">Deep Dive - Comprehensive, detailed analysis</SelectItem>
                    <SelectItem value="exhaustive">Exhaustive - Maximum insight extraction</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Context Window (messages)</Label>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[config.supervisor_context_window || 10]}
                    onValueChange={([value]) => onConfigChange({ supervisor_context_window: value })}
                    min={5}
                    max={50}
                    step={5}
                    className="flex-1"
                  />
                  <span className="text-sm font-medium w-12 text-right">
                    {config.supervisor_context_window || 10}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Number of recent messages to include in analysis
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Web Research</Label>
                  <p className="text-xs text-muted-foreground">
                    Allow supervisor to research products/topics mentioned
                  </p>
                </div>
                <Switch
                  checked={config.supervisor_research_enabled}
                  onCheckedChange={(checked) => onConfigChange({ supervisor_research_enabled: checked })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Focus Areas */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Focus Areas</CardTitle>
              </div>
              <CardDescription>What should the supervisor prioritize when analyzing?</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {focusAreaOptions.map((area) => (
                  <div
                    key={area.id}
                    className="flex items-start space-x-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <Checkbox
                      id={area.id}
                      checked={(config.supervisor_focus_areas || []).includes(area.id)}
                      onCheckedChange={(checked) => handleFocusAreaToggle(area.id, checked as boolean)}
                    />
                    <div className="space-y-1">
                      <Label htmlFor={area.id} className="cursor-pointer font-medium">
                        {area.label}
                      </Label>
                      <p className="text-xs text-muted-foreground">{area.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Pattern Detection */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Pattern Detection</CardTitle>
              </div>
              <CardDescription>Which patterns should the supervisor look for?</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {patternOptions.map((pattern) => (
                  <div
                    key={pattern.id}
                    className="flex items-start space-x-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <Checkbox
                      id={pattern.id}
                      checked={(config.supervisor_pattern_detection || []).includes(pattern.id)}
                      onCheckedChange={(checked) => handlePatternToggle(pattern.id, checked as boolean)}
                    />
                    <div className="space-y-1">
                      <Label htmlFor={pattern.id} className="cursor-pointer font-medium">
                        {pattern.label}
                      </Label>
                      <p className="text-xs text-muted-foreground">{pattern.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Urgency Triggers */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Urgency Triggers</CardTitle>
              </div>
              <CardDescription>When should the supervisor flag conversations as urgent?</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { id: 'high_value_customer', label: 'High-Value Customer', description: 'Flag when interacting with VIP customers' },
                  { id: 'complaint', label: 'Complaint Detected', description: 'Flag when customer expresses dissatisfaction' },
                  { id: 'churn_risk', label: 'Churn Risk', description: 'Flag when customer shows signs of leaving' },
                  { id: 'escalation_needed', label: 'Escalation Needed', description: 'Flag when human intervention is recommended' },
                  { id: 'competitor_mention', label: 'Competitor Mention', description: 'Flag when competitors are mentioned' },
                ].map((trigger) => (
                  <div
                    key={trigger.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card"
                  >
                    <div className="space-y-0.5">
                      <Label className="font-medium">{trigger.label}</Label>
                      <p className="text-xs text-muted-foreground">{trigger.description}</p>
                    </div>
                    <Switch
                      checked={config.supervisor_urgency_triggers?.[trigger.id as keyof SupervisorConfig['supervisor_urgency_triggers']] ?? false}
                      onCheckedChange={(checked) => handleUrgencyTriggerToggle(trigger.id as keyof SupervisorConfig['supervisor_urgency_triggers'], checked)}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Output Settings */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Output Settings</CardTitle>
              </div>
              <CardDescription>Configure how the supervisor presents its findings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Recommendation Style</Label>
                <Select
                  value={config.supervisor_recommendation_style || 'actionable'}
                  onValueChange={(value) => onConfigChange({ supervisor_recommendation_style: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="actionable">Actionable Steps - Specific actions to take</SelectItem>
                    <SelectItem value="strategic">Strategic Overview - High-level insights</SelectItem>
                    <SelectItem value="coaching">Coaching Style - Educational guidance</SelectItem>
                    <SelectItem value="data_driven">Data-Driven - Numbers and metrics focused</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Output Format</Label>
                <Select
                  value={config.supervisor_output_format || 'structured_json'}
                  onValueChange={(value) => onConfigChange({ supervisor_output_format: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="structured_json">Structured JSON - For system processing</SelectItem>
                    <SelectItem value="narrative">Narrative - Human-readable text</SelectItem>
                    <SelectItem value="bullet_points">Bullet Points - Quick scanning</SelectItem>
                    <SelectItem value="hybrid">Hybrid - JSON with narrative sections</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
