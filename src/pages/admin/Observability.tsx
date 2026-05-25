import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, RefreshCw } from "lucide-react";

interface EventStats { status: string; count: number; avg_latency: number | null }
interface MetricRow { metric: string; value: number; recorded_at: string; company_id: string | null }

export default function Observability() {
  const [eventStats, setEventStats] = useState<EventStats[]>([]);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [errors, setErrors] = useState<Array<{ error_class: string; count: number }>>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ data: events }, { data: m }] = await Promise.all([
      supabase
        .from("inbound_events")
        .select("status, latency_ms, error_class")
        .gte("created_at", since)
        .limit(2000),
      supabase
        .from("system_metrics")
        .select("metric, value, recorded_at, company_id")
        .gte("recorded_at", since)
        .order("recorded_at", { ascending: false })
        .limit(500),
    ]);

    const byStatus = new Map<string, { count: number; lat: number; n: number }>();
    const byErr = new Map<string, number>();
    for (const e of events ?? []) {
      const s = byStatus.get((e as any).status) ?? { count: 0, lat: 0, n: 0 };
      s.count++;
      if ((e as any).latency_ms) { s.lat += (e as any).latency_ms; s.n++; }
      byStatus.set((e as any).status, s);
      if ((e as any).error_class) {
        byErr.set((e as any).error_class, (byErr.get((e as any).error_class) ?? 0) + 1);
      }
    }
    setEventStats(
      Array.from(byStatus.entries()).map(([status, v]) => ({
        status, count: v.count, avg_latency: v.n ? Math.round(v.lat / v.n) : null,
      }))
    );
    setErrors(Array.from(byErr.entries()).map(([error_class, count]) => ({ error_class, count })));
    setMetrics((m as any) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/admin/dashboard">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="text-2xl font-semibold">Observability</h1>
        <Button variant="outline" size="sm" className="ml-auto" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Event throughput (24h)</div>
          <div className="space-y-2">
            {eventStats.length === 0 && <div className="text-sm text-muted-foreground">No events yet.</div>}
            {eventStats.map((s) => (
              <div key={s.status} className="flex justify-between text-sm border-b border-border pb-1">
                <span>{s.status}</span>
                <span className="text-muted-foreground">
                  {s.count} · {s.avg_latency != null ? `${s.avg_latency}ms avg` : "—"}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Error classes (24h)</div>
          <div className="space-y-2">
            {errors.length === 0 && <div className="text-sm text-muted-foreground">No errors recorded.</div>}
            {errors.map((e) => (
              <div key={e.error_class} className="flex justify-between text-sm border-b border-border pb-1">
                <span className="font-mono text-xs">{e.error_class}</span>
                <span className="text-muted-foreground">{e.count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="text-sm font-medium mb-3">Recent system_metrics</div>
        <div className="space-y-1 max-h-96 overflow-auto">
          {metrics.length === 0 && <div className="text-sm text-muted-foreground">No metrics recorded.</div>}
          {metrics.map((m, i) => (
            <div key={i} className="flex justify-between text-xs font-mono border-b border-border pb-1">
              <span>{m.metric}</span>
              <span>{m.value}</span>
              <span className="text-muted-foreground">{new Date(m.recorded_at).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
