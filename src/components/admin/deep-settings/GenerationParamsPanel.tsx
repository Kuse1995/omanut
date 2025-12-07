import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AIConfig } from "../AIDeepSettings";
import { Thermometer, Hash, Clock, MessageSquare } from "lucide-react";

interface GenerationParamsPanelProps {
  config: AIConfig;
  updateConfig: (updates: Partial<AIConfig>) => void;
}

export const GenerationParamsPanel = ({ config, updateConfig }: GenerationParamsPanelProps) => {
  return (
    <div className="space-y-6">
      {/* Temperature */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Thermometer className="h-4 w-4 text-orange-500" />
            Creativity (Temperature)
          </CardTitle>
          <CardDescription>Higher values make output more random, lower values more focused</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Primary Model Temperature</span>
              <span className="font-mono font-medium">{config.primary_temperature.toFixed(1)}</span>
            </div>
            <Slider
              value={[config.primary_temperature]}
              onValueChange={([v]) => updateConfig({ primary_temperature: v })}
              min={0}
              max={2}
              step={0.1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Deterministic (0.0)</span>
              <span>Balanced (1.0)</span>
              <span>Creative (2.0)</span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Routing Model Temperature</span>
              <span className="font-mono font-medium">{config.routing_temperature.toFixed(1)}</span>
            </div>
            <Slider
              value={[config.routing_temperature]}
              onValueChange={([v]) => updateConfig({ routing_temperature: v })}
              min={0}
              max={1}
              step={0.1}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Lower is better for consistent routing decisions
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Token Limits */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Hash className="h-4 w-4 text-blue-500" />
            Token Limits
          </CardTitle>
          <CardDescription>Control response length and processing depth</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Max Response Tokens</Label>
              <Input
                type="number"
                value={config.max_tokens}
                onChange={(e) => updateConfig({ max_tokens: parseInt(e.target.value) || 2048 })}
                min={256}
                max={8192}
              />
              <p className="text-xs text-muted-foreground">256 - 8192 tokens</p>
            </div>
            <div className="space-y-2">
              <Label>Max Tool Rounds</Label>
              <Input
                type="number"
                value={config.max_tool_rounds}
                onChange={(e) => updateConfig({ max_tool_rounds: parseInt(e.target.value) || 2 })}
                min={1}
                max={5}
              />
              <p className="text-xs text-muted-foreground">How many tool calls before stopping</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Response Style */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-green-500" />
            Response Style
          </CardTitle>
          <CardDescription>Default response verbosity</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={config.response_length}
            onValueChange={(v) => updateConfig({ response_length: v })}
            className="space-y-3"
          >
            <div className="flex items-start space-x-3 p-3 rounded-lg border border-border hover:border-primary/50 transition-colors">
              <RadioGroupItem value="minimal" id="minimal" className="mt-1" />
              <div className="space-y-1">
                <Label htmlFor="minimal" className="font-medium cursor-pointer">Minimal</Label>
                <p className="text-xs text-muted-foreground">1-2 sentences, straight to the point</p>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-3 rounded-lg border border-border hover:border-primary/50 transition-colors">
              <RadioGroupItem value="balanced" id="balanced" className="mt-1" />
              <div className="space-y-1">
                <Label htmlFor="balanced" className="font-medium cursor-pointer">Balanced</Label>
                <p className="text-xs text-muted-foreground">2-4 sentences, natural conversation</p>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-3 rounded-lg border border-border hover:border-primary/50 transition-colors">
              <RadioGroupItem value="detailed" id="detailed" className="mt-1" />
              <div className="space-y-1">
                <Label htmlFor="detailed" className="font-medium cursor-pointer">Detailed</Label>
                <p className="text-xs text-muted-foreground">Full explanations when helpful</p>
              </div>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Timeout & Fallback */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-500" />
            Timeout & Fallback
          </CardTitle>
          <CardDescription>Behavior when AI takes too long to respond</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Response Timeout (seconds)</Label>
            <Input
              type="number"
              value={config.response_timeout_seconds}
              onChange={(e) => updateConfig({ response_timeout_seconds: parseInt(e.target.value) || 30 })}
              min={10}
              max={120}
            />
          </div>
          <div className="space-y-2">
            <Label>Fallback Message</Label>
            <Textarea
              value={config.fallback_message}
              onChange={(e) => updateConfig({ fallback_message: e.target.value })}
              placeholder="Message sent when response times out..."
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              Sent to customer if AI doesn't respond within timeout
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
