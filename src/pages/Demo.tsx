import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageSquare,
  Phone,
  Zap,
  Clock,
  Users,
  Building2,
  QrCode,
  ArrowRight,
  Sparkles,
  Bot,
  UserCheck,
} from "lucide-react";
import omanutLogo from "@/assets/omanut-logo-new.png";

const DEMO_COMPANY_ID = "332b4f2c-9255-47f6-be9e-69e52ea22656";
const DEMO_WHATSAPP = "+13345083612";

interface DemoSession {
  id: string;
  demo_company_name: string;
  custom_persona: string | null;
  researched_data: Record<string, string> | null;
  created_at: string;
  expires_at: string;
  status: string;
}

interface RecentMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
  conversation_id: string;
}

interface ConversationStats {
  total: number;
  active: number;
}

export default function Demo() {
  const [session, setSession] = useState<DemoSession | null>(null);
  const [messages, setMessages] = useState<RecentMessage[]>([]);
  const [stats, setStats] = useState<ConversationStats>({ total: 0, active: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDemoData();
    const interval = setInterval(fetchDemoData, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, []);

  async function fetchDemoData() {
    try {
      // Fetch active demo session
      const { data: sessions } = await supabase
        .from("demo_sessions")
        .select("*")
        .eq("company_id", DEMO_COMPANY_ID)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1);

      const activeSession = sessions?.[0] || null;
      setSession(activeSession as DemoSession | null);

      // Fetch conversation stats
      const { count: totalCount } = await supabase
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .eq("company_id", DEMO_COMPANY_ID);

      const { count: activeCount } = await supabase
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .eq("company_id", DEMO_COMPANY_ID)
        .eq("status", "active");

      setStats({
        total: totalCount || 0,
        active: activeCount || 0,
      });

      // Fetch recent messages across all demo conversations
      const { data: convos } = await supabase
        .from("conversations")
        .select("id")
        .eq("company_id", DEMO_COMPANY_ID)
        .order("created_at", { ascending: false })
        .limit(5);

      if (convos?.length) {
        const convoIds = convos.map((c) => c.id);
        const { data: msgs } = await supabase
          .from("messages")
          .select("id, role, content, created_at, conversation_id")
          .in("conversation_id", convoIds)
          .order("created_at", { ascending: false })
          .limit(30);

        setMessages((msgs as RecentMessage[]) || []);
      }
    } catch (err) {
      console.error("Demo fetch error:", err);
    } finally {
      setLoading(false);
    }
  }

  const waLink = `https://wa.me/${DEMO_WHATSAPP.replace("+", "")}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(waLink)}&bgcolor=0B0B0B&color=84CC16`;

  const expiresIn = session
    ? Math.max(
        0,
        Math.round(
          (new Date(session.expires_at).getTime() - Date.now()) / 3600000
        )
      )
    : 0;

  const rd = (session?.researched_data || {}) as Record<string, string>;

  // Group messages by conversation for display
  const messagesByConvo: Record<string, RecentMessage[]> = {};
  messages.forEach((m) => {
    if (!messagesByConvo[m.conversation_id])
      messagesByConvo[m.conversation_id] = [];
    messagesByConvo[m.conversation_id].push(m);
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
        <div className="relative max-w-6xl mx-auto px-6 py-12 md:py-20">
          <div className="flex items-center gap-3 mb-6">
            <img
              src={omanutLogo}
              alt="Omanut AI"
              className="h-10 w-auto rounded-lg"
            />
            <span className="text-sm font-medium text-muted-foreground tracking-wide uppercase">
              Live Demo
            </span>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            AI Receptionist —{" "}
            <span className="text-primary">Live in Action</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mb-8">
            Text our demo number and experience an AI that instantly becomes any
            company's receptionist. Real research. Real conversations. Real
            results.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-xl font-semibold hover:opacity-90 transition-opacity"
            >
              <MessageSquare className="w-5 h-5" />
              Text the Demo
              <ArrowRight className="w-4 h-4" />
            </a>
            <div className="flex items-center gap-3 text-muted-foreground text-sm">
              <Phone className="w-4 h-4" />
              <span className="font-mono">{DEMO_WHATSAPP}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        {/* Status + Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Active Demo Card */}
          <Card className="md:col-span-2 border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-primary" />
                  Current Demo
                </CardTitle>
                {session ? (
                  <Badge
                    variant="default"
                    className="bg-primary/10 text-primary border-primary/20"
                  >
                    <Zap className="w-3 h-3 mr-1" />
                    Active
                  </Badge>
                ) : (
                  <Badge variant="secondary">Inactive</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {session ? (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-2xl font-bold">
                      {session.demo_company_name}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {rd.business_type || "Business"} •{" "}
                      {rd.hours || "Standard hours"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="w-3.5 h-3.5" />
                      Expires in ~{expiresIn}h
                    </div>
                    {session.custom_persona && (
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Sparkles className="w-3.5 h-3.5" />
                        Persona: {session.custom_persona}
                      </div>
                    )}
                  </div>
                  {rd.services && (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">
                        Services:
                      </span>{" "}
                      {rd.services}
                    </p>
                  )}
                  {rd.quick_reference_info && (
                    <p className="text-sm text-muted-foreground italic">
                      {rd.quick_reference_info}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  No demo currently active. The boss can start one by texting{" "}
                  <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">
                    DEMO [Company Name]
                  </code>{" "}
                  to the demo number.
                </p>
              )}
            </CardContent>
          </Card>

          {/* QR Code */}
          <Card className="border-border flex flex-col items-center justify-center p-6">
            <img
              src={qrUrl}
              alt="Scan to chat"
              className="w-36 h-36 rounded-lg mb-3"
            />
            <p className="text-sm text-muted-foreground text-center">
              Scan to chat on WhatsApp
            </p>
          </Card>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatMini
            icon={MessageSquare}
            label="Total Conversations"
            value={stats.total}
          />
          <StatMini
            icon={Users}
            label="Active Now"
            value={stats.active}
          />
          <StatMini
            icon={Bot}
            label="AI Responses"
            value={messages.filter((m) => m.role === "assistant").length}
          />
          <StatMini
            icon={UserCheck}
            label="Handoffs"
            value={0}
          />
        </div>

        {/* Live Conversation Feed */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-accent" />
              Recent Conversations
              {messages.length > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  Live
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : messages.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Bot className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No conversations yet.</p>
                <p className="text-sm mt-1">
                  Text the demo number to start the first one!
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-3">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex gap-3 ${
                        msg.role === "assistant" ? "" : "flex-row-reverse"
                      }`}
                    >
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                          msg.role === "assistant"
                            ? "bg-primary/10 text-primary"
                            : "bg-accent/10 text-accent"
                        }`}
                      >
                        {msg.role === "assistant" ? (
                          <Bot className="w-3.5 h-3.5" />
                        ) : (
                          <Users className="w-3.5 h-3.5" />
                        )}
                      </div>
                      <div
                        className={`max-w-[75%] rounded-xl px-4 py-2.5 text-sm ${
                          msg.role === "assistant"
                            ? "bg-card border border-border"
                            : "bg-primary/10 text-foreground"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* How It Works */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg">How It Works</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Step
                num={1}
                title="Boss Sets Demo"
                desc="The business owner texts 'DEMO [Company Name]' to the demo number. The AI instantly researches the company."
              />
              <Step
                num={2}
                title="Customers Text In"
                desc="Anyone can text the demo number. The AI responds as that company's receptionist — handling bookings, pricing, FAQs."
              />
              <Step
                num={3}
                title="Human Handoff"
                desc="When the AI can't help, it seamlessly transfers to a real person and notifies the boss with full context."
              />
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center py-8 text-muted-foreground text-sm">
          <p>
            Powered by{" "}
            <span className="text-primary font-semibold">Omanut AI</span> •
            Instant AI receptionist for any business
          </p>
        </div>
      </div>
    </div>
  );
}

function StatMini({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MessageSquare;
  label: string;
  value: number;
}) {
  return (
    <Card className="border-border">
      <CardContent className="p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Step({
  num,
  title,
  desc,
}: {
  num: number;
  title: string;
  desc: string;
}) {
  return (
    <div className="space-y-2">
      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-sm">
        {num}
      </div>
      <h4 className="font-semibold">{title}</h4>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
