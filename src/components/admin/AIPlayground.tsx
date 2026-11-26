import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Send,
  RotateCcw,
  Loader2,
  Clock,
  Zap,
  Brain,
  User,
  Bot,
  BarChart3,
  FlaskConical,
  MessageSquare,
  Play,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  RegressionTestCase,
  listRegressionTests,
  createRegressionTest,
  updateRegressionTestResult,
  deleteRegressionTest,
} from "@/lib/regressionTests";
import { toast } from "sonner";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Analysis {
  mode: string;
  response_time_ms: number;
  model_used: string;
  tokens_used: number;
  system_prompt_length: number;
  knowledge_base_loaded: boolean;
  ai_overrides_applied: {
    system_instructions: boolean;
    qa_style: boolean;
    banned_topics: boolean;
  };
}

interface AIPlaygroundProps {
  companyId: string;
}

function evaluateTestAssertions(test: RegressionTestCase, reply: string) {
  const lower = reply.toLowerCase();
  const missing = (test.must_include || []).filter((term) => !lower.includes(term.toLowerCase()));
  const forbiddenFound = (test.must_not_include || []).filter((term) => lower.includes(term.toLowerCase()));
  const empty = !reply.trim();
  const passed = !empty && missing.length === 0 && forbiddenFound.length === 0;
  return { passed, missing, forbiddenFound, empty };
}

