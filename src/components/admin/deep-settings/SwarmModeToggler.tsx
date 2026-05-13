import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SwarmModeTogglerProps {
  companyId: string;
}

/**
 * Toggles companies.metadata.swarm_enabled.
 * When true, whatsapp-messages and auto-content-creator route their final reply
 * through the Omanut Social Swarm (Gatekeeper → Librarian → Creative ↔ Critic).
 */
export const SwarmModeToggler = ({ companyId }: SwarmModeTogglerProps) => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("metadata")
        .eq("id", companyId)
        .maybeSingle();
      if (!error && data) {
        const md = (data.metadata as Record<string, unknown> | null) || {};
        setEnabled(!!md.swarm_enabled);
      }
      setLoading(false);
    })();
  }, [companyId]);

  const toggle = async (next: boolean) => {
    setSaving(true);
    const { data: current } = await supabase
      .from("companies")
      .select("metadata")
      .eq("id", companyId)
      .maybeSingle();
    const md = ((current?.metadata as Record<string, unknown> | null) || {});
    const updated = { ...md, swarm_enabled: next };
    const { error } = await supabase
      .from("companies")
      .update({ metadata: updated })
      .eq("id", companyId);
    setSaving(false);
    if (error) {
      toast.error("Failed to update Swarm Mode");
      return;
    }
    setEnabled(next);
    toast.success(next ? "Swarm Mode enabled" : "Swarm Mode disabled");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Swarm Mode</CardTitle>
            <Badge variant="secondary">Beta</Badge>
          </div>
          <Switch
            checked={enabled}
            disabled={loading || saving}
            onCheckedChange={toggle}
            aria-label="Toggle Swarm Mode"
          />
        </div>
        <CardDescription className="pt-2">
          Routes final replies through a 5-agent quality loop (Gatekeeper → Librarian → Creative → Critic → Overseer).
          Adds ~3-5s latency but catches generic, off-brand, or hallucinated replies before they ship. Safe to enable per company.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        Critic threshold: 8/10 · Max retries: 3 · Audit log: <code>swarm_runs</code> table.
      </CardContent>
    </Card>
  );
};
