import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Bot, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface HarnessModePanelProps {
  companyId: string;
}

type HarnessMode = "off" | "pilot" | "on";

/**
 * Toggles companies.metadata.harness_mode (off | pilot | on) +
 * harness_pilot_phones. When off (default), whatsapp-messages uses the
 * in-house pipeline. pilot routes ONLY the listed phones to the external
 * omanut-harness (DeepSeek router on the farm). on routes all traffic for
 * this company. Any harness error falls back to the in-house pipeline.
 * See docs/HARNESS-INTEGRATION.md.
 */
export const HarnessModePanel = ({ companyId }: HarnessModePanelProps) => {
  const [mode, setMode] = useState<HarnessMode>("off");
  const [pilotPhones, setPilotPhones] = useState<string>("");
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
        setMode((md.harness_mode as HarnessMode) || "off");
        setPilotPhones(Array.isArray(md.harness_pilot_phones) ? (md.harness_pilot_phones as string[]).join(", ") : "");
      }
      setLoading(false);
    })();
  }, [companyId]);

  const save = async () => {
    setSaving(true);
    const { data: current } = await supabase
      .from("companies")
      .select("metadata")
      .eq("id", companyId)
      .maybeSingle();
    const md = ((current?.metadata as Record<string, unknown> | null) || {});
    const phones = pilotPhones
      .split(",")
      .map((p) => p.trim())
      .filter((p) => /^[+]?[0-9]{9,15}$/.test(p));
    const updated = {
      ...md,
      harness_mode: mode,
      ...(mode === "pilot" ? { harness_pilot_phones: phones } : { harness_pilot_phones: [] }),
    };
    const { error } = await supabase
      .from("companies")
      .update({ metadata: updated })
      .eq("id", companyId);
    setSaving(false);
    if (error) {
      toast.error("Failed to update Harness Mode");
      return;
    }
    toast.success(mode === "off" ? "Harness disabled — in-house pipeline" : `Harness ${mode} saved`);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">External Harness</CardTitle>
            <Badge variant={mode === "off" ? "secondary" : "default"}>{mode}</Badge>
          </div>
        </div>
        <CardDescription className="pt-2">
          Route the LLM decision to the external omanut-harness (DeepSeek router on the farm).
          <b> off</b> = in-house pipeline (default). <b>pilot</b> = only listed phones hit the
          harness. <b>on</b> = all traffic for this company. Any harness error falls back
          in-house — never fail-open.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Select value={mode} onValueChange={(v) => setMode(v as HarnessMode)} disabled={loading || saving}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">off — in-house</SelectItem>
              <SelectItem value="pilot">pilot — listed phones</SelectItem>
              <SelectItem value="on">on — all traffic</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8 text-xs" onClick={save} disabled={loading || saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
          </Button>
        </div>
        {mode === "pilot" && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Pilot phones (comma-separated, E.164)</label>
            <Input
              value={pilotPhones}
              onChange={(e) => setPilotPhones(e.target.value)}
              placeholder="+260972064502, +260977123456"
              className="h-8 text-xs"
              disabled={saving}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};
