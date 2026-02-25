import { useState, useEffect, useCallback } from "react";
import { Headset, Clock, AlertTriangle, CheckCircle2, User, MessageSquare, ArrowLeft, Shield, Zap, Radio, Phone, Mail, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import omanutLogo from "@/assets/omanut-logo-new.png";

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

interface FeedMessage {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
}

interface FeedData {
  demo_session: any;
  tickets: TicketItem[];
  queue: QueueItem[];
  messages: FeedMessage[];
  conversations: any[];
  stats: {
    total_conversations: number;
    active_conversations: number;
    handoffs: number;
    tickets_created: number;
  };
}

const priorityConfig: Record<string, { color: string; border: string }> = {
  critical: { color: "bg-destructive/20 text-destructive border-destructive/30", border: "border-l-destructive" },
  high: { color: "bg-orange-500/20 text-orange-400 border-orange-500/30", border: "border-l-orange-500" },
  medium: { color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", border: "border-l-yellow-500" },
  low: { color: "bg-muted text-muted-foreground border-border", border: "border-l-muted-foreground" },
};

function slaCountdown(deadline: string | null) {
  if (!deadline) return null;
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return { text: "BREACHED", urgent: true };
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return { text: `${mins}m remaining`, urgent: mins < 10 };
  const hrs = Math.floor(mins / 60);
  return { text: `${hrs}h ${mins % 60}m remaining`, urgent: false };
}

function timeAgo(dateStr: string) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

const PitchAgentDemo = () => {
  const [data, setData] = useState<FeedData | null>(null);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set());
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchFeed = useCallback(async () => {
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/demo-live-feed`,
        { headers: { "Content-Type": "application/json" } }
      );
      if (res.ok) setData(await res.json());
    } catch (e) {
      console.error("Agent feed error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeed();
    const interval = setInterval(fetchFeed, 5000);
    return () => clearInterval(interval);
  }, [fetchFeed]);

  const handleClaim = (id: string) => {
    setClaimedIds((prev) => new Set(prev).add(id));
    setSelectedQueueId(id);
  };

  const selectedItem = data?.queue.find((q) => q.id === selectedQueueId);
  const selectedConversationMessages = selectedItem
    ? data?.messages.filter((m) =>
        data?.conversations.some(
          (c) => c.id === m.conversation_id && c.phone === selectedItem.customer_phone
        )
      ) || []
    : [];

  const matchingTicket = selectedItem
    ? data?.tickets.find((t) => t.customer_phone === selectedItem.customer_phone)
    : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <Headset className="w-12 h-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">Loading agent workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top Bar */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <a href="/pitch/banking"><ArrowLeft className="w-4 h-4" /></a>
          </Button>
          <img src={omanutLogo} alt="Omanut" className="w-8 h-8 object-contain" />
          <div>
            <h1 className="font-semibold text-sm">Agent Workspace</h1>
            <p className="text-xs text-muted-foreground">
              {data?.demo_session?.demo_company_name || "Demo"} • Live
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 text-xs">
            <Radio className="w-3 h-3 animate-pulse" />
            Live
          </div>
          <Badge variant="outline">{data?.queue.length || 0} in queue</Badge>
          <Button variant="ghost" size="icon" onClick={fetchFeed}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Queue */}
        <div className="w-80 border-r border-border flex flex-col shrink-0">
          <div className="p-3 border-b border-border bg-muted/30">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Headset className="w-4 h-4" />
              Ticket Queue
            </h2>
          </div>
          <ScrollArea className="flex-1">
            {(!data?.queue || data.queue.length === 0) ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Headset className="w-10 h-10 mx-auto mb-3 opacity-30" />
                No tickets in queue
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.queue.map((item) => {
                  const isClaimed = item.claimed_at || claimedIds.has(item.id);
                  const isSelected = selectedQueueId === item.id;
                  const sla = slaCountdown(item.sla_deadline);
                  const pCfg = priorityConfig[item.priority] || priorityConfig.medium;

                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedQueueId(item.id)}
                      className={`p-3 cursor-pointer transition-all border-l-4 ${pCfg.border} ${
                        isSelected ? "bg-primary/5 border-l-primary" : "hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge variant="outline" className={`text-xs ${pCfg.color}`}>
                          {item.priority}
                        </Badge>
                        {isClaimed && (
                          <Badge variant="outline" className="text-xs bg-green-500/20 text-green-400 border-green-500/30">
                            Claimed
                          </Badge>
                        )}
                        {item.department && (
                          <span className="text-xs text-muted-foreground ml-auto">{item.department}</span>
                        )}
                      </div>
                      {item.ai_summary && (
                        <p className="text-xs line-clamp-2 mb-1">{item.ai_summary}</p>
                      )}
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{item.customer_name || "Unknown"}</span>
                        <div className="flex items-center gap-2">
                          {sla && (
                            <span className={sla.urgent ? "text-destructive" : ""}>
                              {sla.text}
                            </span>
                          )}
                          <span>{timeAgo(item.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Center: Conversation */}
        <div className="flex-1 flex flex-col">
          {!selectedQueueId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
              <MessageSquare className="w-16 h-16 opacity-20" />
              <p className="text-lg font-medium">Select a ticket to view</p>
              <p className="text-sm">Click on a queue item to see the full AI conversation and claim it</p>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="border-b border-border p-3 flex items-center justify-between bg-card/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                    <User className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{selectedItem?.customer_name || "Customer"}</p>
                    <p className="text-xs text-muted-foreground">{selectedItem?.customer_phone}</p>
                  </div>
                </div>
                {!claimedIds.has(selectedQueueId) && !selectedItem?.claimed_at && (
                  <Button onClick={() => handleClaim(selectedQueueId)}>
                    <Headset className="w-4 h-4 mr-2" /> Claim Ticket
                  </Button>
                )}
                {(claimedIds.has(selectedQueueId) || selectedItem?.claimed_at) && (
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> You claimed this
                  </Badge>
                )}
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                {selectedConversationMessages.length === 0 ? (
                  <div className="text-center text-muted-foreground py-12">
                    <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Conversation history will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-w-3xl mx-auto">
                    {selectedConversationMessages.map((msg) => (
                      <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm ${
                          msg.role === "user"
                            ? "bg-accent/20 text-foreground rounded-br-md"
                            : "bg-muted text-foreground rounded-bl-md"
                        }`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium">
                              {msg.role === "user" ? "Customer" : "AI"}
                            </span>
                            <span className="text-xs text-muted-foreground">{timeAgo(msg.created_at)}</span>
                          </div>
                          <p>{msg.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>

              {/* Reply area (visual only) */}
              {(claimedIds.has(selectedQueueId) || selectedItem?.claimed_at) && (
                <div className="border-t border-border p-3 bg-card/50">
                  <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 mb-3">
                    <p className="text-xs font-medium text-primary mb-1 flex items-center gap-1">
                      <Zap className="w-3 h-3" /> AI Suggested Response
                    </p>
                    <p className="text-sm text-muted-foreground">
                      "Thank you for reporting this issue. I've reviewed the full conversation and I'm personally taking over to ensure your {selectedItem?.department || "concern"} is resolved promptly..."
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Type your response to the customer..."
                      className="flex-1 bg-muted border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      readOnly
                    />
                    <Button disabled>Send</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: Details panel */}
        {selectedQueueId && (
          <div className="w-72 border-l border-border flex flex-col shrink-0">
            <div className="p-3 border-b border-border bg-muted/30">
              <h3 className="font-semibold text-sm">Ticket Details</h3>
            </div>
            <ScrollArea className="flex-1 p-3">
              <div className="space-y-4">
                {/* Customer Info */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Customer</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <User className="w-4 h-4 text-muted-foreground" />
                      {selectedItem?.customer_name || "Unknown"}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                      {selectedItem?.customer_phone || "N/A"}
                    </div>
                  </div>
                </div>

                {/* Ticket */}
                {matchingTicket && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Ticket</p>
                    <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-primary">{matchingTicket.ticket_number}</span>
                        <Badge variant="outline" className={`text-xs ${priorityConfig[matchingTicket.priority]?.color || ""}`}>
                          {matchingTicket.priority}
                        </Badge>
                      </div>
                      <p className="text-sm">{matchingTicket.issue_summary}</p>
                      <div className="text-xs text-muted-foreground">
                        <p>Category: {matchingTicket.issue_category}</p>
                        {matchingTicket.recommended_department && (
                          <p>Dept: {matchingTicket.recommended_department}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* AI Summary */}
                {selectedItem?.ai_summary && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">AI Summary</p>
                    <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                      <p className="text-sm">{selectedItem.ai_summary}</p>
                    </div>
                  </div>
                )}

                {/* SLA */}
                {selectedItem?.sla_deadline && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">SLA</p>
                    {(() => {
                      const sla = slaCountdown(selectedItem.sla_deadline);
                      return sla ? (
                        <div className={`rounded-lg p-3 text-sm font-medium ${
                          sla.urgent ? "bg-destructive/10 text-destructive" : "bg-muted/30"
                        }`}>
                          <Clock className="w-4 h-4 inline mr-2" />
                          {sla.text}
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
};

export default PitchAgentDemo;
