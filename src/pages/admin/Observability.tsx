import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useCompany } from "@/context/CompanyContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  SkipForward,
  XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface EventStats {
  status: string;
  count: number;
  avg_latency: number | null;
}

interface MetricRow {
  id?: string;
  metric: string;
  value: number;
  recorded_at: string;
  company_id: string | null;
  company_name?: string | null;
}

interface Heartbeat {
  id: string;
  label: string;
  last_at: string | null;
  last_status: string | null;
  expected_minutes: number;
}

interface ChannelAlert {
  company_id: string;
  company_name: string;
  platform: string;
  account_label: string;
  issue: string;
  expires_at?: string | null;
}

interface HarnessHealth {
  configured: boolean;
  url_host: string | null;
  ok: boolean;
  status: number | null;
  latency_ms: number | null;
  payload: unknown;
}

interface DlqEvent {
  id: string;
  company_id: string;
  company_name?: string;
  conversation_id: string | null;
  channel: string;
  source: string;
  status: string;
  attempts: number;
  error_class: string | null;
  last_error: string | null;
  payload: unknown;
  created_at: string;
  updated_at: string;
}

export default function Observability() {
  const navigate = useNavigate();
  const { switchCompany } = useCompany();

  const [loading, setLoading] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState(false);

  const [harness, setHarness] = useState<HarnessHealth | null>(null);
  const [envReadiness, setEnvReadiness] = useState<Record<string, boolean>>({});
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([]);
  const [channelAlerts, setChannelAlerts] = useState<ChannelAlert[]>([]);
  const [eventStats, setEventStats] = useState<EventStats[]>([]);
  const [errors, setErrors] = useState<Array<{ error_class: string; count: number }>>([]);
  const [dlqEvents, setDlqEvents] = useState<DlqEvent[]>([]);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [metricFilter, setMetricFilter] = useState("");

  const [runningTrigger, setRunningTrigger] = useState<string | null>(null);
  const [triggerOutput, setTriggerOutput] = useState<{ fn: string; data: unknown } | null>(null);
  const [actingEventId, setActingEventId] = useState<string | null>(null);

  async function loadFallback() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ data: events }, { data: m }, { data: dlq }, { data: comps }] = await Promise.all([
      supabase.from("inbound_events").select("status, latency_ms, error_class").gte("created_at", since).limit(2000),
      supabase.from("system_metrics").select("metric, value, recorded_at, company_id").gte("recorded_at", since).order("recorded_at", { ascending: false }).limit(200),
      supabase
        .from("inbound_events")
        .select("id, company_id, conversation_id, channel, source, status, attempts, error_class, last_error, payload, created_at, updated_at")
        .in("status", ["failed", "dead", "processing"])
        .order("updated_at", { ascending: false })
        .limit(50),
      supabase.from("companies").select("id, name"),
    ]);

    const cmap: Record<string, string> = {};
    for (const c of comps || []) cmap[c.id] = c.name;

    const byStatus = new Map<string, { count: number; lat: number; n: number }>();
    const byErr = new Map<string, number>();
    for (const e of events ?? []) {
      const s = byStatus.get(e.status) ?? { count: 0, lat: 0, n: 0 };
      s.count++;
      if (e.latency_ms) {
        s.lat += e.latency_ms;
        s.n++;
      }
      byStatus.set(e.status, s);
      if (e.error_class) {
        byErr.set(e.error_class, (byErr.get(e.error_class) ?? 0) + 1);
      }
    }

    setEventStats(
      Array.from(byStatus.entries()).map(([status, v]) => ({
        status,
        count: v.count,
        avg_latency: v.n ? Math.round(v.lat / v.n) : null,
      }))
    );
    setErrors(Array.from(byErr.entries()).map(([error_class, count]) => ({ error_class, count })));
    setDlqEvents((dlq || []).map((ev) => ({ ...ev, company_name: cmap[ev.company_id] || ev.company_id })));
    setMetrics((m || []).map((r) => ({ ...r, company_name: r.company_id ? cmap[r.company_id] : null })));
  }

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-ops", {
        body: { action: "probes" },
      });
      if (!error && data && !data.error) {
        setFallbackNotice(false);
        setHarness(data.harness || null);
        setEnvReadiness(data.env_readiness || {});
        setHeartbeats(data.heartbeats || []);
        setChannelAlerts(data.channel_alerts || []);
        setEventStats(data.event_stats || []);
        setErrors(data.error_classes || []);
        setDlqEvents(data.dlq_events || []);
        setMetrics(data.metrics || []);
      } else {
        setFallbackNotice(true);
        await loadFallback();
      }
    } catch {
      setFallbackNotice(true);
      await loadFallback();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runProbeFn = async (fnName: "bms-health-check" | "poll-video-generation" | "meta-auto-reply") => {
    setRunningTrigger(fnName);
    try {
      const { data, error } = await supabase.functions.invoke(fnName, { body: {} });
      if (error) throw error;
      setTriggerOutput({ fn: fnName, data });
      toast.success(`${fnName} executed`);
      load();
    } catch (err: unknown) {
      toast.error(`${fnName} failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setRunningTrigger(null);
    }
  };

  const handleQueueAction = async (eventId: string, action: "replay_event" | "dismiss_event") => {
    setActingEventId(eventId);
    try {
      const { data, error } = await supabase.functions.invoke("admin-ops", {
        body: { action, event_id: eventId },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success(action === "replay_event" ? "Event queued for replay" : "Event dismissed");
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Deploy admin-ops to use queue replay");
    } finally {
      setActingEventId(null);
    }
  };

  const openTenantChannels = async (companyId: string) => {
    if (!companyId) return;
    await switchCompany(companyId);
    navigate(`/admin/dashboard?company=${companyId}&tab=meta-integrations`);
  };

  const filteredMetrics = metrics.filter(
    (m) =>
      !metricFilter.trim() ||
      m.metric.toLowerCase().includes(metricFilter.toLowerCase()) ||
      (m.company_name || "").toLowerCase().includes(metricFilter.toLowerCase())
  );

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              Operations & Observability
            </h1>
            <p className="text-sm text-muted-foreground">
              Live farm harness probes, cron heartbeats, expiring tokens, and inbound queue replay
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {fallbackNotice && (
          <div className="text-xs rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-600 dark:text-amber-400">
            Deploy the <code>admin-ops</code> edge function in Lovable to enable live Harness probing, env readiness checks, and DLQ replay.
          </div>
        )}

        {/* Live Probes + Manual Triggers */}
        <div className="grid lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-primary" />
                  External Harness (/health)
                </span>
                {harness && (
                  <Badge variant={harness.ok ? "default" : "destructive"}>
                    {!harness.configured ? "Not set" : harness.ok ? `OK · ${harness.latency_ms}ms` : "Unreachable"}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {!harness ? (
                <p className="text-muted-foreground">Probe pending or requires admin-ops deploy.</p>
              ) : (
                <>
                  <div className="font-mono text-muted-foreground">{harness.url_host || "—"}</div>
                  {harness.payload && (
                    <pre className="p-2 rounded bg-muted overflow-x-auto max-h-28 text-[11px] font-mono">
                      {JSON.stringify(harness.payload, null, 2)}
                    </pre>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Edge Secret Readiness</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(envReadiness).length === 0 ? (
                <p className="text-xs text-muted-foreground">Requires admin-ops deploy.</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  {Object.entries(envReadiness).map(([k, ok]) => (
                    <div key={k} className="flex items-center gap-1.5 truncate">
                      {ok ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                      ) : (
                        <XCircle className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                      )}
                      <span className={`font-mono truncate ${ok ? "text-foreground" : "text-muted-foreground"}`}>
                        {k}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Manual Pipeline Triggers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["bms-health-check", "Run BMS Health Check"],
                    ["poll-video-generation", "Poll Video Jobs"],
                    ["meta-auto-reply", "Run Meta Auto-Reply"],
                  ] as const
                ).map(([fn, label]) => (
                  <Button
                    key={fn}
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1.5"
                    disabled={runningTrigger !== null}
                    onClick={() => runProbeFn(fn)}
                  >
                    {runningTrigger === fn ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3 text-primary" />
                    )}
                    {label}
                  </Button>
                ))}
              </div>
              {triggerOutput && (
                <pre className="p-2 rounded bg-muted text-[11px] font-mono overflow-x-auto max-h-28">
                  {triggerOutput.fn}: {JSON.stringify(triggerOutput.data, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Heartbeats */}
        {heartbeats.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pipeline & Cron Heartbeats</CardTitle>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {heartbeats.map((hb) => {
                const ageMin = hb.last_at
                  ? Math.round((Date.now() - new Date(hb.last_at).getTime()) / 60_000)
                  : null;
                const stale = ageMin === null || ageMin > hb.expected_minutes;
                return (
                  <div key={hb.id} className="p-3 rounded-lg border border-border space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate">{hb.label}</span>
                      <Badge variant={hb.last_at ? (stale ? "secondary" : "default") : "outline"} className="text-[10px]">
                        {!hb.last_at ? "No data" : stale ? "Idle/Stale" : "Active"}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {hb.last_at
                        ? formatDistanceToNow(new Date(hb.last_at), { addSuffix: true })
                        : "Never observed"}
                    </div>
                    {hb.last_status && (
                      <div className="text-[10px] font-mono text-muted-foreground">
                        last: {hb.last_status}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Channel & Token Expiry Alerts */}
        {channelAlerts.length > 0 && (
          <Card className="border-amber-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-amber-500">
                <AlertTriangle className="h-4 w-4" />
                Channel Health & Expiring Tokens ({channelAlerts.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {channelAlerts.map((a, idx) => (
                <div key={idx} className="flex items-center justify-between gap-3 p-2.5 rounded border border-border text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="uppercase text-[10px]">{a.platform}</Badge>
                    <span className="font-medium">{a.company_name}</span>
                    <span className="text-muted-foreground">({a.account_label})</span>
                    <Badge variant="destructive" className="text-[10px]">{a.issue}</Badge>
                  </div>
                  {a.company_id && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openTenantChannels(a.company_id)}>
                      Open Channels
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Throughput & Error Classes */}
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

        {/* DLQ & Queue Replay */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Dead-Letter & Stuck Queue Events ({dlqEvents.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dlqEvents.length === 0 ? (
              <div className="text-sm text-muted-foreground">No failed, dead, or stuck events.</div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-auto">
                {dlqEvents.map((ev) => (
                  <div key={ev.id} className="p-3 rounded-lg border border-border text-xs space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={ev.status === "processing" ? "secondary" : "destructive"}>
                          {ev.status}
                        </Badge>
                        <span className="font-medium">{ev.company_name}</span>
                        <span className="font-mono text-muted-foreground">{ev.channel}/{ev.source}</span>
                        {ev.error_class && <Badge variant="outline">{ev.error_class}</Badge>}
                        <span className="text-muted-foreground">attempts: {ev.attempts}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          disabled={actingEventId === ev.id}
                          onClick={() => handleQueueAction(ev.id, "replay_event")}
                        >
                          <RotateCcw className="h-3 w-3" />
                          Replay
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs gap-1 text-muted-foreground"
                          disabled={actingEventId === ev.id}
                          onClick={() => handleQueueAction(ev.id, "dismiss_event")}
                        >
                          <SkipForward className="h-3 w-3" />
                          Dismiss
                        </Button>
                      </div>
                    </div>
                    {ev.last_error && (
                      <div className="text-destructive bg-destructive/10 rounded p-2 font-mono text-[11px] break-words">
                        {ev.last_error}
                      </div>
                    )}
                    <details className="text-[11px]">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Payload preview ({formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })})
                      </summary>
                      <pre className="mt-1 p-2 rounded bg-muted overflow-x-auto max-h-36 font-mono">
                        {JSON.stringify(ev.payload, null, 2)}
                      </pre>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* System Metrics */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm font-medium">Recent system_metrics ({filteredMetrics.length})</div>
            <Input
              placeholder="Filter metric or company…"
              value={metricFilter}
              onChange={(e) => setMetricFilter(e.target.value)}
              className="max-w-xs h-8 text-xs"
            />
          </div>
          <div className="space-y-1 max-h-80 overflow-auto">
            {filteredMetrics.length === 0 && <div className="text-sm text-muted-foreground">No metrics recorded.</div>}
            {filteredMetrics.map((m, i) => (
              <div key={m.id || i} className="grid grid-cols-4 gap-2 text-xs font-mono border-b border-border pb-1">
                <span className="truncate">{m.metric}</span>
                <span className="truncate text-muted-foreground">{m.company_name || "platform"}</span>
                <span>{m.value}</span>
                <span className="text-muted-foreground text-right">{new Date(m.recorded_at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AdminLayout>
  );
}
