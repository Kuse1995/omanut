import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  HeadphonesIcon, TrendingUp, Crown, Briefcase, CalendarDays, Moon,
  Wrench, Receipt, MessageSquare, X, Plus, Trash2, ChevronDown, ChevronUp,
} from "lucide-react";

const ICONS: Record<string, any> = {
  HeadphonesIcon, TrendingUp, Crown, Briefcase, CalendarDays, Moon,
  Wrench, Receipt, MessageSquare,
};

// Direct providers only — no Lovable AI Gateway.
// Value `__default__` is mapped to NULL in the DB → inherit company primary_model.
const MODEL_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "__default__", label: "Use company default", hint: "Inherits the company's primary model" },
  { value: "glm-4.7", label: "GLM-4.7 (Zhipu)", hint: "Fast & cheap workhorse — strong tool calls" },
  { value: "glm-4.6", label: "GLM-4.6 (Zhipu)", hint: "Slightly cheaper fallback" },
  { value: "glm-4.5-air", label: "GLM-4.5 Air (Zhipu)", hint: "Fastest classification / routing" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Google)", hint: "Best reasoning, long context, escalation summaries" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Google)", hint: "Fast multimodal fallback" },
  { value: "deepseek-chat", label: "DeepSeek Chat", hint: "Cheap general-purpose fallback" },
  { value: "deepseek-reasoner", label: "DeepSeek Reasoner", hint: "Heavy reasoning when GLM unavailable" },
  { value: "kimi-k2-0711-preview", label: "Kimi K2 (Moonshot)", hint: "Long-context, very cheap" },
];

export interface AgentMode {
  id: string;
  company_id: string;
  slug: string;
  name: string;
  icon: string;
  system_prompt: string;
  trigger_keywords: string[];
  trigger_examples: string[];
  enabled_tools: string[];
  enabled: boolean;
  priority: number;
  is_default: boolean;
  pauses_for_human: boolean;
  description: string | null;
  model: string | null;
}

interface Props {
  mode: AgentMode;
  onChange: (updates: Partial<AgentMode>) => void;
  onDelete: () => void;
  defaultOpen?: boolean;
}

export const AgentModeEditor = ({ mode, onChange, onDelete, defaultOpen }: Props) => {
  const [open, setOpen] = useState(!!defaultOpen);
  const [newKeyword, setNewKeyword] = useState("");
  const [newExample, setNewExample] = useState("");
  const Icon = ICONS[mode.icon] || MessageSquare;

  const addKeyword = () => {
    const v = newKeyword.trim();
    if (!v || mode.trigger_keywords.includes(v)) return;
    onChange({ trigger_keywords: [...mode.trigger_keywords, v] });
    setNewKeyword("");
  };
  const removeKeyword = (k: string) =>
    onChange({ trigger_keywords: mode.trigger_keywords.filter((x) => x !== k) });

  const addExample = () => {
    const v = newExample.trim();
    if (!v) return;
    onChange({ trigger_examples: [...mode.trigger_examples, v] });
    setNewExample("");
  };
  const removeExample = (i: number) =>
    onChange({ trigger_examples: mode.trigger_examples.filter((_, idx) => idx !== i) });

  return (
    <Card className={mode.enabled ? "" : "opacity-60"}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{mode.name}</span>
              {mode.is_default && <Badge variant="secondary" className="text-xs">Default</Badge>}
              {mode.pauses_for_human && <Badge variant="outline" className="text-xs">Pauses AI</Badge>}
              <Badge variant="outline" className="text-xs font-mono">{mode.slug}</Badge>
            </div>
            {mode.description && (
              <p className="text-xs text-muted-foreground truncate">{mode.description}</p>
            )}
          </div>
          <Switch
            checked={mode.enabled}
            onCheckedChange={(v) => onChange({ enabled: v })}
          />
          <Button variant="ghost" size="icon" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>

        {open && (
          <div className="space-y-4 pt-2 border-t">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Display Name</Label>
                <Input value={mode.name} onChange={(e) => onChange({ name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Priority (lower = checked first)</Label>
                <Input
                  type="number"
                  value={mode.priority}
                  onChange={(e) => onChange({ priority: parseInt(e.target.value) || 100 })}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">AI Model</Label>
              <Select
                value={mode.model ?? "__default__"}
                onValueChange={(v) => onChange({ model: v === "__default__" ? null : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex flex-col">
                        <span>{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.hint}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Pick the AI model that powers this agent. Leave on "Use company default" to inherit.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">System Prompt</Label>
              <Textarea
                rows={6}
                value={mode.system_prompt}
                onChange={(e) => onChange({ system_prompt: e.target.value })}
                placeholder="Tell the AI how to behave when this mode is selected..."
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Trigger Keywords</Label>
              <div className="flex flex-wrap gap-2">
                {mode.trigger_keywords.map((k) => (
                  <Badge key={k} variant="secondary" className="gap-1">
                    {k}
                    <button onClick={() => removeKeyword(k)} className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  placeholder="Add keyword..."
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeyword())}
                />
                <Button size="icon" variant="outline" onClick={addKeyword}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Example Customer Messages</Label>
              <div className="space-y-1">
                {mode.trigger_examples.map((ex, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 px-3 py-1.5 rounded-md bg-muted">{ex}</span>
                    <Button size="icon" variant="ghost" onClick={() => removeExample(i)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newExample}
                  onChange={(e) => setNewExample(e.target.value)}
                  placeholder='e.g. "I would like to apply for a job"'
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExample())}
                />
                <Button size="icon" variant="outline" onClick={addExample}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={mode.pauses_for_human}
                  onCheckedChange={(v) => onChange({ pauses_for_human: v })}
                />
                <Label className="text-xs">Pause AI for human takeover when this mode triggers</Label>
              </div>
              {!mode.is_default && (
                <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive">
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
