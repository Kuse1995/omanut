import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { logAdminAction } from "@/lib/adminAudit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RefreshCw, Check, X, CheckSquare } from "lucide-react";
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
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Media[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [rejectTarget, setRejectTarget] = useState<Media | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("company_media")
      .select(
        "id, company_id, file_name, file_path, description, asset_validation_status, validation_reason, thumbnail_url, created_at"
      )
      .eq("asset_validation_status", tab)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) toast.error(error.message);
    const list = (data as Media[] | null) ?? [];
    setRows(list);
    const ids = Array.from(new Set(list.map((r) => r.company_id)));
    if (ids.length) {
      const { data: cs } = await supabase.from("companies").select("id, name").in("id", ids);
      const map: Record<string, string> = {};
      for (const c of cs ?? []) map[c.id] = c.name;
      setCompanies(map);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function decide(item: Media, status: "approved" | "rejected", reason?: string) {
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("company_media")
        .update({ asset_validation_status: status, validation_reason: reason?.trim() || null })
        .eq("id", item.id);
      if (error) return toast.error(error.message);

      // Recompute image_gen_unlocked for the company
      const { count } = await supabase
        .from("company_media")
        .select("id", { count: "exact", head: true })
        .eq("company_id", item.company_id)
        .eq("asset_validation_status", "approved");
      await supabase
        .from("companies")
        .update({ image_gen_unlocked: (count ?? 0) >= 3 })
        .eq("id", item.company_id);

      await logAdminAction({
        eventType: status === "approved" ? "admin_media_approved" : "admin_media_rejected",
        companyId: item.company_id,
        message: `${status === "approved" ? "Approved" : "Rejected"} media "${item.file_name || item.id}"`,
        details: { media_id: item.id, reason: reason?.trim() || null },
      });

      queryClient.invalidateQueries({ queryKey: ["admin-pending-media-count"] });
      toast.success(status === "approved" ? "Approved" : "Rejected");
      setRejectTarget(null);
      setRejectReason("");
      load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CheckSquare className="h-6 w-6 text-primary" />
              Media Approvals
            </h1>
            <p className="text-sm text-muted-foreground">
              Review tenant brand assets (3+ approved unlocks automated image generation)
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        <div className="flex gap-2">
          {(["pending", "approved", "rejected"] as const).map((t) => (
            <Button key={t} variant={tab === t ? "default" : "outline"} size="sm" onClick={() => setTab(t)} className="capitalize">
              {t}
            </Button>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.length === 0 && (
            <div className="text-sm text-muted-foreground col-span-full py-12 text-center">
              No {tab} items.
            </div>
          )}
          {rows.map((m) => (
            <Card key={m.id} className="p-3 space-y-2">
              {m.thumbnail_url && (
                <img src={m.thumbnail_url} alt={m.file_name ?? ""} className="w-full h-40 object-cover rounded-md" />
              )}
              <div className="text-xs font-medium text-primary">{companies[m.company_id] ?? m.company_id}</div>
              <div className="text-sm font-medium truncate">{m.file_name ?? "(no name)"}</div>
              {m.description && <div className="text-xs text-muted-foreground line-clamp-2">{m.description}</div>}
              <Badge variant="outline">{m.asset_validation_status}</Badge>
              {m.validation_reason && (
                <div className="text-xs text-muted-foreground italic">{m.validation_reason}</div>
              )}
              {tab === "pending" && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" disabled={submitting} onClick={() => decide(m, "approved")}>
                    <Check className="h-3 w-3 mr-1" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => {
                      setRejectTarget(m);
                      setRejectReason("");
                    }}
                  >
                    <X className="h-3 w-3 mr-1" /> Reject
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Media Asset</DialogTitle>
            <DialogDescription>
              Provide a short reason so the tenant knows what to upload instead.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="e.g., Image is blurry, watermarked, or missing product label"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={submitting}
              onClick={() => rejectTarget && decide(rejectTarget, "rejected", rejectReason)}
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
