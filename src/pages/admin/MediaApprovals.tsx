import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, RefreshCw, Check, X } from "lucide-react";
import { toast } from "sonner";

interface Media {
  id: string;
  company_id: string;
  file_name: string | null;
  file_path: string | null;
  description: string | null;
  asset_validation_status: "pending" | "approved" | "rejected";
  validation_reason: string | null;
  thumbnail_url: string | null;
  created_at: string;
}

export default function MediaApprovals() {
  const [rows, setRows] = useState<Media[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("company_media")
      .select("id, company_id, file_name, file_path, description, asset_validation_status, validation_reason, thumbnail_url, created_at")
      .eq("asset_validation_status", tab)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) toast.error(error.message);
    const list = (data as any[]) ?? [];
    setRows(list as Media[]);
    const ids = Array.from(new Set(list.map((r) => r.company_id)));
    if (ids.length) {
      const { data: cs } = await supabase.from("companies").select("id, name").in("id", ids);
      const map: Record<string, string> = {};
      for (const c of cs ?? []) map[(c as any).id] = (c as any).name;
      setCompanies(map);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [tab]);

  async function decide(id: string, status: "approved" | "rejected", reason?: string) {
    const { error } = await supabase
      .from("company_media")
      .update({ asset_validation_status: status, validation_reason: reason ?? null })
      .eq("id", id);
    if (error) return toast.error(error.message);

    // Recompute image_gen_unlocked for the company
    const row = rows.find((r) => r.id === id);
    if (row) {
      const { count } = await supabase
        .from("company_media")
        .select("id", { count: "exact", head: true })
        .eq("company_id", row.company_id)
        .eq("asset_validation_status", "approved");
      await supabase
        .from("companies")
        .update({ image_gen_unlocked: (count ?? 0) >= 3 })
        .eq("id", row.company_id);
    }
    toast.success(status === "approved" ? "Approved" : "Rejected");
    load();
  }

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/admin/dashboard">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="text-2xl font-semibold">Media Approvals</h1>
        <Button variant="outline" size="sm" className="ml-auto" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="flex gap-2">
        {(["pending","approved","rejected"] as const).map((t) => (
          <Button key={t} variant={tab === t ? "default" : "outline"} size="sm" onClick={() => setTab(t)}>
            {t}
          </Button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.length === 0 && (
          <div className="text-sm text-muted-foreground col-span-full">No items.</div>
        )}
        {rows.map((m) => (
          <Card key={m.id} className="p-3 space-y-2">
            {m.thumbnail_url && (
              <img src={m.thumbnail_url} alt={m.file_name ?? ""} className="w-full h-40 object-cover rounded-md" />
            )}
            <div className="text-xs text-muted-foreground">{companies[m.company_id] ?? m.company_id}</div>
            <div className="text-sm font-medium truncate">{m.file_name ?? "(no name)"}</div>
            {m.description && <div className="text-xs text-muted-foreground line-clamp-2">{m.description}</div>}
            <Badge variant="outline">{m.asset_validation_status}</Badge>
            {m.validation_reason && (
              <div className="text-xs text-muted-foreground italic">{m.validation_reason}</div>
            )}
            {tab === "pending" && (
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={() => decide(m.id, "approved")}>
                  <Check className="h-3 w-3 mr-1" /> Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => {
                  const r = window.prompt("Reason for rejection?") ?? "";
                  decide(m.id, "rejected", r);
                }}>
                  <X className="h-3 w-3 mr-1" /> Reject
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
