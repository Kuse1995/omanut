import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { createRegressionTest } from "@/lib/regressionTests";
import { logAdminAction } from "@/lib/adminAudit";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Clock,
  Cpu,
  FlaskConical,
  Loader2,
  ShieldAlert,
  Sparkles,
  Wrench,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export interface FocusedMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
  message_metadata?: Record<string, unknown> | null;
}

interface TraceEvent {
  id: string;
  channel: string;
  source: string;
  status: string;
  model: string | null;
  tokens: number | null;
  latency_ms: number | null;
  error_class: string | null;
  last_error: string | null;
  attempts: number;
  created_at: string;
}

interface SwarmRun {
  id: string;
  channel: string;
  mode: string | null;
  profile: string | null;
  models_used: unknown;
  stage_timings: unknown;
  final_score: number | null;
  retries: number | null;
  escalated: boolean | null;
  bypass_reason: string | null;
  error: string | null;
  critique_history: unknown;
  created_at: string;
}

interface TraceViolation {
  id: string;
  severity: string;
  rule_broken: string;
  explanation: string | null;
  offending_excerpt: string | null;
  reviewed: boolean;
  created_at: string;
}

interface TraceErrorLog {
  id: string;
  severity: string;
  error_type: string;
  status: string;
  quality_score: number | null;
  original_message: string;
  ai_response: string;
  created_at: string;
}

interface RoutingLog {
  id: string;
  agent_type: string;
  routing_confidence: number | null;
  handoff_occurred: boolean | null;
  handoff_reason: string | null;
  notes: string | null;
  routed_at: string | null;
}

interface AITraceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  conversationId: string;
  focusedMessage?: FocusedMessage | null;
  priorUserMessage?: string | null;
  onPromoteToTest?: (prompt: string, aiReply: string) => void;
  onJumpToKB?: () => void;
}

