import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Database, RefreshCw, CheckCircle, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const BMS_SYNC_START = "<!-- BMS_SYNC_START -->";
const BMS_SYNC_END = "<!-- BMS_SYNC_END -->";

interface BmsSyncPanelProps {
  companyId: string;
  quickReferenceInfo: string;
  onApply: (newText: string) => void;
}

export const BmsSyncPanel = ({ companyId, quickReferenceInfo, onApply }: BmsSyncPanelProps) => {
  const [hasBms, setHasBms] = useState(false);
  const [checking, setChecking] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [counts, setCounts] = useState<{ products: number; stock_alerts: number; has_sales: boolean } | null>(null);
  const [rawErrors, setRawErrors] = useState<Record<string, string | null>>({});

  useEffect(() => {
    checkBmsConnection();
  }, [companyId]);

  const checkBmsConnection = async () => {
    setChecking(true);
    try {
      const { data } = await supabase
        .from("bms_connections")
        .select("id")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .maybeSingle();
      setHasBms(!!data);
    } catch {
      setHasBms(false);
    } finally {
      setChecking(false);
    }
  };

  const startSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("bms-training-sync", {
        body: { company_id: companyId },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Sync failed");

      setPreviewText(data.formatted_text || "No data returned from BMS");
      setCounts(data.counts);
      setRawErrors(data.raw_errors || {});
      setDialogOpen(true);
    } catch (err: any) {
      console.error("BMS sync error:", err);
      toast.error(err.message || "Failed to sync from BMS");
    } finally {
      setSyncing(false);
    }
  };

  const applyToKnowledgeBase = () => {
    const wrappedText = `${BMS_SYNC_START}\n${previewText}\n${BMS_SYNC_END}`;

    let newKb: string;
    const startIdx = quickReferenceInfo.indexOf(BMS_SYNC_START);
    const endIdx = quickReferenceInfo.indexOf(BMS_SYNC_END);

    if (startIdx !== -1 && endIdx !== -1) {
      // Replace existing BMS section
      newKb =
        quickReferenceInfo.slice(0, startIdx) +
        wrappedText +
        quickReferenceInfo.slice(endIdx + BMS_SYNC_END.length);
    } else {
      // Append
      newKb = quickReferenceInfo
        ? `${quickReferenceInfo}\n\n${wrappedText}`
        : wrappedText;
    }

    onApply(newKb);
    setDialogOpen(false);
    toast.success("BMS data applied to Knowledge Base — don't forget to save!");
  };

  if (checking || !hasBms) return null;

  const errorCount = Object.values(rawErrors).filter(Boolean).length;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                BMS Data Sync
              </CardTitle>
              <CardDescription>
                Pull products, stock levels, and sales data from your connected business management system to train the AI.
              </CardDescription>
            </div>
            <Button onClick={startSync} disabled={syncing} size="sm">
              {syncing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {syncing ? "Syncing..." : "Sync from BMS"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>BMS Data Preview</DialogTitle>
            <DialogDescription>
              Review the data pulled from your BMS. Edit if needed, then apply to your Knowledge Base.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2 my-2">
            {counts && (
              <>
                <Badge variant="secondary">
                  {counts.products} products
                </Badge>
                <Badge variant="secondary">
                  {counts.stock_alerts} stock alerts
                </Badge>
                {counts.has_sales && (
                  <Badge variant="secondary">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Sales data
                  </Badge>
                )}
              </>
            )}
            {errorCount > 0 && (
              <Badge variant="destructive">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {errorCount} source{errorCount > 1 ? "s" : ""} failed
              </Badge>
            )}
          </div>

          {errorCount > 0 && (
            <div className="text-xs text-muted-foreground space-y-1">
              {Object.entries(rawErrors).map(([key, err]) =>
                err ? (
                  <p key={key}>
                    <span className="font-medium">{key}:</span> {err}
                  </p>
                ) : null
              )}
            </div>
          )}

          <Textarea
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            className="flex-1 min-h-[300px] font-mono text-sm"
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyToKnowledgeBase} disabled={!previewText.trim()}>
              Apply to Knowledge Base
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
