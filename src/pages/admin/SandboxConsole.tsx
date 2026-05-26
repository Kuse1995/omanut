import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Row {
  id: string;
  company_id: string;
  channel: string;
  recipient: string | null;
  payload: any;
  reason: string;
  created_at: string;
}

interface Company { id: string; name: string; is_live: boolean }

interface InboundEvent {
  id: string;
  company_id: string;
  channel: string;
  source: string;
  status: string;
  claimed_by: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

interface PullLog {
  id: string;
  called_at: string;
  endpoint: string;
  company_id: string | null;
  events_returned: number;
  wait_seconds: number | null;
  status_code: number;
  user_agent: string | null;
  remote_ip: string | null;
}

export default function SandboxConsole() {
  const [rows, setRows] = useState<Row[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [events, setEvents] = useState<InboundEvent[]>([]);
  const [pulls, setPulls] = useState<PullLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [companyFilter, setCompanyFilter] = useState<string>("all");

  async function load() {
    setLoading(true);
    const [{ data: logs, error }, { data: cs }, { data: ev }, { data: pl }] = await Promise.all([
      supabase
        .from("test_outbound_log")
        .select("id, company_id, channel, recipient, payload, reason, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("companies").select("id, name, is_live").order("name"),
      supabase
        .from("inbound_events")
        .select("id, company_id, channel, source, status, claimed_by, claimed_at, completed_at, attempts, last_error, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("openclaw_pull_log" as any)
        .select("id, called_at, endpoint, company_id, events_returned, wait_seconds, status_code, user_agent, remote_ip")
        .order("called_at", { ascending: false })
        .limit(50),
    ]);
    if (error) toast.error(error.message);
    setRows((logs as any) ?? []);
    setCompanies((cs as any) ?? []);
    setEvents((ev as any) ?? []);
    setPulls((pl as any) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  async function flipLive(id: string, current: boolean) {
    const { error } = await supabase
      .from("companies")
      .update({ is_live: !current })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(!current ? "Company is now LIVE" : "Company moved back to sandbox");
    load();
  }

  const filtered = companyFilter === "all" ? rows : rows.filter((r) => r.company_id === companyFilter);

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/admin/dashboard">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="text-2xl font-semibold">Sandbox Console</h1>
        <Button variant="outline" size="sm" className="ml-auto" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <Card className="p-4">
        <div className="text-sm font-medium mb-3">Live status per company</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {companies.map((c) => (
            <div key={c.id} className="flex items-center justify-between border border-border rounded-md p-2">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant={c.is_live ? "default" : "secondary"}>
                  {c.is_live ? "LIVE" : "sandbox"}
                </Badge>
                <span className="truncate text-sm">{c.name}</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => flipLive(c.id, c.is_live)}>
                {c.is_live ? "Move to sandbox" : "Go live"}
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-medium mb-3 flex items-center gap-2 flex-wrap">
          OpenClaw pull activity
          {pulls.length > 0 ? (
            <Badge variant="default">
              last call {Math.floor((Date.now() - new Date(pulls[0].called_at).getTime()) / 1000)}s ago
            </Badge>
          ) : (
            <Badge variant="destructive">no calls yet — OpenClaw loop isn't hitting us</Badge>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            200 = good poll · 401 = wrong/missing OPENCLAW_GATEWAY_TOKEN
          </span>
        </div>
        <div className="space-y-1 max-h-72 overflow-auto">
          {pulls.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No pull requests recorded. Have OpenClaw's operator confirm their loop is hitting:
              <code className="block mt-1 p-2 bg-muted/30 rounded text-xs break-all">
                GET https://dzheddvoiauevcayifev.supabase.co/functions/v1/openclaw-pull?wait=25&max=10
                <br />Authorization: Bearer &lt;OPENCLAW_GATEWAY_TOKEN&gt;
              </code>
            </div>
          )}
          {pulls.map((p) => {
            const ageS = Math.floor((Date.now() - new Date(p.called_at).getTime()) / 1000);
            return (
              <div key={p.id} className="flex items-center gap-2 border border-border rounded-md p-2 text-xs flex-wrap">
                <Badge variant={p.status_code === 200 ? "default" : "destructive"}>
                  {p.status_code}
                </Badge>
                <span className={p.events_returned > 0 ? "text-primary font-medium" : "text-muted-foreground"}>
                  {p.events_returned} event{p.events_returned === 1 ? "" : "s"} returned
                </span>
                {p.wait_seconds != null && (
                  <span className="text-muted-foreground">wait={p.wait_seconds}s</span>
                )}
                {p.remote_ip && <span className="text-muted-foreground">ip={p.remote_ip}</span>}
                <span className="ml-auto text-muted-foreground">
                  {ageS < 60 ? `${ageS}s ago` : new Date(p.called_at).toLocaleTimeString()}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-medium mb-3">
          Inbound event queue (last 50)
          <span className="ml-2 text-xs text-muted-foreground">
            claimed_by tells you who answered — "openclaw" = OpenClaw picked it up, "in_house" / null = Omanut fallback
          </span>
        </div>
        <div className="space-y-1 max-h-96 overflow-auto">
          {events.length === 0 && (
            <div className="text-sm text-muted-foreground">No inbound events yet.</div>
          )}
          {events
            .filter((e) => companyFilter === "all" || e.company_id === companyFilter)
            .map((e) => {
              const company = companies.find((c) => c.id === e.company_id);
              const ageMs = Date.now() - new Date(e.created_at).getTime();
              const ageS = Math.floor(ageMs / 1000);
              return (
                <div key={e.id} className="flex items-center gap-2 border border-border rounded-md p-2 text-xs flex-wrap">
                  <Badge variant={e.status === "completed" ? "default" : e.status === "failed" ? "destructive" : "secondary"}>
                    {e.status}
                  </Badge>
                  <Badge variant="outline">{e.channel}</Badge>
                  <span className="text-muted-foreground">{company?.name ?? e.company_id.slice(0, 8)}</span>
                  <span className="text-muted-foreground">src={e.source}</span>
                  <span className={e.claimed_by === "openclaw" ? "text-primary font-medium" : "text-muted-foreground"}>
                    claimed_by={e.claimed_by ?? "—"}
                  </span>
                  {e.attempts > 0 && <span className="text-muted-foreground">attempts={e.attempts}</span>}
                  <span className="ml-auto text-muted-foreground">
                    {ageS < 60 ? `${ageS}s ago` : new Date(e.created_at).toLocaleTimeString()}
                  </span>
                  {e.last_error && (
                    <div className="w-full text-destructive truncate">err: {e.last_error}</div>
                  )}
                </div>
              );
            })}
        </div>
      </Card>

      <Card className="p-4">

        <div className="flex items-center gap-3 mb-3">
          <div className="text-sm font-medium">Shadow-logged outbound</div>
          <select
            className="ml-auto text-sm border border-border bg-background rounded-md px-2 py-1"
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
          >
            <option value="all">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          {filtered.length === 0 && (
            <div className="text-sm text-muted-foreground">Nothing intercepted yet.</div>
          )}
          {filtered.map((r) => {
            const company = companies.find((c) => c.id === r.company_id);
            return (
              <div key={r.id} className="border border-border rounded-md p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{r.channel}</Badge>
                  <span className="text-muted-foreground">{company?.name ?? r.company_id}</span>
                  <span className="text-muted-foreground">→ {r.recipient ?? "—"}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-xs bg-muted/30 p-2 rounded">
                  {JSON.stringify(r.payload, null, 2)}
                </pre>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