export function AITraceDrawer({
  open,
  onOpenChange,
  companyId,
  conversationId,
  focusedMessage,
  priorUserMessage,
  onPromoteToTest,
  onJumpToKB,
}: AITraceDrawerProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [swarmRuns, setSwarmRuns] = useState<SwarmRun[]>([]);
  const [violations, setViolations] = useState<TraceViolation[]>([]);
  const [errorLogs, setErrorLogs] = useState<TraceErrorLog[]>([]);
  const [routingLogs, setRoutingLogs] = useState<RoutingLog[]>([]);
  const [submitting, setSubmitting] = useState<"error" | "test" | null>(null);

  const loadTrace = async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const [evRes, swRes, rvRes, erRes, apRes] = await Promise.all([
        supabase
          .from("inbound_events")
          .select("id, channel, source, status, model, tokens, latency_ms, error_class, last_error, attempts, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("swarm_runs")
          .select("id, channel, mode, profile, models_used, stage_timings, final_score, retries, escalated, bypass_reason, error, critique_history, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("rule_violations")
          .select("id, severity, rule_broken, explanation, offending_excerpt, reviewed, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("ai_error_logs")
          .select("id, severity, error_type, status, quality_score, original_message, ai_response, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("agent_performance")
          .select("id, agent_type, routing_confidence, handoff_occurred, handoff_reason, notes, routed_at")
          .eq("conversation_id", conversationId)
          .order("routed_at", { ascending: false })
          .limit(10),
      ]);

      setEvents(evRes.data || []);
      setSwarmRuns(swRes.data || []);
      setViolations(rvRes.data || []);
      setErrorLogs(erRes.data || []);
      setRoutingLogs(apRes.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && conversationId) {
      loadTrace();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversationId]);

  const handleFlagAsError = async () => {
    if (!focusedMessage && events.length === 0) return;
    setSubmitting("error");
    try {
      const original = priorUserMessage || "(see conversation thread)";
      const reply = focusedMessage?.content || events[0]?.last_error || "(no response text)";
      const { error } = await supabase.from("ai_error_logs").insert({
        company_id: companyId,
        conversation_id: conversationId,
        error_type: "wrong_response",
        severity: "medium",
        original_message: original,
        ai_response: reply,
        status: "open",
      });
      if (error) throw error;

      await logAdminAction({
        eventType: "admin_flagged_ai_error",
        companyId,
        message: `Flagged turn in conversation ${conversationId} as AI error`,
        details: { conversation_id: conversationId, message_id: focusedMessage?.id },
      });

      toast.success("Logged to AI Error Tracker");
      await loadTrace();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to log error");
    } finally {
      setSubmitting(null);
    }
  };

  const handlePromoteToTest = async () => {
    const prompt = priorUserMessage?.trim();
    const reply = focusedMessage?.content || "";
    if (!prompt) {
      toast.error("No preceding customer message found to test");
      return;
    }
    setSubmitting("test");
    try {
      await createRegressionTest(companyId, {
        name: `Turn regression: ${prompt.slice(0, 48)}`,
        prompt,
        expected_behavior: "Verify accurate, rule-compliant reply for this customer prompt",
      });

      toast.success("Added to AI Playground Regression Suite", {
        action: {
          label: "Open Suite",
          onClick: () => navigate("/admin/dashboard?tab=ai-control&subtab=playground"),
        },
      });
      onPromoteToTest?.(prompt, reply);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create regression test");
    } finally {
      setSubmitting(null);
    }
  };

  const handleOpenKB = () => {
    onOpenChange(false);
    if (onJumpToKB) {
      onJumpToKB();
    } else {
      navigate("/admin/dashboard?tab=ai-control&subtab=training");
    }
  };

  const meta = focusedMessage?.message_metadata || {};
  const toolsUsed = Array.isArray(meta.tools_called)
    ? meta.tools_called
    : Array.isArray(meta.tool_calls)
    ? meta.tool_calls
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI X-Ray & Pipeline Trace
          </SheetTitle>
          <SheetDescription>
            Inspect model routing, latency, Swarm critiques, and violations for this conversation.
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            Loading trace…
          </div>
        ) : (
          <div className="space-y-4 pb-8">
            {/* Focused Message Metadata */}
            {focusedMessage && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Bot className="h-4 w-4 text-primary" />
                    Selected Turn Metadata
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5 text-xs">
                  {priorUserMessage && (
                    <div className="p-2 rounded bg-muted/60">
                      <span className="font-medium text-muted-foreground">Customer asked: </span>
                      <span>{priorUserMessage}</span>
                    </div>
                  )}
                  <div className="p-2 rounded bg-primary/5 border border-primary/20">
                    <span className="font-medium text-primary">AI replied: </span>
                    <span className="whitespace-pre-wrap">{focusedMessage.content}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {meta.source && <Badge variant="outline">source: {String(meta.source)}</Badge>}
                    {meta.model && <Badge variant="secondary">model: {String(meta.model)}</Badge>}
                    {meta.sent_by && <Badge variant="outline">sent_by: {String(meta.sent_by)}</Badge>}
                    {meta.pipeline && <Badge variant="outline">pipeline: {String(meta.pipeline)}</Badge>}
                  </div>
                  {toolsUsed.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-muted-foreground font-medium">
                        <Wrench className="h-3 w-3" /> Tools called
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {toolsUsed.map((t: unknown, idx: number) => {
                          const toolObj = typeof t === "object" && t !== null ? (t as { name?: string; function?: { name?: string } }) : null;
                          const label = typeof t === "string" ? t : toolObj?.name || toolObj?.function?.name || JSON.stringify(t);
                          return (
                            <Badge key={idx} variant="secondary" className="font-mono text-[10px]">
                              {label}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Raw message_metadata JSON
                    </summary>
                    <pre className="mt-1.5 p-2 rounded bg-muted overflow-x-auto max-h-40 font-mono">
                      {JSON.stringify(meta, null, 2)}
                    </pre>
                  </details>
                </CardContent>
              </Card>
            )}

            {/* Inbound Events / Pipeline */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4 text-blue-500" />
                  Pipeline Events ({events.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {events.length === 0 ? (
                  <p className="text-muted-foreground">No inbound_events recorded for this conversation.</p>
                ) : (
                  events.slice(0, 6).map((ev) => (
                    <div key={ev.id} className="p-2 rounded border border-border space-y-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <Badge variant={ev.status === "sent" ? "default" : ev.status === "failed" || ev.status === "dead" ? "destructive" : "secondary"}>
                            {ev.status}
                          </Badge>
                          <span className="font-mono text-[11px]">{ev.channel}/{ev.source}</span>
                        </div>
                        <span className="text-muted-foreground">
                          {ev.latency_ms ? `${ev.latency_ms}ms` : "—"} · {formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap text-muted-foreground">
                        {ev.model && <span>model: <strong className="text-foreground">{ev.model}</strong></span>}
                        {ev.tokens != null && <span>tokens: {ev.tokens}</span>}
                        {ev.attempts > 1 && <span>attempts: {ev.attempts}</span>}
                        {ev.error_class && <Badge variant="destructive" className="text-[10px]">{ev.error_class}</Badge>}
                      </div>
                      {ev.last_error && (
                        <div className="text-destructive bg-destructive/10 rounded p-1.5 font-mono text-[11px] break-words">
                          {ev.last_error}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Agent Routing */}
            {routingLogs.length > 0 && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-emerald-500" />
                    Agent Routing History
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {routingLogs.map((r) => (
                    <div key={r.id} className="flex items-center justify-between border-b border-border/60 pb-1.5 last:border-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="capitalize">{r.agent_type}</Badge>
                        {r.routing_confidence != null && (
                          <span className="text-muted-foreground">{Math.round(r.routing_confidence * 100)}% conf</span>
                        )}
                        {r.handoff_occurred && (
                          <Badge variant="secondary" className="text-[10px]">handoff: {r.handoff_reason || "yes"}</Badge>
                        )}
                      </div>
                      <span className="text-muted-foreground">
                        {r.routed_at ? formatDistanceToNow(new Date(r.routed_at), { addSuffix: true }) : ""}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Swarm Runs */}
            {swarmRuns.length > 0 && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-500" />
                    Swarm Runs ({swarmRuns.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {swarmRuns.slice(0, 4).map((sr) => (
                    <div key={sr.id} className="p-2 rounded border border-border space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline">{sr.profile || "standard"}</Badge>
                          <Badge variant="secondary">{sr.mode || "sync"}</Badge>
                          {sr.final_score != null && <span>score: <strong>{sr.final_score}</strong></span>}
                          {sr.retries ? <span className="text-amber-500">retries: {sr.retries}</span> : null}
                        </div>
                        <span className="text-muted-foreground">
                          {formatDistanceToNow(new Date(sr.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      {sr.stage_timings && (
                        <div className="font-mono text-[11px] text-muted-foreground">
                          timings: {JSON.stringify(sr.stage_timings)}
                        </div>
                      )}
                      {sr.error && (
                        <div className="text-destructive font-mono text-[11px]">{sr.error}</div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Violations & Errors */}
            {(violations.length > 0 || errorLogs.length > 0) && (
              <Card className="border-amber-500/30">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2 text-amber-500">
                    <ShieldAlert className="h-4 w-4" />
                    Detected Issues ({violations.length + errorLogs.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {violations.map((v) => (
                    <div key={v.id} className="p-2 rounded bg-amber-500/10 border border-amber-500/20">
                      <div className="flex items-center gap-2 font-medium">
                        <Badge variant="outline">{v.severity}</Badge>
                        <span>Rule: {v.rule_broken}</span>
                      </div>
                      {v.explanation && <p className="text-muted-foreground mt-1">{v.explanation}</p>}
                    </div>
                  ))}
                  {errorLogs.map((er) => (
                    <div key={er.id} className="p-2 rounded bg-destructive/10 border border-destructive/20">
                      <div className="flex items-center gap-2 font-medium">
                        <Badge variant="destructive">{er.error_type}</Badge>
                        <span>status: {er.status}</span>
                      </div>
                      <p className="text-muted-foreground mt-1 line-clamp-2">{er.ai_response}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <Separator />

            {/* Action Footer */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleFlagAsError}
                disabled={submitting !== null || (!focusedMessage && events.length === 0)}
                className="gap-1.5"
              >
                {submitting === "error" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                )}
                Log as AI Error
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={handlePromoteToTest}
                disabled={submitting !== null || !priorUserMessage}
                className="gap-1.5"
              >
                {submitting === "test" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FlaskConical className="h-3.5 w-3.5 text-primary" />
                )}
                Promote to Regression Test
              </Button>

              <Button size="sm" variant="secondary" onClick={handleOpenKB} className="gap-1.5 ml-auto">
                <BookOpen className="h-3.5 w-3.5" />
                Open KB & Rules
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
