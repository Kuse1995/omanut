import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface EventRow {
  id: string;
  company_id: string;
  channel: string;
  source: string;
  status: string;
  error_class: string | null;
  attempts: number;
  last_error: string | null;
  ai_response: string | null;
  model: string | null;
  latency_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

export default function EventQueue() {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("inbound_events")
      .select("id, company_id, channel, source, status, error_class, attempts, last_error, ai_response, model, latency_ms, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    setRows((data as any) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const stats = useMemo(() => {
    const by: Record<string, number> = {};
    let totalLatency = 0;
    let latencyCount = 0;
    const errClass: Record<string, number> = {};
    for (const r of rows) {
      by[r.status] = (by[r.status] ?? 0) + 1;
      if (r.latency_ms) { totalLatency += r.latency_ms; latencyCount++; }
      if (r.error_class) errClass[r.error_class] = (errClass[r.error_class] ?? 0) + 1;
    }
    return {
      by,
      avgLatency: latencyCount ? Math.round(totalLatency / latencyCount) : 0,
      errClass,
    };
  }, [rows]);

  const filtered = useMemo(
    () => filter === "all" ? rows : rows.filter((r) => r.status === filter),
    [rows, filter],
  );

  async function replay(id: string) {
    const { error } = await supabase
      .from("inbound_events")
      .update({ status: "pending", attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Re-queued");
    await supabase.functions.invoke("openclaw-worker", { body: { event_id: id } });
    load();
  }

  const statusColor = (s: string) =>
    s === "sent" ? "default" :
    s === "dead" || s === "failed" ? "destructive" :
    s === "processing" ? "secondary" :
    s === "pending" ? "outline" : "secondary";

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/admin/dashboard">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back</Button>
          </Link>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>

        <div>
          <h1 className="text-2xl font-semibold">Event Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Inbound events processed by the centralized auto-reply worker.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {["pending", "processing", "sent", "failed", "dead", "skipped"].map((s) => (
            <Card key={s} className="p-3 cursor-pointer hover:bg-accent" onClick={() => setFilter(s)}>
              <div className="text-xs text-muted-foreground capitalize">{s}</div>
              <div className="text-2xl font-semibold mt-1">{stats.by[s] ?? 0}</div>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Avg latency: <b className="text-foreground">{stats.avgLatency}ms</b></span>
          {Object.entries(stats.errClass).map(([k, v]) => (
            <Badge key={k} variant="outline">{k}: {v}</Badge>
          ))}
          {filter !== "all" && (
            <Button size="sm" variant="ghost" onClick={() => setFilter("all")}>Clear filter</Button>
          )}
        </div>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left p-3">When</th>
                  <th className="text-left p-3">Channel</th>
                  <th className="text-left p-3">Source</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Att.</th>
                  <th className="text-left p-3">Latency</th>
                  <th className="text-left p-3">AI / Error</th>
                  <th className="text-left p-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-3 text-muted-foreground whitespace-nowrap">
                      {new Date(r.created_at).toLocaleTimeString()}
                    </td>
                    <td className="p-3">{r.channel}</td>
                    <td className="p-3 text-muted-foreground">{r.source}</td>
                    <td className="p-3"><Badge variant={statusColor(r.status) as any}>{r.status}</Badge></td>
                    <td className="p-3">{r.attempts}</td>
                    <td className="p-3 text-muted-foreground">{r.latency_ms ? `${r.latency_ms}ms` : "—"}</td>
                    <td className="p-3 max-w-md truncate" title={r.ai_response ?? r.last_error ?? ""}>
                      {r.ai_response ?? (
                        <span className="text-destructive">{r.last_error}</span>
                      )}
                    </td>
                    <td className="p-3">
                      {(r.status === "dead" || r.status === "failed") && (
                        <Button size="sm" variant="outline" onClick={() => replay(r.id)}>
                          <RotateCcw className="h-3 w-3 mr-1" />Replay
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No events</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
