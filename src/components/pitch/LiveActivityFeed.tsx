import { useState, useEffect } from "react";
import { MessageSquare, Ticket, Users, Radio, Clock, AlertTriangle, CheckCircle2, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface DemoFeedData {
  demo_session: any;
  conversations: any[];
  messages: any[];
  tickets: any[];
  queue: any[];
  stats: {
    total_conversations: number;
    active_conversations: number;
    handoffs: number;
    tickets_created: number;
  };
}

const priorityColors: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-muted text-muted-foreground",
};

const statusColors: Record<string, string> = {
  waiting: "bg-yellow-500/20 text-yellow-400",
  claimed: "bg-primary/20 text-primary",
  completed: "bg-green-500/20 text-green-400",
  open: "bg-yellow-500/20 text-yellow-400",
  in_progress: "bg-primary/20 text-primary",
  resolved: "bg-green-500/20 text-green-400",
};

function timeAgo(dateStr: string) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

const LiveActivityFeed = () => {
  const [data, setData] = useState<DemoFeedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"messages" | "tickets" | "queue">("messages");

  const fetchFeed = async () => {
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/demo-live-feed`,
        { headers: { "Content-Type": "application/json" } }
      );
      if (res.ok) {
        setData(await res.json());
      }
    } catch (e) {
      console.error("Feed fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeed();
    const interval = setInterval(fetchFeed, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <section className="py-24 px-6 border-t border-border/50">
        <div className="max-w-6xl mx-auto text-center">
          <div className="animate-pulse flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-muted" />
            <div className="h-8 w-64 bg-muted rounded" />
            <div className="h-4 w-48 bg-muted rounded" />
          </div>
        </div>
      </section>
    );
  }

  const hasActivity = data && (data.messages.length > 0 || data.tickets.length > 0 || data.queue.length > 0);

  return (
    <section className="py-24 px-6 border-t border-border/50">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 mb-6">
            <Radio className="w-4 h-4 animate-pulse" />
            <span className="text-sm font-medium">Live Demo Activity</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Real-Time Dashboard
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {data?.demo_session
              ? `Active demo: ${data.demo_session.demo_company_name}`
              : "Scan the QR code above and start chatting — activity appears here instantly."}
          </p>
        </div>

        {/* Stats Row */}
        {data?.stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { label: "Conversations", value: data.stats.total_conversations, icon: MessageSquare },
              { label: "Active Now", value: data.stats.active_conversations, icon: Radio },
              { label: "Tickets Created", value: data.stats.tickets_created, icon: Ticket },
              { label: "Handoffs", value: data.stats.handoffs, icon: ArrowUpRight },
            ].map((stat, i) => (
              <div key={i} className="p-4 rounded-xl border border-border bg-card/50 text-center">
                <stat.icon className="w-5 h-5 text-primary mx-auto mb-2" />
                <div className="text-3xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-muted/30 rounded-xl p-1 max-w-md mx-auto">
          {[
            { key: "messages" as const, label: "Messages", icon: MessageSquare, count: data?.messages.length },
            { key: "tickets" as const, label: "Tickets", icon: Ticket, count: data?.tickets.length },
            { key: "queue" as const, label: "Queue", icon: Users, count: data?.queue.length },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {(tab.count ?? 0) > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.key ? "bg-primary-foreground/20" : "bg-muted"
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden min-h-[400px]">
          {!hasActivity ? (
            <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
              <MessageSquare className="w-12 h-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">No activity yet</p>
              <p className="text-sm">Messages will appear here as customers interact with the AI</p>
            </div>
          ) : activeTab === "messages" ? (
            <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
              {data?.messages.map((msg) => (
                <div key={msg.id} className="p-4 flex gap-3 hover:bg-muted/20 transition-colors">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                    msg.role === "user"
                      ? "bg-accent/20 text-accent"
                      : "bg-primary/20 text-primary"
                  }`}>
                    {msg.role === "user" ? "C" : "AI"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium">
                        {msg.role === "user" ? "Customer" : "AI Assistant"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {timeAgo(msg.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : activeTab === "tickets" ? (
            <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
              {data?.tickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                  <Ticket className="w-12 h-12 mb-4 opacity-30" />
                  <p>No tickets created yet</p>
                </div>
              ) : (
                data?.tickets.map((ticket) => (
                  <div key={ticket.id} className="p-4 hover:bg-muted/20 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-xs text-primary">{ticket.ticket_number}</span>
                          <Badge variant="outline" className={priorityColors[ticket.priority] || priorityColors.medium}>
                            {ticket.priority}
                          </Badge>
                          <Badge variant="outline" className={statusColors[ticket.status] || ""}>
                            {ticket.status}
                          </Badge>
                        </div>
                        <p className="text-sm font-medium mb-1">{ticket.issue_summary}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {ticket.customer_name && <span>{ticket.customer_name}</span>}
                          {ticket.recommended_department && (
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {ticket.recommended_department}
                            </span>
                          )}
                          <span>{timeAgo(ticket.created_at)}</span>
                        </div>
                      </div>
                      {ticket.assigned_to && (
                        <div className="text-xs text-green-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Assigned
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
              {data?.queue.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                  <Users className="w-12 h-12 mb-4 opacity-30" />
                  <p>No items in agent queue</p>
                </div>
              ) : (
                data?.queue.map((item) => (
                  <div key={item.id} className="p-4 hover:bg-muted/20 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className={priorityColors[item.priority] || priorityColors.medium}>
                            {item.priority}
                          </Badge>
                          <Badge variant="outline" className={statusColors[item.status] || ""}>
                            {item.status}
                          </Badge>
                          {item.department && (
                            <span className="text-xs text-muted-foreground">{item.department}</span>
                          )}
                        </div>
                        {item.ai_summary && (
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-1">{item.ai_summary}</p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {item.customer_name && <span>{item.customer_name}</span>}
                          <span>{timeAgo(item.created_at)}</span>
                          {item.sla_deadline && (
                            <span className="flex items-center gap-1 text-yellow-400">
                              <Clock className="w-3 h-3" />
                              SLA: {timeAgo(item.sla_deadline)}
                            </span>
                          )}
                        </div>
                      </div>
                      {item.claimed_at && (
                        <div className="text-xs text-green-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Claimed
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default LiveActivityFeed;
