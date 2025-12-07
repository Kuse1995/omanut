import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AIConfig } from "../AIDeepSettings";
import { FlaskConical, TrendingUp, Clock, Users } from "lucide-react";

interface ABTestPanelProps {
  config: AIConfig;
  updateConfig: (updates: Partial<AIConfig>) => void;
}

const AB_TEST_MODELS = [
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'standard' },
  { value: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', tier: 'economy' },
  { value: 'openai/gpt-5-mini', label: 'GPT-5 Mini', tier: 'standard' },
  { value: 'openai/gpt-5-nano', label: 'GPT-5 Nano', tier: 'economy' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'premium' },
  { value: 'openai/gpt-5', label: 'GPT-5', tier: 'premium' },
];

export const ABTestPanel = ({ config, updateConfig }: ABTestPanelProps) => {
  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'premium': return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
      case 'standard': return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
      case 'economy': return 'bg-green-500/10 text-green-600 border-green-500/20';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      {/* A/B Test Toggle */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-purple-500" />
            A/B Testing
          </CardTitle>
          <CardDescription>
            Compare performance between different model configurations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-muted/30">
            <div className="space-y-0.5">
              <Label className="text-base">Enable A/B Testing</Label>
              <p className="text-xs text-muted-foreground">
                50% of conversations will use the variant configuration
              </p>
            </div>
            <Switch
              checked={config.ab_test_enabled}
              onCheckedChange={(v) => updateConfig({ ab_test_enabled: v })}
            />
          </div>

          {config.ab_test_enabled && (
            <>
              <div className="space-y-4">
                <Label>Variant B Model</Label>
                <Select 
                  value={config.ab_test_model} 
                  onValueChange={(v) => updateConfig({ ab_test_model: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select variant model" />
                  </SelectTrigger>
                  <SelectContent>
                    {AB_TEST_MODELS.map(model => (
                      <SelectItem key={model.value} value={model.value}>
                        <div className="flex items-center gap-2">
                          <span>{model.label}</span>
                          <Badge variant="outline" className={getTierColor(model.tier)}>
                            {model.tier}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Variant A: {config.primary_model}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Test Variant Name</Label>
                <Input
                  value={config.ab_test_variant}
                  onChange={(e) => updateConfig({ ab_test_variant: e.target.value })}
                  placeholder="e.g., faster-model-test, cost-reduction-v1"
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Test Results Preview */}
      {config.ab_test_enabled && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              Test Results Preview
            </CardTitle>
            <CardDescription>
              Live comparison data (updates after test starts)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border border-border bg-muted/20">
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
                    Variant A
                  </Badge>
                  <span className="text-xs text-muted-foreground">(Current)</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Users className="h-3 w-3" /> Conversations
                    </span>
                    <span className="font-mono">--</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Avg Response
                    </span>
                    <span className="font-mono">--</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Handoff Rate</span>
                    <span className="font-mono">--</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Quality Score</span>
                    <span className="font-mono">--</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg border border-border bg-muted/20">
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/20">
                    Variant B
                  </Badge>
                  <span className="text-xs text-muted-foreground">(Test)</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Users className="h-3 w-3" /> Conversations
                    </span>
                    <span className="font-mono">--</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Avg Response
                    </span>
                    <span className="font-mono">--</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Handoff Rate</span>
                    <span className="font-mono">--</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Quality Score</span>
                    <span className="font-mono">--</span>
                  </div>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4 text-center">
              Results will populate once the test receives traffic
            </p>
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <FlaskConical className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                <strong>How A/B testing works:</strong>
              </p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>50% of new conversations are randomly assigned to each variant</li>
                <li>Existing conversations stay on their assigned variant</li>
                <li>Compare metrics like response time, quality scores, and handoff rates</li>
                <li>Disable the test to return all conversations to Variant A</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
