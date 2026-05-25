import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

interface Conversation {
  id: string;
  company_id: string;
  customer_name: string | null;
  phone: string | null;
  status: string;
  human_takeover: boolean | null;
  takeover_at: string | null;
  takeover_by: string | null;
  paused_reason: string | null;
  paused_until: string | null;
  last_message_at: string | null;
}

export default function ConversationControl() {
  const { id } = useParams<{ id: string }>();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState<number>(60);

  async function load() {
    if (!id) return;
    const { data, error } = await supabase
      .from("conversations")
      .select("id, company_id, customer_name, phone, status, human_takeover, takeover_at, takeover_by, paused_reason, paused_until, last_message_at")
      .eq("id", id)
      .maybeSingle();
    if (error) return toast.error(error.message);
    setConv(data as any);
    setReason((data as any)?.paused_reason ?? "");
  }
  useEffect(() => { load(); }, [id]);

  async function pause() {
    if (!conv) return;
    const until = minutes > 0 ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("conversations")
      .update({
        human_takeover: true,
        takeover_at: new Date().toISOString(),
        takeover_by: u.user?.id ?? null,
        paused_reason: reason || null,
        paused_until: until,
      })
      .eq("id", conv.id);
    if (error) return toast.error(error.message);
    toast.success("Conversation paused");
    load();
  }

  async function resume() {
    if (!conv) return;
    const { error } = await supabase
      .from("conversations")
      .update({
        human_takeover: false,
        takeover_at: null,
        takeover_by: null,
        paused_reason: null,
        paused_until: null,
      })
      .eq("id", conv.id);
    if (error) return toast.error(error.message);
    toast.success("AI resumed");
    load();
  }

  if (!conv) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Link to="/admin/dashboard"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-2" /> Back</Button></Link>
        <div className="mt-6 text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const paused = !!conv.human_takeover;

  return (
    <div className="min-h-screen bg-background p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link to="/admin/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">Conversation Control</h1>
        <Badge className="ml-auto" variant={paused ? "secondary" : "default"}>
          {paused ? "Paused (human takeover)" : "AI active"}
        </Badge>
      </div>

      <Card className="p-4 space-y-2 text-sm">
        <div><span className="text-muted-foreground">Customer:</span> {conv.customer_name ?? "—"}</div>
        <div><span className="text-muted-foreground">Phone:</span> {conv.phone ?? "—"}</div>
        <div><span className="text-muted-foreground">Status:</span> {conv.status}</div>
        <div><span className="text-muted-foreground">Last message:</span> {conv.last_message_at ? new Date(conv.last_message_at).toLocaleString() : "—"}</div>
        {paused && (
          <>
            <div><span className="text-muted-foreground">Paused at:</span> {conv.takeover_at ? new Date(conv.takeover_at).toLocaleString() : "—"}</div>
            <div><span className="text-muted-foreground">Paused until:</span> {conv.paused_until ? new Date(conv.paused_until).toLocaleString() : "manual resume"}</div>
            <div><span className="text-muted-foreground">Reason:</span> {conv.paused_reason ?? "—"}</div>
          </>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-medium">{paused ? "Update or resume" : "Pause AI for this conversation"}</div>
        <textarea
          className="w-full text-sm border border-border bg-background rounded-md p-2 min-h-[80px]"
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex items-center gap-2 text-sm">
          <label className="text-muted-foreground">Auto-resume in</label>
          <input
            type="number"
            min={0}
            className="w-20 border border-border bg-background rounded-md px-2 py-1"
            value={minutes}
            onChange={(e) => setMinutes(parseInt(e.target.value || "0", 10))}
          />
          <span className="text-muted-foreground">minutes (0 = manual)</span>
        </div>
        <div className="flex gap-2">
          <Button onClick={pause}>{paused ? "Update pause" : "Pause AI"}</Button>
          {paused && <Button variant="outline" onClick={resume}>Resume AI</Button>}
        </div>
      </Card>
    </div>
  );
}
