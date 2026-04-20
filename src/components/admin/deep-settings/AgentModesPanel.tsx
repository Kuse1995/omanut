import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Sparkles, Save, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AGENT_MODE_TEMPLATES, AgentModeTemplate } from "./AgentModeTemplates";
import { AgentModeEditor, AgentMode } from "./AgentModeEditor";

interface Props {
  companyId: string;
}

export const AgentModesPanel = ({ companyId }: Props) => {
  const [modes, setModes] = useState<AgentMode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const load = async () => {
    setLoading(true);
    // Ensure modes exist (server-side seed from legacy prompts if first time)
    await supabase.rpc("seed_company_agent_modes" as any, { _company_id: companyId } as any);
    const { data, error } = await supabase
      .from("company_agent_modes" as any)
      .select("*")
      .eq("company_id", companyId)
      .order("priority", { ascending: true });
    if (error) {
      toast.error("Failed to load agent modes");
      setLoading(false);
      return;
    }
    setModes((data as unknown as AgentMode[]) || []);
    setDirty(false);
    setLoading(false);
  };

  const updateMode = (id: string, updates: Partial<AgentMode>) => {
    setModes((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)));
    setDirty(true);
  };

  const deleteMode = async (id: string) => {
    const m = modes.find((x) => x.id === id);
    if (!m) return;
    if (!confirm(`Delete "${m.name}" mode? This cannot be undone.`)) return;
    const { error } = await supabase.from("company_agent_modes" as any).delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete mode");
      return;
    }
    setModes((prev) => prev.filter((x) => x.id !== id));
    toast.success(`"${m.name}" deleted`);
  };

  const addFromTemplate = async (tpl: AgentModeTemplate) => {
    // Generate unique slug if it already exists
    let slug = tpl.slug;
    let n = 2;
    while (modes.some((m) => m.slug === slug)) {
      slug = `${tpl.slug}_${n++}`;
    }
    const maxPriority = modes.reduce((acc, m) => Math.max(acc, m.priority), 0);
    const { data, error } = await supabase
      .from("company_agent_modes" as any)
      .insert({
        company_id: companyId,
        slug,
        name: tpl.name,
        icon: tpl.icon,
        system_prompt: tpl.system_prompt,
        trigger_keywords: tpl.trigger_keywords,
        trigger_examples: tpl.trigger_examples,
        enabled_tools: tpl.enabled_tools || [],
        enabled: true,
        priority: maxPriority + 10,
        is_default: false,
        pauses_for_human: tpl.pauses_for_human,
        description: tpl.description,
      })
      .select()
      .single();
    if (error) {
      toast.error(`Failed to add mode: ${error.message}`);
      return;
    }
    setModes((prev) => [...prev, data as unknown as AgentMode]);
    setPickerOpen(false);
    toast.success(`"${tpl.name}" added`);
  };

  const saveAll = async () => {
    setSaving(true);
    const updates = modes.map((m) =>
      supabase
        .from("company_agent_modes" as any)
        .update({
          name: m.name,
          system_prompt: m.system_prompt,
          trigger_keywords: m.trigger_keywords,
          trigger_examples: m.trigger_examples,
          enabled: m.enabled,
          priority: m.priority,
          pauses_for_human: m.pauses_for_human,
        })
        .eq("id", m.id)
    );
    const results = await Promise.all(updates);
    const failed = results.filter((r) => r.error);
    setSaving(false);
    if (failed.length > 0) {
      toast.error(`Failed to save ${failed.length} mode(s)`);
      return;
    }
    setDirty(false);
    toast.success("Agent modes saved");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Agent Modes
            </CardTitle>
            <CardDescription>
              Define how the AI behaves for different intents (HR, Sales, Support, etc.). The router picks one per message.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-1" /> Add Mode
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add Agent Mode</DialogTitle>
                  <DialogDescription>Pick a template — you can customise everything after.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-2 mt-2">
                  {AGENT_MODE_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.slug}
                      onClick={() => addFromTemplate(tpl)}
                      className="text-left p-3 rounded-lg border hover:bg-accent transition-colors"
                    >
                      <div className="font-medium">{tpl.name}</div>
                      <div className="text-xs text-muted-foreground">{tpl.description}</div>
                    </button>
                  ))}
                </div>
              </DialogContent>
            </Dialog>
            <Button size="sm" onClick={saveAll} disabled={!dirty || saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Save
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading modes...</div>
        ) : modes.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No modes yet — click "Add Mode" to start.
          </div>
        ) : (
          modes.map((m) => (
            <AgentModeEditor
              key={m.id}
              mode={m}
              onChange={(u) => updateMode(m.id, u)}
              onDelete={() => deleteMode(m.id)}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
};
