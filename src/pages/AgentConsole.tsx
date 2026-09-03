import { useState, useRef, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { Send, Sparkles, Video, PenLine, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import ClientSidebar from "@/components/dashboard/ClientSidebar";
import { useCompany } from "@/context/CompanyContext";
import { supabase } from "@/integrations/supabase/client";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  action?: { type: string | null; job_id?: string | null; post_id?: string | null } | null;
}

const QUICK_ACTIONS = [
  { label: "How much is the Pro plan?", prompt: "How much is the Pro plan?" },
  { label: "Make a video ad", prompt: "Make a video ad for our best-selling product" },
  { label: "Draft a post", prompt: "Draft a Facebook post about our free Saturday training" },
  { label: "What can you do?", prompt: "What can you do for my business?" },
];

const AgentConsole = () => {
  const { selectedCompany } = useCompany();
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    // Never spin forever: if the session check stalls (stale token, storage
    // hiccup), fall through to the login redirect after 4 seconds.
    const timeout = setTimeout(() => {
      if (alive) setAuthLoading(false);
    }, 4000);
    supabase.auth.getSession()
      .then(({ data }) => { if (alive) { setSession(data.session); setAuthLoading(false); } })
      .catch(() => { if (alive) setAuthLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (alive) { setSession(s); setAuthLoading(false); }
    });
    return () => { alive = false; clearTimeout(timeout); sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!selectedCompany) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Sparkles className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-foreground font-medium">Select a company first</p>
          <p className="text-sm text-muted-foreground mt-1">The AI Agent works per company.</p>
        </div>
      </div>
    );
  }

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    const userMsg: ChatMessage = { role: "user", content: message };
    const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    try {
      const { data, error } = await supabase.functions.invoke("agent-console", {
        body: { company_id: selectedCompany.id, message, history },
      });
      if (error) throw new Error(error.message || "Agent request failed");
      const reply: string = data?.reply || "I couldn't process that just now.";
      const action = data?.action || null;
      setMessages((prev) => [...prev, { role: "assistant", content: reply, action }]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ " + (e?.message || "Something went wrong. Please try again.") },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <ClientSidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />

      <div className="flex-1 flex flex-col h-screen">
        {/* Header */}
        <div className="border-b px-6 py-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground leading-tight">AI Agent</h1>
            <p className="text-xs text-muted-foreground">
              {selectedCompany.name} · answers from your knowledge base, makes videos, drafts posts
            </p>
          </div>
        </div>

        {/* Thread */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-10">
                <Sparkles className="h-10 w-10 mx-auto text-primary/60 mb-4" />
                <h2 className="text-xl font-semibold text-foreground">
                  Hey! I'm your {selectedCompany.name} agent.
                </h2>
                <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                  Ask me anything about your business, or tell me what to make — videos, posts, answers for customers.
                </p>
                <div className="flex flex-wrap justify-center gap-2 mt-6">
                  {QUICK_ACTIONS.map((qa) => (
                    <button
                      key={qa.label}
                      onClick={() => send(qa.prompt)}
                      className="text-sm px-3 py-2 rounded-full border bg-card hover:bg-accent transition-colors text-foreground"
                    >
                      {qa.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={"flex " + (m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={
                    "max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed " +
                    (m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm")
                  }
                >
                  {m.content}
                  {m.action?.type === "video" && (
                    <div className="mt-2 flex items-center gap-2 text-xs bg-background/60 rounded-lg px-2 py-1.5">
                      <Video className="h-3.5 w-3.5" />
                      <span>Rendering — lands in Media Studio + WhatsApp in 1-3 min</span>
                    </div>
                  )}
                  {m.action?.type === "post" && (
                    <div className="mt-2 flex items-center gap-2 text-xs bg-background/60 rounded-lg px-2 py-1.5">
                      <PenLine className="h-3.5 w-3.5" />
                      <span>Draft saved — approve it in the Content Scheduler</span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl px-4 py-3 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Thinking…</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="border-t px-4 py-3">
          <form
            className="max-w-3xl mx-auto flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder={"Message your agent…"}
              className="flex-1 resize-none max-h-32 rounded-xl border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button type="submit" size="icon" className="h-11 w-11 rounded-xl" disabled={busy || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
          <p className="max-w-3xl mx-auto text-[11px] text-muted-foreground mt-1.5 text-center">
            The agent answers from your company knowledge base. Videos cost generation credits.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AgentConsole;