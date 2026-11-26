import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, ScrollText, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SecurityEvent {
  id: string;
  event_type: string;
  severity: string;
  company_id: string | null;
  user_id: string | null;
  source: string;
  message: string;
  details: Record<string, unknown> | null;
  created_at: string | null;
}

export default function AuditLog() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"admin" | "all">("admin");
  const [severity, setSeverity] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("security_events")
        .select("id, event_type, severity, company_id, user_id, source, message, details, created_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (tab === "admin") {
        query = query.eq("source", "admin_ui");
      }

      const [{ data: evData }, { data: compData }] = await Promise.all([
        query,
        supabase.from("companies").select("id, name").order("name"),
      ]);

      const map: Record<string, string> = {};
      for (const c of compData || []) {
        map[c.id] = c.name;
      }
      setCompanies(map);
      setEvents((evData || []) as SecurityEvent[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const filtered = useMemo(() => {
    return events.filter((ev) => {
      if (severity !== "all" && ev.severity !== severity) return false;
      if (companyFilter !== "all" && ev.company_id !== companyFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const cname = (ev.company_id && companies[ev.company_id]) || "";
        return (
          ev.event_type.toLowerCase().includes(q) ||
          ev.message.toLowerCase().includes(q) ||
          ev.source.toLowerCase().includes(q) ||
          cname.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [events, severity, companyFilter, search, companies]);

  const sevVariant = (s: string) => {
    if (s === "critical" || s === "error") return "destructive";
    if (s === "warning") return "secondary";
    return "outline";
  };

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ScrollText className="h-6 w-6 text-primary" />
              Admin & Security Audit Log
            </h1>
            <p className="text-sm text-muted-foreground">
              Track control-plane changes (test mode, harness, credits, AI config, deletions) and security events
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant={tab === "admin" ? "default" : "outline"}
              onClick={() => setTab("admin")}
            >
              Admin Actions
            </Button>
            <Button
              size="sm"
              variant={tab === "all" ? "default" : "outline"}
              onClick={() => setTab("all")}
            >
              All Security Events
            </Button>
          </div>

          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search event, message, company…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>

          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="w-36 h-9 text-xs">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>

          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="w-48 h-9 text-xs">
              <SelectValue placeholder="All companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {Object.entries(companies).map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-4 space-y-2">
            {loading ? (
              <div className="text-sm text-muted-foreground py-8 text-center">Loading audit events…</div>
            ) : filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">No audit events match your filters.</div>
            ) : (
              filtered.map((ev) => (
                <div key={ev.id} className="p-3 rounded-lg border border-border text-xs space-y-1.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={sevVariant(ev.severity)}>{ev.severity}</Badge>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {ev.event_type}
                      </Badge>
                      {ev.company_id && (
                        <span className="font-medium text-primary">
                          {companies[ev.company_id] || ev.company_id}
                        </span>
                      )}
                      <span className="text-muted-foreground">via {ev.source}</span>
                    </div>
                    <span className="text-muted-foreground">
                      {ev.created_at
                        ? `${formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })} (${new Date(ev.created_at).toLocaleString()})`
                        : "—"}
                    </span>
                  </div>
                  <div className="text-sm">{ev.message}</div>
                  {ev.details && Object.keys(ev.details).length > 0 && (
                    <details className="text-[11px]">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Details JSON
                      </summary>
                      <pre className="mt-1 p-2 rounded bg-muted overflow-x-auto font-mono">
                        {JSON.stringify(ev.details, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