export const AIPlayground = ({ companyId }: AIPlaygroundProps) => {
  const [view, setView] = useState<"chat" | "regression">("chat");

  // Interactive Chat State
  const [mode, setMode] = useState<"customer" | "boss" | "training">("customer");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<Analysis | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Regression Suite State
  const [tests, setTests] = useState<RegressionTestCase[]>([]);
  const [loadingTests, setLoadingTests] = useState(false);
  const [runningIds, setRunningIds] = useState<Record<string, boolean>>({});
  const [runningAll, setRunningAll] = useState(false);
  const [failuresMap, setFailuresMap] = useState<
    Record<string, { missing: string[]; forbiddenFound: string[]; empty: boolean; latencyMs?: number }>
  >({});
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newExpected, setNewExpected] = useState("");
  const [newMustInclude, setNewMustInclude] = useState("");
  const [newMustNotInclude, setNewMustNotInclude] = useState("");
  const [creatingTest, setCreatingTest] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const loadTests = async () => {
    setLoadingTests(true);
    try {
      const list = await listRegressionTests(companyId);
      setTests(list);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load regression tests");
    } finally {
      setLoadingTests(false);
    }
  };

  useEffect(() => {
    loadTests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please log in to use the playground");
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-playground`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          company_id: companyId,
          mode,
          message: userMessage,
          conversation_history: messages,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get AI response");
      }

      const data = await response.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
      setLastAnalysis(data.analysis);
    } catch (error) {
      console.error("Playground error:", error);
      toast.error("Failed to get AI response");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  const runSingleTest = async (test: RegressionTestCase, accessToken?: string): Promise<boolean> => {
    setRunningIds((prev) => ({ ...prev, [test.id]: true }));
    try {
      let token = accessToken;
      if (!token) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          toast.error("Please log in to run tests");
          return false;
        }
        token = session.access_token;
      }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-playground`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          company_id: companyId,
          mode: "customer",
          message: test.prompt,
          conversation_history: [],
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply = String(data?.response || "");
      const modelUsed = data?.analysis?.model_used || null;
      const latencyMs = data?.analysis?.response_time_ms;
      const evalRes = evaluateTestAssertions(test, reply);

      const runResult = {
        last_run_at: new Date().toISOString(),
        last_passed: evalRes.passed,
        last_response: reply,
        last_model: modelUsed,
      };

      await updateRegressionTestResult(companyId, test.id, runResult);
      setTests((prev) => prev.map((t) => (t.id === test.id ? { ...t, ...runResult } : t)));
      setFailuresMap((prev) => ({
        ...prev,
        [test.id]: {
          missing: evalRes.missing,
          forbiddenFound: evalRes.forbiddenFound,
          empty: evalRes.empty,
          latencyMs,
        },
      }));
      return evalRes.passed;
    } catch (err: unknown) {
      toast.error(`Test "${test.name}" failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      setRunningIds((prev) => ({ ...prev, [test.id]: false }));
    }
  };

  const runAllTests = async () => {
    if (tests.length === 0) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      toast.error("Please log in to run tests");
      return;
    }
    setRunningAll(true);
    let passed = 0;
    for (const t of tests) {
      const ok = await runSingleTest(t, session.access_token);
      if (ok) passed += 1;
    }
    setRunningAll(false);
    toast.success(`Regression run complete: ${passed}/${tests.length} passed`);
  };

  const handleAddTest = async () => {
    if (!newName.trim() || !newPrompt.trim()) {
      toast.error("Name and customer prompt are required");
      return;
    }
    setCreatingTest(true);
    try {
      const created = await createRegressionTest(companyId, {
        name: newName,
        prompt: newPrompt,
        expected_behavior: newExpected || null,
        must_include: newMustInclude
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        must_not_include: newMustNotInclude
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setTests((prev) => [created, ...prev]);
      setAddOpen(false);
      setNewName("");
      setNewPrompt("");
      setNewExpected("");
      setNewMustInclude("");
      setNewMustNotInclude("");
      toast.success("Regression test saved");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save test");
    } finally {
      setCreatingTest(false);
    }
  };

  const handleDeleteTest = async (id: string) => {
    try {
      await deleteRegressionTest(companyId, id);
      setTests((prev) => prev.filter((t) => t.id !== id));
      toast.success("Test removed");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete test");
    }
  };

  const clearChat = () => {
    setMessages([]);
    setLastAnalysis(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const passedCount = tests.filter((t) => t.last_passed === true).length;
  const runCount = tests.filter((t) => t.last_passed !== null && t.last_passed !== undefined).length;
  const passRate = runCount > 0 ? Math.round((passedCount / runCount) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Mode Switch Bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={view === "chat" ? "default" : "outline"}
            onClick={() => setView("chat")}
            className="gap-1.5"
          >
            <MessageSquare className="h-4 w-4" />
            Interactive Chat
          </Button>
          <Button
            size="sm"
            variant={view === "regression" ? "default" : "outline"}
            onClick={() => setView("regression")}
            className="gap-1.5"
          >
            <FlaskConical className="h-4 w-4" />
            Regression Suite ({tests.length})
          </Button>
        </div>
      </div>

      {view === "chat" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chat Interface */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Test Conversations</CardTitle>
                <div className="flex items-center gap-2">
                  <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4" />
                          Customer
                        </div>
                      </SelectItem>
                      <SelectItem value="boss">
                        <div className="flex items-center gap-2">
                          <Brain className="h-4 w-4" />
                          Boss
                        </div>
                      </SelectItem>
                      <SelectItem value="training">
                        <div className="flex items-center gap-2">
                          <Zap className="h-4 w-4" />
                          Training
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" onClick={clearChat}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ScrollArea className="h-[400px] rounded-lg border bg-muted/30 p-4" ref={scrollRef}>
                {messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Bot className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Start a conversation to test the AI</p>
                      <p className="text-sm mt-1">Mode: {mode}</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((msg, idx) => (
                      <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[80%] rounded-lg px-4 py-2 ${
                            msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border"
                          }`}
                        >
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      </div>
                    ))}
                    {isLoading && (
                      <div className="flex justify-start">
                        <div className="bg-card border rounded-lg px-4 py-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>

              <div className="flex gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Type a ${mode} message...`}
                  className="min-h-[60px] resize-none"
                  disabled={isLoading}
                />
                <Button onClick={sendMessage} disabled={!input.trim() || isLoading} size="icon" className="h-auto">
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setInput("I want to make a reservation for 4 people tomorrow at 7pm")}
                >
                  Test Reservation
                </Button>
                <Button variant="outline" size="sm" onClick={() => setInput("What are your prices?")}>
                  Test Pricing
                </Button>
                <Button variant="outline" size="sm" onClick={() => setInput("I have a complaint about my last visit")}>
                  Test Complaint
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Analysis Panel */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Response Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              {lastAnalysis ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Response Time</span>
                    <Badge variant="secondary" className="ml-auto">
                      {lastAnalysis.response_time_ms}ms
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Tokens Used</span>
                    <Badge variant="secondary" className="ml-auto">
                      {lastAnalysis.tokens_used}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Model</span>
                    <Badge variant="outline" className="ml-auto text-xs">
                      {lastAnalysis.model_used.includes("/")
                        ? lastAnalysis.model_used.split("/")[1]
                        : lastAnalysis.model_used}
                    </Badge>
                  </div>

                  <div className="border-t pt-4 mt-4">
                    <p className="text-sm font-medium mb-2">Configuration Applied</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>System Instructions</span>
                        <Badge variant={lastAnalysis.ai_overrides_applied.system_instructions ? "default" : "secondary"}>
                          {lastAnalysis.ai_overrides_applied.system_instructions ? "Active" : "None"}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span>Q&A Style</span>
                        <Badge variant={lastAnalysis.ai_overrides_applied.qa_style ? "default" : "secondary"}>
                          {lastAnalysis.ai_overrides_applied.qa_style ? "Active" : "None"}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span>Banned Topics</span>
                        <Badge variant={lastAnalysis.ai_overrides_applied.banned_topics ? "default" : "secondary"}>
                          {lastAnalysis.ai_overrides_applied.banned_topics ? "Active" : "None"}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span>Knowledge Base</span>
                        <Badge variant={lastAnalysis.knowledge_base_loaded ? "default" : "secondary"}>
                          {lastAnalysis.knowledge_base_loaded ? "Loaded" : "Empty"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">Send a message to see analysis</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Suite Header & Summary */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <CardTitle className="text-lg">AI Regression Suite</CardTitle>
                  <CardDescription>
                    Verify KB, pricing, and custom instructions before going live or after edits
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Dialog open={addOpen} onOpenChange={setAddOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <Plus className="h-4 w-4" />
                        Add Test Case
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>New Regression Test Case</DialogTitle>
                        <DialogDescription>
                          Add a customer prompt and phrase assertions to verify AI accuracy.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Test Name</Label>
                          <Input
                            placeholder="e.g., Pro plan price check"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Customer Prompt</Label>
                          <Textarea
                            rows={2}
                            placeholder="How much is the pro plan?"
                            value={newPrompt}
                            onChange={(e) => setNewPrompt(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Expected Behavior (Notes)</Label>
                          <Input
                            placeholder="Quotes exact KB price K799 without markdown"
                            value={newExpected}
                            onChange={(e) => setNewExpected(e.target.value)}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Must Include (comma-separated)</Label>
                            <Input
                              placeholder="K799, Pro"
                              value={newMustInclude}
                              onChange={(e) => setNewMustInclude(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Must NOT Include (comma-separated)</Label>
                            <Input
                              placeholder="free, wholesale"
                              value={newMustNotInclude}
                              onChange={(e) => setNewMustNotInclude(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setAddOpen(false)} disabled={creatingTest}>
                          Cancel
                        </Button>
                        <Button onClick={handleAddTest} disabled={creatingTest}>
                          {creatingTest ? "Saving…" : "Save Test"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Button
                    size="sm"
                    onClick={runAllTests}
                    disabled={runningAll || tests.length === 0}
                    className="gap-1.5"
                  >
                    {runningAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Run All Tests
                  </Button>
                </div>
              </div>
            </CardHeader>
            {runCount > 0 && (
              <CardContent className="pt-0 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span>
                    Latest pass rate: <strong>{passedCount}/{runCount}</strong> passed ({passRate}%)
                  </span>
                  <span className="text-muted-foreground">{tests.length} total cases</span>
                </div>
                <Progress value={passRate} className="h-2" />
              </CardContent>
            )}
          </Card>

          {/* Test Cases List */}
          {loadingTests ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading regression tests…</div>
          ) : tests.length === 0 ? (
            <Card className="p-8 text-center space-y-2">
              <FlaskConical className="h-10 w-10 mx-auto text-muted-foreground/50" />
              <div className="font-medium">No regression test cases yet</div>
              <p className="text-xs text-muted-foreground">
                Add a test case above, or click "Promote to Test" on any AI Error, Rule Violation, or AI X-Ray turn.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {tests.map((test) => {
                const running = !!runningIds[test.id];
                const failureInfo = failuresMap[test.id];
                return (
                  <Card key={test.id} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {test.last_passed === true && (
                            <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Passed
                            </Badge>
                          )}
                          {test.last_passed === false && (
                            <Badge variant="destructive" className="gap-1">
                              <XCircle className="h-3 w-3" /> Failed
                            </Badge>
                          )}
                          {(test.last_passed === null || test.last_passed === undefined) && (
                            <Badge variant="outline">Not run</Badge>
                          )}
                          <span className="font-semibold text-sm">{test.name}</span>
                          {test.last_model && (
                            <Badge variant="secondary" className="text-[10px]">
                              {test.last_model}
                            </Badge>
                          )}
                          {failureInfo?.latencyMs != null && (
                            <span className="text-[11px] text-muted-foreground">{failureInfo.latencyMs}ms</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          <strong>Prompt:</strong> {test.prompt}
                        </p>
                        {test.expected_behavior && (
                          <p className="text-xs text-muted-foreground">
                            <strong>Expected:</strong> {test.expected_behavior}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {(test.must_include || []).map((inc) => (
                            <Badge key={`inc-${inc}`} variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-600">
                              + {inc}
                            </Badge>
                          ))}
                          {(test.must_not_include || []).map((exc) => (
                            <Badge key={`exc-${exc}`} variant="outline" className="text-[10px] border-destructive/30 text-destructive">
                              − {exc}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs gap-1"
                          disabled={running || runningAll}
                          onClick={() => runSingleTest(test)}
                        >
                          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          Run
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive"
                          onClick={() => handleDeleteTest(test.id)}
                          title="Delete test"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {failureInfo && (failureInfo.missing.length > 0 || failureInfo.forbiddenFound.length > 0 || failureInfo.empty) && (
                      <div className="text-xs rounded bg-destructive/10 border border-destructive/20 p-2 space-y-1 text-destructive">
                        {failureInfo.empty && <div>Empty AI response</div>}
                        {failureInfo.missing.length > 0 && (
                          <div>Missing required phrases: {failureInfo.missing.join(", ")}</div>
                        )}
                        {failureInfo.forbiddenFound.length > 0 && (
                          <div>Forbidden phrases appeared: {failureInfo.forbiddenFound.join(", ")}</div>
                        )}
                      </div>
                    )}

                    {test.last_response && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                          Latest AI response
                          {test.last_run_at ? ` · ${new Date(test.last_run_at).toLocaleString()}` : ""}
                        </summary>
                        <div className="mt-1.5 p-2.5 rounded bg-muted whitespace-pre-wrap">{test.last_response}</div>
                      </details>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
