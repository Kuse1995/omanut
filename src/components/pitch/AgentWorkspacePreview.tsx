import { useState, useEffect } from "react";
import { Headset, Clock, AlertTriangle, CheckCircle2, User, MessageSquare, ArrowRight, ExternalLink, Shield, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface QueueItem {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  priority: string;
  status: string;
  department: string | null;
  ai_summary: string | null;
  sla_deadline: string | null;
  claimed_at: string | null;
  created_at: string;
}

interface TicketItem {
  id: string;
  ticket_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  issue_summary: string;
  issue_category: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  recommended_department: string | null;
  created_at: string;
}

interface FeedData {
  tickets: TicketItem[];
  queue: QueueItem[];
  messages: any[];
  conversations: any[];
  stats: {
    total_conversations: number;
    active_conversations: number;
    handoffs: number;
    tickets_created: number;
  };
}

const priorityConfig: Record<string, { color: string; icon: typeof AlertTriangle }> = {
  critical: { color: "bg-destructive/20 text-destructive border-destructive/30", icon: AlertTriangle },
  high: { color: "bg-orange-500/20 text-orange-400 border-orange-500/30", icon: AlertTriangle },
  medium: { color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", icon: Clock },
  low: { color: "bg-muted text-muted-foreground border-border", icon: Clock },
};

function slaCountdown(deadline: string | null) {
  if (!deadline) return null;
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return { text: "BREACHED", urgent: true };
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return { text: `${mins}m left`, urgent: mins < 10 };
  const hrs = Math.floor(mins / 60);
  return { text: `${hrs}h ${mins % 60}m left`, urgent: false };
}

function timeAgo(dateStr: string) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

const AgentWorkspacePreview = () => {
  const [data, setData] = useState<FeedData | null>(null);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set());

  const fetchFeed = async () => {
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/demo-live-feed`,
        { headers: { "Content-Type": "application/json" } }
      );
      if (res.ok) setData(await res.json());
    } catch (e) {
      console.error("Agent feed error:", e);
    }
  };

  useEffect(() => {
    fetchFeed();
    const interval = setInterval(fetchFeed, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleClaim = (id: string) => {
    setClaimedIds((prev) => new Set(prev).add(id));
  };

  const pendingQueue = data?.queue.filter(
    (q) => q.status === "waiting" && !q.claimed_at && !claimedIds.has(q.id)
  ) || [];
  const claimedQueue = data?.queue.filter(
    (q) => q.claimed_at || claimedIds.has(q.id)
  ) || [];

  const hasData = data && (data.queue.length > 0 || data.tickets.length > 0);

  return (
    <section className="py-24 px-6 border-t border-border/50 bg-muted/20">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/10 text-primary mb-6">
            <Headset className="w-4 h-4" />
            <span className="text-sm font-medium">Agent Workspace</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Human Agent Experience
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            When AI escalates — agents get a structured workspace with full context, priority queuing, and SLA tracking.
          </p>
        </div>

        {!hasData ? (
          <div className="bg-card border border-border rounded-2xl p-12 text-center">
            <Headset className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
            <p className="text-lg font-medium text-muted-foreground mb-2">No escalations yet</p>
            <p className="text-sm text-muted-foreground">
              When the AI encounters complex issues, tickets will appear here for human agents to claim and resolve.
            </p>
          </div>
        ) : (
          <div className="grid lg:grid-cols-5 gap-6">
            {/* Left: Ticket Queue (3 cols) */}
            <div className="lg:col-span-3 space-y-4">
              {/* Pending */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
                    Awaiting Agent ({pendingQueue.length})
                  </h3>
                </div>
                {pendingQueue.length === 0 ? (
                  <div className="bg-card border border-border rounded-xl p-6 text-center text-sm text-muted-foreground">
                    All tickets claimed ✓
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingQueue.map((item) => {
                      const sla = slaCountdown(item.sla_deadline);
                      const pConfig = priorityConfig[item.priority] || priorityConfig.medium;
                      return (
                        <div
                          key={item.id}
                          className="bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-all group"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant="outline" className={pConfig.color}>
                                  {item.priority}
                                </Badge>
                                {item.department && (
                                  <Badge variant="outline" className="text-xs">
                                    {item.department}
                                  </Badge>
                                )}
                                {sla && (
                                  <span className={`text-xs flex items-center gap-1 ${sla.urgent ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                                    <Clock className="w-3 h-3" />
                                    {sla.text}
                                  </span>
                                )}
                              </div>
                              {item.ai_summary && (
                                <p className="text-sm mb-2 line-clamp-2">{item.ai_summary}</p>
                              )}
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                {item.customer_name && (
                                  <span className="flex items-center gap-1">
                                    <User className="w-3 h-3" />
                                    {item.customer_name}
                                  </span>
                                )}
                                <span>{timeAgo(item.created_at)}</span>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => handleClaim(item.id)}
                              className="shrink-0 opacity-80 group-hover:opacity-100"
                            >
                              Claim
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Claimed */}
              {claimedQueue.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                    <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
                      Claimed ({claimedQueue.length})
                    </h3>
                  </div>
                  <div className="space-y-3">
                    {claimedQueue.map((item) => (
                      <div key={item.id} className="bg-card border border-green-500/20 rounded-xl p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30">
                                Claimed
                              </Badge>
                              {item.department && (
                                <Badge variant="outline" className="text-xs">{item.department}</Badge>
                              )}
                            </div>
                            {item.ai_summary && (
                              <p className="text-sm text-muted-foreground line-clamp-1">{item.ai_summary}</p>
                            )}
                          </div>
                          <span className="text-xs text-green-400 flex items-center gap-1">
                            <User className="w-3 h-3" />
                            Agent
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right: Key capabilities (2 cols) */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  Agent Capabilities
                </h3>
                <div className="space-y-3">
                  {[
                    { icon: MessageSquare, title: "Full Conversation History", desc: "Agents see the complete AI-customer chat before claiming" },
                    { icon: Shield, title: "AI-Suggested Responses", desc: "Draft replies generated from context for faster resolution" },
                    { icon: Clock, title: "SLA Tracking", desc: "Priority-based deadlines with automatic escalation" },
                    { icon: Headset, title: "Load Balancing", desc: "Tickets distributed based on agent availability and capacity" },
                  ].map((cap, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <cap.icon className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{cap.title}</p>
                        <p className="text-xs text-muted-foreground">{cap.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ticket Summary */}
              {data.tickets.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-6">
                  <h3 className="font-semibold mb-4">Recent Tickets</h3>
                  <div className="space-y-3">
                    {data.tickets.slice(0, 4).map((ticket) => (
                      <div key={ticket.id} className="flex items-start gap-3 text-sm">
                        <span className="font-mono text-xs text-primary shrink-0">{ticket.ticket_number}</span>
                        <div className="flex-1 min-w-0">
                          <p className="line-clamp-1">{ticket.issue_summary}</p>
                          <p className="text-xs text-muted-foreground">
                            {ticket.customer_name} • {ticket.recommended_department || ticket.issue_category}
                          </p>
                        </div>
                        <Badge variant="outline" className={`text-xs shrink-0 ${
                          priorityConfig[ticket.priority]?.color || ""
                        }`}>
                          {ticket.priority}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Button variant="outline" className="w-full" asChild>
                <a href="/pitch/banking/agent" target="_blank" rel="noopener noreferrer">
                  Open Full Agent Workspace <ExternalLink className="ml-2 w-4 h-4" />
                </a>
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default AgentWorkspacePreview;
