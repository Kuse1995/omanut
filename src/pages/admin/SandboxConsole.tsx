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

export default function SandboxConsole() {
  const [rows, setRows] = useState<Row[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [companyFilter, setCompanyFilter] = useState<string>("all");

  async function load() {
    setLoading(true);
    const [{ data: logs, error }, { data: cs }] = await Promise.all([
      supabase
        .from("test_outbound_log")
        .select("id, company_id, channel, recipient, payload, reason, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("companies").select("id, name, is_live").order("name"),
    ]);
    if (error) toast.error(error.message);
    setRows((logs as any) ?? []);
    setCompanies((cs as any) ?? []);
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
