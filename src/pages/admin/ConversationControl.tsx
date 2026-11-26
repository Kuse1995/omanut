import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { logAdminAction } from "@/lib/adminAudit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";

interface Conversation {
  id: string;
  company_id: string;
  customer_name: string | null;
  phone: string | null;
  status: string;
  human_takeover: boolean | null;
  takeover_at: string | null;
  takeover_by: string | null;
  paused_reason: string | null;
  paused_until: string | null;
  last_message_at: string | null;
}

interface MessageItem {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export default function ConversationControl() {
  const { id } = useParams<{ id: string }>();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState<number>(60);

  async function load() {
    if (!id) return;
    setLoading(true);
    const [{ data, error }, { data: msgRows }] = await Promise.all([
      supabase
        .from("conversations")
        .select(
          "id, company_id, customer_name, phone, status, human_takeover, takeover_at, takeover_by, paused_reason, paused_until, last_message_at"
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (error) toast.error(error.message);
    const convRow = (data as Conversation | null) ?? null;
    setConv(convRow);
    setReason(convRow?.paused_reason ?? "");
    setMessages(((msgRows || []) as MessageItem[]).reverse());
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function pause() {
    if (!conv) return;
    const until = minutes > 0 ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("conversations")
      .update({
        human_takeover: true,
        is_paused_for_human: true,
        takeover_at: new Date().toISOString(),
        takeover_by: u.user?.id ?? null,
        paused_reason: reason || null,
        paused_until: until,
      })
      .eq("id", conv.id);
    if (error) return toast.error(error.message);

    await logAdminAction({
      eventType: "admin_conversation_paused",
      companyId: conv.company_id,
      message: `Paused AI on conversation ${conv.id}`,
      details: { conversation_id: conv.id, minutes, reason: reason || null },
    });

    toast.success("Conversation paused");
    load();
  }

  async function resume() {
    if (!conv) return;
    const { error } = await supabase
      .from("conversations")
      .update({
        human_takeover: false,
        is_paused_for_human: false,
        takeover_at: null,
        takeover_by: null,
        paused_reason: null,
        paused_until: null,
      })
      .eq("id", conv.id);
    if (error) return toast.error(error.message);

    await logAdminAction({
      eventType: "admin_conversation_resumed",
      companyId: conv.company_id,
      message: `Resumed AI on conversation ${conv.id}`,
      details: { conversation_id: conv.id },
    });

    toast.success("AI resumed");
    load();
  }

  const paused = !!conv?.human_takeover;

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto w-full">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            Loading conversation…
          </div>
        ) : !conv ? (
          <div className="space-y-4">
            <Link to="/admin/dashboard?tab=conversations">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" /> Back to Conversations
              </Button>
            </Link>
            <div className="text-sm text-muted-foreground">Conversation not found.</div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <Link to={`/admin/dashboard?company=${conv.company_id}&tab=conversations&conv=${conv.id}`}>
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-semibold">Conversation Control</h1>
                <p className="text-xs text-muted-foreground">
                  {conv.customer_name || conv.phone || conv.id}
                </p>
              </div>
              <Badge className="ml-auto" variant={paused ? "secondary" : "default"}>
                {paused ? "Paused (human takeover)" : "AI active"}
              </Badge>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <Card className="p-4 space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Customer:</span> {conv.customer_name ?? "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Phone / Handle:</span> {conv.phone ?? "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status:</span> {conv.status}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last message:</span>{" "}
                    {conv.last_message_at ? new Date(conv.last_message_at).toLocaleString() : "—"}
                  </div>
                  {paused && (
                    <>
                      <div>
                        <span className="text-muted-foreground">Paused at:</span>{" "}
                        {conv.takeover_at ? new Date(conv.takeover_at).toLocaleString() : "—"}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Paused until:</span>{" "}
                        {conv.paused_until ? new Date(conv.paused_until).toLocaleString() : "manual resume"}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Reason:</span> {conv.paused_reason ?? "—"}
                      </div>
                    </>
                  )}
                </Card>

                <Card className="p-4 space-y-3">
                  <div className="text-sm font-medium">
                    {paused ? "Update or resume" : "Pause AI for this conversation"}
                  </div>
                  <textarea
                    className="w-full text-sm border border-border bg-background rounded-md p-2 min-h-[80px]"
                    placeholder="Reason (optional)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="flex items-center gap-2 text-sm">
                    <label className="text-muted-foreground">Auto-resume in</label>
                    <input
                      type="number"
                      min={0}
                      className="w-20 border border-border bg-background rounded-md px-2 py-1"
                      value={minutes}
                      onChange={(e) => setMinutes(parseInt(e.target.value || "0", 10))}
                    />
                    <span className="text-muted-foreground">minutes (0 = manual)</span>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={pause}>{paused ? "Update pause" : "Pause AI"}</Button>
                    {paused && (
                      <Button variant="outline" onClick={resume}>
                        Resume AI
                      </Button>
                    )}
                  </div>
                </Card>
              </div>

              <Card className="p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    Recent Transcript ({messages.length})
                  </div>
                  <Link
                    to={`/admin/dashboard?company=${conv.company_id}&tab=conversations&conv=${conv.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Open in Inbox →
                  </Link>
                </div>
                <ScrollArea className="h-[360px] pr-3">
                  <div className="space-y-2.5">
                    {messages.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No messages recorded.</p>
                    ) : (
                      messages.map((m) => (
                        <div
                          key={m.id}
                          className={`p-2.5 rounded-lg text-xs ${
                            m.role === "user"
                              ? "bg-muted mr-8"
                              : "bg-primary/10 border border-primary/20 ml-8"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                            <span className="font-semibold uppercase">{m.role}</span>
                            <span>{new Date(m.created_at).toLocaleString()}</span>
                          </div>
                          <p className="whitespace-pre-wrap">{m.content}</p>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </Card>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
