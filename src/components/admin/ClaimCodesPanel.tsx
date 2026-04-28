import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, KeyRound, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Row = { company_id: string; company_name: string; code: string; claimed_by: string | null; claimed_at: string | null };

export const ClaimCodesPanel = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.rpc("admin_list_claim_codes").then(({ data, error }) => {
      if (error) toast({ title: "Could not load codes", description: error.message, variant: "destructive" });
      else setRows((data as Row[]) ?? []);
    });
  }, [open, toast]);

  const copy = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Card className="card-glass p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Claim codes</h3>
          <span className="text-xs text-muted-foreground">— share with clients to let them sign up themselves</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show codes"}
        </Button>
      </div>

      {open && (
        <div className="mt-4 space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No companies yet.</p>}
          {rows.map((r) => (
            <div key={r.company_id} className="flex items-center justify-between gap-3 p-2 rounded-md bg-muted/30">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{r.company_name}</div>
                <div className="font-mono text-xs text-muted-foreground">{r.code}</div>
              </div>
              <div className="flex items-center gap-2">
                {r.claimed_at ? (
                  <span className="text-xs text-emerald-500">Claimed</span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => copy(r.code)}>
                    {copied === r.code ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
