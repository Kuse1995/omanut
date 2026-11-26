import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { createRegressionTest } from "@/lib/regressionTests";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  FlaskConical,
  Loader2,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Violation = {
  id: string;
  conversation_id: string | null;
  channel: string;
  severity: "low" | "medium" | "high";
  rule_broken: string;
  explanation: string | null;
  offending_excerpt: string | null;
  assistant_content: string | null;
  reviewed: boolean;
  created_at: string;
};

interface RuleViolationsPanelProps {
  companyId: string;
  mode?: "admin" | "client";
  onNavigateTab?: (tab: string) => void;
}

export function RuleViolationsPanel({
  companyId,
  mode = "admin",
}: RuleViolationsPanelProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<Violation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "all">("open");

  const [promoteTarget, setPromoteTarget] = useState<Violation | null>(null);
  const [testName, setTestName] = useState("");
  const [testPrompt, setTestPrompt] = useState("");
  const [testMustNot, setTestMustNot] = useState("");
  const [savingTest, setSavingTest] = useState(false);

  const load = async () => {
    if (!companyId) return;
    setLoading(true);
    let q = supabase
      .from("rule_violations")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (filter === "open") q = q.eq("reviewed", false);
    const { data, error } = await q;
    if (error) toast.error(`Failed to load violations: ${error.message}`);
    setItems((data as Violation[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, filter]);

  const markReviewed = async (id: string) => {
    const { error } = await supabase
      .from("rule_violations")
      .update({ reviewed: true })
      .eq("id", id);
    if (error) return toast.error(`Update failed: ${error.message}`);
    setItems((prev) => (filter === "open" ? prev.filter((v) => v.id !== id) : prev.map((v) => (v.id === id ? { ...v, reviewed: true } : v))));
    toast.success("Marked reviewed");
  };

  const openPromoteDialog = async (v: Violation) => {
    setPromoteTarget(v);
    setTestName(`Rule: ${v.rule_broken}`.slice(0, 80));
    setTestMustNot(v.offending_excerpt || "");
    setTestPrompt("");

    if (v.conversation_id) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("role, content, created_at")
        .eq("conversation_id", v.conversation_id)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(1);
      if (msgs?.[0]?.content) {
        setTestPrompt(msgs[0].content);
      }
    }
  };

  const handleSaveTest = async () => {
    if (!promoteTarget || !testPrompt.trim()) {
      toast.error("Please enter the customer prompt to test");
      return;
    }
    setSavingTest(true);
    try {
      await createRegressionTest(companyId, {
        name: testName.trim() || `Rule: ${promoteTarget.rule_broken}`,
        prompt: testPrompt.trim(),
        expected_behavior: `Follow rule: ${promoteTarget.rule_broken}`,
        must_not_include: testMustNot
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        source_violation_id: promoteTarget.id,
      });
      setPromoteTarget(null);
      toast.success("Promoted to Regression Test Suite", {
        action:
          mode === "admin"
            ? {
                label: "Open Suite",
                onClick: () => navigate("/admin/dashboard?tab=ai-control&subtab=playground"),
              }
            : undefined,
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save regression test");
    } finally {
      setSavingTest(false);
    }
  };

  const handleFixInKB = () => {
    if (mode === "admin") {
      navigate("/admin/dashboard?tab=ai-control&subtab=training");
    } else {
      navigate("/settings");
    }
  };

  const handleInspectChat = (convId: string) => {
    if (mode === "admin") {
      navigate(`/admin/dashboard?tab=conversations&conv=${convId}`);
    } else {
      navigate("/conversations");
    }
  };

  const sevColor = (s: string) =>
    s === "high"
      ? "bg-red-500/15 text-red-600 border-red-500/30"
      : s === "medium"
      ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
      : "bg-muted text-muted-foreground";

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            Rule Violations
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Every AI reply is audited against your custom instructions and banned topics.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={filter === "open" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("open")}
          >
            Open
          </Button>
          <Button
            variant={filter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("all")}
          >
            All
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {loading && items.length === 0 && (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}

      {!loading && items.length === 0 && (
        <Card className="p-8 text-center space-y-2">
          <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500" />
          <div className="font-medium">No {filter === "open" ? "open " : ""}violations</div>
          <p className="text-sm text-muted-foreground">
            The AI is following your custom instructions.
          </p>
        </Card>
      )}

      <div className="space-y-3">
        {items.map((v) => (
          <Card key={v.id} className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={sevColor(v.severity)}>
                    {v.severity.toUpperCase()}
                  </Badge>
                  <Badge variant="outline">{v.channel}</Badge>
                  <span className="font-medium">{v.rule_broken}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {mode === "admin" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1"
                    onClick={() => openPromoteDialog(v)}
                  >
                    <FlaskConical className="h-3.5 w-3.5 text-primary" />
                    Promote to Test
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1"
                  onClick={handleFixInKB}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Fix in KB / Rules
                </Button>
                {v.conversation_id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs gap-1"
                    onClick={() => handleInspectChat(v.conversation_id!)}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Inspect Chat
                  </Button>
                )}
                {!v.reviewed && (
                  <Button size="sm" variant="secondary" className="h-8 text-xs" onClick={() => markReviewed(v.id)}>
                    Mark reviewed
                  </Button>
                )}
              </div>
            </div>

            {v.explanation && <p className="text-sm">{v.explanation}</p>}

            {v.offending_excerpt && (
              <div className="text-xs bg-red-500/5 border border-red-500/20 rounded p-2">
                <div className="font-medium mb-1 text-red-600">Offending excerpt</div>
                <div className="italic">"{v.offending_excerpt}"</div>
              </div>
            )}

            {v.assistant_content && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Full AI reply
                </summary>
                <div className="mt-2 p-2 rounded bg-muted whitespace-pre-wrap">{v.assistant_content}</div>
              </details>
            )}
          </Card>
        ))}
      </div>

      <Dialog open={!!promoteTarget} onOpenChange={(o) => !o && setPromoteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote Violation to Regression Test</DialogTitle>
            <DialogDescription>
              Turn this production rule violation into a repeatable test case in AI Playground.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Test Name</Label>
              <Input value={testName} onChange={(e) => setTestName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Customer Prompt</Label>
              <Textarea
                rows={3}
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                placeholder="Customer message that triggered this violation..."
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Must NOT Include (comma-separated)</Label>
              <Input
                value={testMustNot}
                onChange={(e) => setTestMustNot(e.target.value)}
                placeholder="forbidden phrase, wrong price"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoteTarget(null)} disabled={savingTest}>
              Cancel
            </Button>
            <Button onClick={handleSaveTest} disabled={savingTest}>
              {savingTest ? "Saving…" : "Save Test Case"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
