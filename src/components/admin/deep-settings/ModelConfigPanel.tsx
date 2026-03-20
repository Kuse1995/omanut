import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AIConfig } from "../AIDeepSettings";
import { Cpu, Zap, Brain, Mic, Video } from "lucide-react";

interface ModelConfigPanelProps {
  config: AIConfig;
  updateConfig: (updates: Partial<AIConfig>) => void;
}

const AVAILABLE_MODELS = {
  primary: [
    { value: 'google/gemini-3-pro-preview', label: 'Gemini 3 Pro Preview', description: 'Most capable, excellent tool-calling', tier: 'premium' },
    { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Premium reasoning, large context', tier: 'premium' },
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast, cost-effective', tier: 'standard' },
    { value: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: 'Fastest, simple tasks', tier: 'economy' },
    { value: 'openai/gpt-5', label: 'GPT-5', description: 'Powerful all-rounder', tier: 'premium' },
    { value: 'openai/gpt-5-mini', label: 'GPT-5 Mini', description: 'Balanced cost/performance', tier: 'standard' },
    { value: 'openai/gpt-5-nano', label: 'GPT-5 Nano', description: 'Speed-optimized', tier: 'economy' },
  ],
  routing: [
    { value: 'deepseek-chat', label: 'DeepSeek Chat', description: 'Fast intent classification', tier: 'economy' },
    { value: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: 'Quick routing', tier: 'economy' },
    { value: 'openai/gpt-5-nano', label: 'GPT-5 Nano', description: 'Speed-optimized', tier: 'economy' },
  ],
  analysis: [
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Good balance for analysis', tier: 'standard' },
    { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Deep analysis', tier: 'premium' },
    { value: 'openai/gpt-5-mini', label: 'GPT-5 Mini', description: 'Balanced analysis', tier: 'standard' },
  ],
  voice: [
    { value: 'gpt-4o-realtime-preview-2024-12-17', label: 'GPT-4o Realtime', description: 'Latest realtime voice', tier: 'premium' },
  ],
};

const VOICE_STYLES = [
  { value: 'alloy', label: 'Alloy', description: 'Neutral, balanced' },
  { value: 'echo', label: 'Echo', description: 'Warm, friendly' },
  { value: 'fable', label: 'Fable', description: 'Storytelling, expressive' },
  { value: 'onyx', label: 'Onyx', description: 'Deep, authoritative' },
  { value: 'nova', label: 'Nova', description: 'Bright, energetic' },
  { value: 'shimmer', label: 'Shimmer', description: 'Soft, gentle' },
];

const getTierColor = (tier: string) => {
  switch (tier) {
    case 'premium': return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
    case 'standard': return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    case 'economy': return 'bg-green-500/10 text-green-600 border-green-500/20';
    default: return 'bg-muted text-muted-foreground';
  }
};

export const ModelConfigPanel = ({ config, updateConfig }: ModelConfigPanelProps) => {
  return (
    <div className="space-y-6">
      {/* Primary Conversation Model */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            Primary Conversation Model
          </CardTitle>
          <CardDescription>Used for customer-facing conversations and complex interactions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={config.primary_model} onValueChange={(v) => updateConfig({ primary_model: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {AVAILABLE_MODELS.primary.map(model => (
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
            {AVAILABLE_MODELS.primary.find(m => m.value === config.primary_model)?.description}
          </p>
        </CardContent>
      </Card>

      {/* Routing Model */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            Routing / Supervisor Model
          </CardTitle>
          <CardDescription>Used for intent classification and agent routing (cheaper, faster)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={config.routing_model} onValueChange={(v) => updateConfig({ routing_model: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {AVAILABLE_MODELS.routing.map(model => (
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
            {AVAILABLE_MODELS.routing.find(m => m.value === config.routing_model)?.description}
          </p>
        </CardContent>
      </Card>

      {/* Analysis Model */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="h-4 w-4 text-blue-500" />
            Quality Analysis Model
          </CardTitle>
          <CardDescription>Used for response quality scoring and error detection</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={config.analysis_model} onValueChange={(v) => updateConfig({ analysis_model: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {AVAILABLE_MODELS.analysis.map(model => (
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
        </CardContent>
      </Card>

      {/* Voice Model */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Mic className="h-4 w-4 text-purple-500" />
            Voice Model & Style
          </CardTitle>
          <CardDescription>Used for real-time voice conversations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={config.voice_model} onValueChange={(v) => updateConfig({ voice_model: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_MODELS.voice.map(model => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Voice Style</Label>
              <Select value={config.voice_style} onValueChange={(v) => updateConfig({ voice_style: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select voice" />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_STYLES.map(voice => (
                    <SelectItem key={voice.value} value={voice.value}>
                      <div className="flex flex-col">
                        <span>{voice.label}</span>
                        <span className="text-xs text-muted-foreground">{voice.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Video Provider */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Video className="h-4 w-4 text-rose-500" />
            Video Generation Provider
          </CardTitle>
          <CardDescription>Choose the engine used for video generation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={config.video_provider} onValueChange={(v) => updateConfig({ video_provider: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minimax">
                <div className="flex items-center gap-2">
                  <span>MiniMax Hailuo 2.3</span>
                  <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">$0.32/video</Badge>
                </div>
              </SelectItem>
              <SelectItem value="veo">
                <div className="flex items-center gap-2">
                  <span>Google Veo</span>
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">premium</Badge>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {config.video_provider === 'veo'
              ? 'Higher quality video generation via Google Veo. Uses Gemini API.'
              : 'Cost-effective 768P video at $0.32 per 10s clip. Supports image-to-video and text-to-video.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
