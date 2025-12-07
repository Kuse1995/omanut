import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AIConfig } from "../AIDeepSettings";
import { Shield, AlertTriangle, Eye, CheckCircle } from "lucide-react";

interface QualitySafetyPanelProps {
  config: AIConfig;
  updateConfig: (updates: Partial<AIConfig>) => void;
}

export const QualitySafetyPanel = ({ config, updateConfig }: QualitySafetyPanelProps) => {
  return (
    <div className="space-y-6">
      {/* Quality Scoring */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            Automatic Quality Scoring
          </CardTitle>
          <CardDescription>Real-time analysis of AI response quality</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Quality Scoring</Label>
              <p className="text-xs text-muted-foreground">Analyze responses for issues</p>
            </div>
            <Switch
              checked={config.quality_scoring_enabled}
              onCheckedChange={(v) => updateConfig({ quality_scoring_enabled: v })}
            />
          </div>

          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Auto-Flag Threshold</span>
              <span className="font-mono font-medium">{config.auto_flag_threshold}</span>
            </div>
            <Slider
              value={[config.auto_flag_threshold]}
              onValueChange={([v]) => updateConfig({ auto_flag_threshold: v })}
              min={50}
              max={95}
              step={5}
              className="w-full"
              disabled={!config.quality_scoring_enabled}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>More flags (50)</span>
              <span>Fewer flags (95)</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Responses scoring below this threshold are automatically flagged for review
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Content Filtering */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4 text-blue-500" />
            Content Filtering
          </CardTitle>
          <CardDescription>How strictly to filter AI responses</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={config.content_filtering_level}
            onValueChange={(v) => updateConfig({ content_filtering_level: v })}
            className="space-y-3"
          >
            <div className="flex items-start space-x-3 p-3 rounded-lg border border-border hover:border-primary/50 transition-colors">
              <RadioGroupItem value="strict" id="strict" className="mt-1" />
              <div className="space-y-1">
                <Label htmlFor="strict" className="font-medium cursor-pointer flex items-center gap-2">
                  <Shield className="h-4 w-4 text-red-500" />
                  Strict
                </Label>
                <p className="text-xs text-muted-foreground">
                  Block any potentially problematic content. Most conservative.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-3 rounded-lg border border-border hover:border-primary/50 transition-colors">
              <RadioGroupItem value="standard" id="standard" className="mt-1" />
              <div className="space-y-1">
                <Label htmlFor="standard" className="font-medium cursor-pointer flex items-center gap-2">
                  <Shield className="h-4 w-4 text-amber-500" />
                  Standard
                </Label>
                <p className="text-xs text-muted-foreground">
                  Balance safety with helpfulness. Recommended for most businesses.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-3 rounded-lg border border-border hover:border-primary/50 transition-colors">
              <RadioGroupItem value="minimal" id="minimal" className="mt-1" />
              <div className="space-y-1">
                <Label htmlFor="minimal" className="font-medium cursor-pointer flex items-center gap-2">
                  <Shield className="h-4 w-4 text-green-500" />
                  Minimal
                </Label>
                <p className="text-xs text-muted-foreground">
                  Trust the AI with minimal filtering. Only for advanced users.
                </p>
              </div>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Auto-Flag Triggers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Auto-Flag Triggers
          </CardTitle>
          <CardDescription>Conditions that always trigger flagging</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg border border-border">
            <div className="space-y-0.5">
              <span className="text-sm font-medium">Low Confidence (&lt;60%)</span>
              <p className="text-xs text-muted-foreground">AI unsure about its response</p>
            </div>
            <Switch checked disabled />
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg border border-border">
            <div className="space-y-0.5">
              <span className="text-sm font-medium">Hallucination Detected</span>
              <p className="text-xs text-muted-foreground">AI made up information</p>
            </div>
            <Switch checked disabled />
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg border border-border">
            <div className="space-y-0.5">
              <span className="text-sm font-medium">Tone Issues</span>
              <p className="text-xs text-muted-foreground">Response seems inappropriate</p>
            </div>
            <Switch checked disabled />
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg border border-border">
            <div className="space-y-0.5">
              <span className="text-sm font-medium">Wrong Information</span>
              <p className="text-xs text-muted-foreground">Incorrect product/price mentioned</p>
            </div>
            <Switch checked disabled />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            These triggers are always active and cannot be disabled for safety.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
