import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCompany } from "@/context/CompanyContext";
import { logAdminAction } from "@/lib/adminAudit";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertTriangle,
  Clapperboard,
  Coins,
  CreditCard,
  ImageIcon,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

type CreditUsageRow = Database["public"]["Tables"]["credit_usage"]["Row"];

export const BillingPanel = () => {
  const { selectedCompany, refreshCompanies } = useCompany();
  const [creditUsage, setCreditUsage] = useState<CreditUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creditsToAdd, setCreditsToAdd] = useState("");
  const [addingCredits, setAddingCredits] = useState(false);
  const [retryingMedia, setRetryingMedia] = useState(false);

  // 30-day unit economics
  const [consumed30d, setConsumed30d] = useState(0);
  const [videoCounts, setVideoCounts] = useState({ completed: 0, pending: 0, failed: 0 });
  const [images30d, setImages30d] = useState(0);

  // Spending guardrails
  const [dailyAdBudgetLimit, setDailyAdBudgetLimit] = useState("50");
  const [saleApprovalThreshold, setSaleApprovalThreshold] = useState("500");
  const [requireAiConfigApproval, setRequireAiConfigApproval] = useState(true);
  const [requirePublishingApproval, setRequirePublishingApproval] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);

  const fetchBillingData = async (silent = false) => {
    if (!selectedCompany?.id) return;
    if (!silent) setLoading(true);

    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [usageRes, usage30dRes, videosRes, imagesRes, limitsRes] = await Promise.all([
      supabase
        .from("credit_usage")
        .select("*")
        .eq("company_id", selectedCompany.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("credit_usage")
        .select("amount_used")
        .eq("company_id", selectedCompany.id)
        .gte("created_at", since30d)
        .limit(1000),
      supabase
        .from("video_generation_jobs")
        .select("status")
        .eq("company_id", selectedCompany.id)
        .gte("created_at", since30d)
        .limit(500),
      supabase
        .from("generated_images")
        .select("id", { count: "exact", head: true })
        .eq("company_id", selectedCompany.id)
        .gte("created_at", since30d),
      supabase
        .from("agent_spending_limits")
        .select("*")
        .eq("company_id", selectedCompany.id)
        .maybeSingle(),
    ]);

    setCreditUsage(usageRes.data || []);

    const spent = (usage30dRes.data || []).reduce((acc: number, row: { amount_used: number }) => {
      return acc + (row.amount_used > 0 ? Number(row.amount_used) : 0);
    }, 0);
    setConsumed30d(spent);

    const vids = { completed: 0, pending: 0, failed: 0 };
    for (const v of videosRes.data || []) {
      if (v.status === "completed") vids.completed += 1;
      else if (v.status === "pending") vids.pending += 1;
      else if (v.status === "failed") vids.failed += 1;
    }
    setVideoCounts(vids);
    setImages30d(imagesRes.count ?? 0);

    if (limitsRes.data) {
      setDailyAdBudgetLimit(String(limitsRes.data.daily_ad_budget_limit ?? 50));
      setSaleApprovalThreshold(String(limitsRes.data.sale_approval_threshold ?? 500));
      setRequireAiConfigApproval(limitsRes.data.require_approval_for_ai_config ?? true);
      setRequirePublishingApproval(limitsRes.data.require_approval_for_publishing ?? false);
    } else {
      setDailyAdBudgetLimit("50");
      setSaleApprovalThreshold("500");
      setRequireAiConfigApproval(true);
      setRequirePublishingApproval(false);
    }

    if (!silent) setLoading(false);
  };

  useEffect(() => {
    if (!selectedCompany?.id) return;

    fetchBillingData(false);

    const channel = supabase
      .channel(`credit-usage-${selectedCompany.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "credit_usage",
          filter: `company_id=eq.${selectedCompany.id}`,
        },
        () => fetchBillingData(true)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany?.id]);

  if (!selectedCompany) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a company to view billing & spend controls
      </div>
    );
  }

  const handleAddCredits = async () => {
    if (!creditsToAdd) return;

    const amount = parseInt(creditsToAdd, 10);
    if (isNaN(amount) || amount <= 0 || amount > 1_000_000) {
      toast.error("Please enter a valid amount (1 – 1,000,000)");
      return;
    }

    setAddingCredits(true);
    try {
      const { error } = await supabase.rpc("add_credits", {
        p_company_id: selectedCompany.id,
        p_amount: amount,
        p_reason: "Manual credit addition by admin",
      });

      if (error) {
        toast.error(`Failed to add credits: ${error.message}`);
      } else {
        await logAdminAction({
          eventType: "admin_credits_added",
          companyId: selectedCompany.id,
          message: `Added ${amount} credits to ${selectedCompany.name}`,
          details: { amount, previous_balance: selectedCompany.credit_balance },
        });
        toast.success(`Added ${amount} credits`);
        setCreditsToAdd("");
        await refreshCompanies();
        await fetchBillingData(true);
      }
    } finally {
      setAddingCredits(false);
    }
  };

  const handleSaveSpendingLimits = async () => {
    setSavingLimits(true);
    const payload = {
      company_id: selectedCompany.id,
      daily_ad_budget_limit: Number(dailyAdBudgetLimit) || 50,
      sale_approval_threshold: Number(saleApprovalThreshold) || 500,
      require_approval_for_ai_config: requireAiConfigApproval,
      require_approval_for_publishing: requirePublishingApproval,
    };

    try {
      const { data, error } = await supabase.functions.invoke("admin-ops", {
        body: { action: "update_spending_limits", ...payload },
      });
      if (error || data?.error) {
        // Fallback to direct Supabase upsert (works once admin RLS migration is applied)
        const { error: directErr } = await supabase
          .from("agent_spending_limits")
          .upsert({ ...payload, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
        if (directErr) throw directErr;
        await logAdminAction({
          eventType: "admin_spending_limits_updated",
          companyId: selectedCompany.id,
          message: `Updated spending & approval guardrails for ${selectedCompany.name}`,
          details: payload,
        });
      }
      toast.success("Spending guardrails saved");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save spending guardrails");
    } finally {
      setSavingLimits(false);
    }
  };

  const handleRetryFailedMedia = async () => {
    setRetryingMedia(true);
    try {
      const { data, error } = await supabase.functions.invoke("retry-failed-media");
      if (error) throw error;
      if (data) {
        toast.success(
          `Retry processing complete: ${data.success} succeeded, ${data.failed} failed, ${data.skipped} skipped`,
          { duration: 5000 }
        );
      }
    } catch (error) {
      console.error("Error retrying media:", error);
      toast.error("Failed to retry media deliveries");
    } finally {
      setRetryingMedia(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading billing & spend controls…
      </div>
    );
  }

  const balance = Number(selectedCompany.credit_balance ?? 0);
  const lowBalance = balance < 50;

  return (
    <ScrollArea className="h-full">
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* 30-Day Unit Economics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5 text-primary" />
                Credit Balance
              </span>
              {lowBalance && (
                <Badge variant="destructive" className="text-[10px] gap-1">
                  <AlertTriangle className="h-2.5 w-2.5" /> Low
                </Badge>
              )}
            </div>
            <div className={`text-2xl font-bold mt-1 ${lowBalance ? "text-destructive" : "text-primary"}`}>
              {balance}
            </div>
            <div className="text-[11px] text-muted-foreground">1 credit ≈ $0.10</div>
          </Card>

          <Card className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5 text-amber-500" />
              Credits Consumed (30d)
            </div>
            <div className="text-2xl font-bold mt-1">{consumed30d}</div>
            <div className="text-[11px] text-muted-foreground">Logged usage entries</div>
          </Card>

          <Card className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clapperboard className="h-3.5 w-3.5 text-purple-500" />
              Video Renders (30d)
            </div>
            <div className="text-2xl font-bold mt-1">
              {videoCounts.completed + videoCounts.pending + videoCounts.failed}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {videoCounts.completed} ok · {videoCounts.pending} pending · {videoCounts.failed} failed
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5 text-blue-500" />
              Generated Images (30d)
            </div>
            <div className="text-2xl font-bold mt-1">{images30d}</div>
            <div className="text-[11px] text-muted-foreground">Image Studio outputs</div>
          </Card>
        </div>

        {/* Add Credits */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="w-5 h-5 text-primary" />
              Top Up Credits
            </CardTitle>
            <CardDescription>Manually grant credits to {selectedCompany.name}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-end max-w-md">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="credits">Add Credits</Label>
                <Input
                  id="credits"
                  type="number"
                  placeholder="Enter amount (e.g. 500)"
                  min={1}
                  max={1000000}
                  value={creditsToAdd}
                  onChange={(e) => setCreditsToAdd(e.target.value)}
                />
              </div>
              <Button onClick={handleAddCredits} disabled={addingCredits || !creditsToAdd}>
                {addingCredits ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                Add Credits
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Spend & Approval Guardrails */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Spend & Approval Guardrails
            </CardTitle>
            <CardDescription>
              Per-tenant hard caps and human-in-the-loop approval gates (`agent_spending_limits`)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Daily Ad Budget Limit (currency units)</Label>
                <Input
                  type="number"
                  min={0}
                  value={dailyAdBudgetLimit}
                  onChange={(e) => setDailyAdBudgetLimit(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Sale Approval Threshold</Label>
                <Input
                  type="number"
                  min={0}
                  value={saleApprovalThreshold}
                  onChange={(e) => setSaleApprovalThreshold(e.target.value)}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <p className="text-sm font-medium">Approve AI Config Changes</p>
                  <p className="text-xs text-muted-foreground">Require approval before external agents alter AI config</p>
                </div>
                <Switch checked={requireAiConfigApproval} onCheckedChange={setRequireAiConfigApproval} />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <p className="text-sm font-medium">Approve Social Publishing</p>
                  <p className="text-xs text-muted-foreground">Hold agent-generated posts for boss/admin sign-off</p>
                </div>
                <Switch checked={requirePublishingApproval} onCheckedChange={setRequirePublishingApproval} />
              </div>
            </div>

            <Button onClick={handleSaveSpendingLimits} disabled={savingLimits} size="sm">
              {savingLimits ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Save Guardrails
            </Button>
          </CardContent>
        </Card>

        {/* Media Delivery Retries */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="w-5 h-5 text-primary" />
              Media Delivery Retries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Manually trigger retry attempts for failed media deliveries (exponential backoff up to 5 attempts).
            </p>
            <Button onClick={handleRetryFailedMedia} disabled={retryingMedia} variant="outline">
              {retryingMedia ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Processing Retries...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retry Failed Media Deliveries
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Credit Usage History */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credit Usage History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creditUsage.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      No credit usage history yet
                    </TableCell>
                  </TableRow>
                ) : (
                  creditUsage.map((usage) => (
                    <TableRow key={usage.id}>
                      <TableCell>{new Date(usage.created_at).toLocaleString()}</TableCell>
                      <TableCell
                        className={
                          usage.amount_used > 0 ? "text-destructive font-medium" : "text-emerald-500 font-medium"
                        }
                      >
                        {usage.amount_used > 0 ? "-" : "+"}
                        {Math.abs(usage.amount_used)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{usage.reason}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
};
