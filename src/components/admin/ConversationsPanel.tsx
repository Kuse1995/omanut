import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/context/CompanyContext";
import { logAdminAction } from "@/lib/adminAudit";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Search,
  Send,
  MessageCircle,
  Bot,
  UserCog,
  Headset,
  TrendingUp,
  UserCircle,
  Loader2,
  ChevronDown,
  Facebook,
  MessageSquare,
  Instagram,
  PauseCircle,
  PlayCircle,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { ChatBubble } from "@/components/conversations/ChatBubble";
import { DateDivider } from "@/components/conversations/DateDivider";
import { AITraceDrawer, FocusedMessage } from "@/components/admin/AITraceDrawer";
import { useToast } from "@/hooks/use-toast";

interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
  message_metadata?: Record<string, unknown> | null;
}

interface ConversationSummary {
  id: string;
  customer_name: string | null;
  phone: string | null;
  started_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  human_takeover: boolean | null;
  paused_reason: string | null;
  paused_until: string | null;
  active_agent: string | null;
  unread_count: number | null;
  pinned: boolean | null;
  archived: boolean | null;
  platform: string;
}

type ChannelFilter =
  | "all"
  | "unread"
  | "takeover"
  | "whatsapp"
  | "instagram_dm"
  | "messenger"
  | "facebook";

export const ConversationsPanel = () => {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    () => searchParams.get("conv")
  );
  const [activeMessages, setActiveMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ChannelFilter>("all");
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const [pausePopoverOpen, setPausePopoverOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [pauseMinutes, setPauseMinutes] = useState<number>(60);
  const [updatingPause, setUpdatingPause] = useState(false);

  const [traceOpen, setTraceOpen] = useState(false);
  const [focusedMessage, setFocusedMessage] = useState<FocusedMessage | null>(null);
  const [priorUserMessage, setPriorUserMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lastConversationIdRef = useRef<string | null>(null);
  const isNearBottomRef = useRef(true);
  const convDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchConversations = useCallback(
    async (silent = false) => {
      if (!selectedCompany?.id) return;
      if (!silent) setLoading(true);

      const { data: convData, error } = await supabase
        .from("conversations")
        .select(
          "id, customer_name, phone, started_at, last_message_at, last_message_preview, human_takeover, paused_reason, paused_until, active_agent, unread_count, pinned, archived, platform"
        )
        .eq("company_id", selectedCompany.id)
        .eq("archived", false)
        .order("pinned", { ascending: false })
        .order("last_message_at", { ascending: false })
        .limit(80);

      if (error) {
        console.error("Error fetching conversations:", error);
        if (!silent) setLoading(false);
        return;
      }

      const list = (convData || []) as ConversationSummary[];
      setConversations(list);

      const urlConv = searchParams.get("conv");
      if (urlConv && list.some((c) => c.id === urlConv)) {
        setSelectedConversationId(urlConv);
      } else if (!selectedConversationId && list.length > 0) {
        setSelectedConversationId(list[0].id);
      }

      if (!silent) setLoading(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedCompany?.id]
  );

  const fetchMessages = useCallback(async (convId: string, silent = false) => {
    if (!convId) return;
    if (!silent) setLoadingMessages(true);
    const { data, error } = await supabase
      .from("messages")
      .select("id, conversation_id, role, content, created_at, message_metadata")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (!error) {
      setActiveMessages((data || []) as Message[]);
    }
    if (!silent) setLoadingMessages(false);
  }, []);

  // Load conversations on company change + filtered realtime subscription
  useEffect(() => {
    if (!selectedCompany?.id) return;
    setSelectedConversationId(searchParams.get("conv"));
    setActiveMessages([]);
    fetchConversations(false);

    const channel = supabase
      .channel(`admin-convs-${selectedCompany.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `company_id=eq.${selectedCompany.id}`,
        },
        () => {
          if (convDebounceRef.current) clearTimeout(convDebounceRef.current);
          convDebounceRef.current = setTimeout(() => {
            fetchConversations(true);
          }, 350);
        }
      )
      .subscribe();

    return () => {
      if (convDebounceRef.current) clearTimeout(convDebounceRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany?.id]);

  // Load messages for selected conversation + filtered realtime subscription
  useEffect(() => {
    if (!selectedConversationId) {
      setActiveMessages([]);
      return;
    }

    fetchMessages(selectedConversationId, false);

    const channel = supabase
      .channel(`admin-msgs-${selectedConversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedConversationId}`,
        },
        () => {
          if (msgDebounceRef.current) clearTimeout(msgDebounceRef.current);
          msgDebounceRef.current = setTimeout(() => {
            fetchMessages(selectedConversationId, true);
          }, 200);
        }
      )
      .subscribe();

    return () => {
      if (msgDebounceRef.current) clearTimeout(msgDebounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [selectedConversationId, fetchMessages]);

  // Auto-scroll on conversation switch or new messages near bottom
  useEffect(() => {
    if (!selectedConversationId) return;
    if (lastConversationIdRef.current !== selectedConversationId) {
      lastConversationIdRef.current = selectedConversationId;
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      }, 0);
    } else if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [selectedConversationId, activeMessages]);

  const handleSelectConversation = (convId: string) => {
    setSelectedConversationId(convId);
    const next = new URLSearchParams(searchParams);
    next.set("conv", convId);
    setSearchParams(next, { replace: true });
  };

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 100;
    setShowScrollButton(distanceFromBottom > 200);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const selectedConversation = conversations.find((c) => c.id === selectedConversationId);

  const getChannelKind = (conv: ConversationSummary): "whatsapp" | "instagram_dm" | "messenger" | "facebook" => {
    const p = conv.phone || "";
    if (p.startsWith("igdm:")) return "instagram_dm";
    if (p.startsWith("fbdm:")) return "messenger";
    if (p.startsWith("fb:")) return "facebook";
    return "whatsapp";
  };

  const filteredConversations = conversations.filter((conv) => {
    const matchesSearch =
      !search.trim() ||
      conv.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      conv.phone?.toLowerCase().includes(search.toLowerCase()) ||
      conv.last_message_preview?.toLowerCase().includes(search.toLowerCase());

    const kind = getChannelKind(conv);
    const matchesFilter =
      filter === "all"
        ? true
        : filter === "unread"
        ? (conv.unread_count ?? 0) > 0
        : filter === "takeover"
        ? !!conv.human_takeover
        : kind === filter;

    return matchesSearch && matchesFilter;
  });

  const sendMessage = async () => {
    if (!selectedConversation || !selectedCompany || !messageInput.trim()) return;
    const text = messageInput.trim();
    setSending(true);

    try {
      const phone = selectedConversation.phone || "";

      if (phone.startsWith("fbdm:") || phone.startsWith("igdm:")) {
        const { data, error } = await supabase.functions.invoke("send-meta-dm", {
          body: {
            conversationId: selectedConversation.id,
            text,
            sent_by: "admin",
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
      } else if (phone.startsWith("fb:")) {
        // Resolve comment_id from thread metadata or latest facebook_comments
        let commentId: string | null = null;
        for (let i = activeMessages.length - 1; i >= 0; i--) {
          const metaCommentId = activeMessages[i]?.message_metadata?.comment_id;
          if (metaCommentId) {
            commentId = String(metaCommentId);
            break;
          }
        }
        if (!commentId) {
          const senderId = phone.replace(/^fb:/, "");
          const { data: fbComment } = await supabase
            .from("facebook_comments")
            .select("comment_id")
            .eq("company_id", selectedCompany.id)
            .eq("commenter_id", senderId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          commentId = fbComment?.comment_id || null;
        }
        if (!commentId) {
          toast({
            title: "Cannot resolve Facebook comment ID",
            description: "No comment_id metadata found on this thread. Reply from Meta Inbox or wait for a fresh comment.",
            variant: "destructive",
          });
          setSending(false);
          return;
        }

        const { data, error } = await supabase.functions.invoke("send-facebook-comment-reply", {
          body: {
            comment_id: commentId,
            message: text,
            company_id: selectedCompany.id,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        await supabase.from("messages").insert({
          conversation_id: selectedConversation.id,
          role: "assistant",
          content: text,
          message_metadata: {
            source: "facebook",
            sent_by: "admin",
            comment_id: commentId,
            reply_id: data?.comment_id || null,
          },
        });
      } else {
        const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
          body: {
            phone,
            message: text,
            conversationId: selectedConversation.id,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
      }

      setMessageInput("");
      toast({ title: "Message sent" });
      fetchMessages(selectedConversation.id, true);
      fetchConversations(true);
    } catch (error: unknown) {
      console.error("Error sending message:", error);
      toast({
        title: "Failed to send",
        description: error instanceof Error ? error.message : "Could not send message",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const handlePauseAI = async () => {
    if (!selectedConversation || !selectedCompany) return;
    setUpdatingPause(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const until =
        pauseMinutes > 0 ? new Date(Date.now() + pauseMinutes * 60_000).toISOString() : null;

      const { error } = await supabase
        .from("conversations")
        .update({
          human_takeover: true,
          is_paused_for_human: true,
          takeover_at: new Date().toISOString(),
          takeover_by: u.user?.id ?? null,
          paused_reason: pauseReason.trim() || null,
          paused_until: until,
        })
        .eq("id", selectedConversation.id);

      if (error) throw error;

      await logAdminAction({
        eventType: "admin_conversation_paused",
        companyId: selectedCompany.id,
        message: `Paused AI on conversation ${selectedConversation.id} (${pauseMinutes > 0 ? `${pauseMinutes}m` : "manual"})`,
        details: {
          conversation_id: selectedConversation.id,
          minutes: pauseMinutes,
          reason: pauseReason.trim() || null,
        },
      });

      setPausePopoverOpen(false);
      setPauseReason("");
      toast({ title: "AI paused (human takeover active)" });
      fetchConversations(true);
    } catch (err: unknown) {
      toast({
        title: "Failed to pause AI",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setUpdatingPause(false);
    }
  };

  const handleResumeAI = async () => {
    if (!selectedConversation || !selectedCompany) return;
    setUpdatingPause(true);
    try {
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
        .eq("id", selectedConversation.id);

      if (error) throw error;

      await logAdminAction({
        eventType: "admin_conversation_resumed",
        companyId: selectedCompany.id,
        message: `Resumed AI on conversation ${selectedConversation.id}`,
        details: { conversation_id: selectedConversation.id },
      });

      toast({ title: "AI resumed" });
      fetchConversations(true);
    } catch (err: unknown) {
      toast({
        title: "Failed to resume AI",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setUpdatingPause(false);
    }
  };

  const openTraceForTurn = (msg?: Message, idx?: number) => {
    let priorUser: string | null = null;
    if (typeof idx === "number") {
      for (let i = idx - 1; i >= 0; i--) {
        if (activeMessages[i]?.role === "user") {
          priorUser = activeMessages[i].content;
          break;
        }
      }
    } else {
      for (let i = activeMessages.length - 1; i >= 0; i--) {
        if (activeMessages[i]?.role === "user") {
          priorUser = activeMessages[i].content;
          break;
        }
      }
    }
    setFocusedMessage(msg || null);
    setPriorUserMessage(priorUser);
    setTraceOpen(true);
  };

  const getInitials = (conv: ConversationSummary) => {
    if (conv.customer_name) return conv.customer_name.substring(0, 2).toUpperCase();
    return conv.phone?.substring(0, 2) || "??";
  };

  const getAgentBadge = (conv: ConversationSummary) => {
    if (conv.human_takeover) {
      return (
        <Badge variant="secondary" className="h-5 text-[10px] gap-1 border-amber-500/30 bg-amber-500/10 text-amber-500">
          <UserCog className="h-3 w-3" />
          Human
        </Badge>
      );
    }
    switch (conv.active_agent) {
      case "support":
        return (
          <Badge className="h-5 text-[10px] gap-1 bg-blue-500/10 text-blue-400 border-blue-500/20">
            <Headset className="h-3 w-3" />
            Support
          </Badge>
        );
      case "sales":
        return (
          <Badge className="h-5 text-[10px] gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
            <TrendingUp className="h-3 w-3" />
            Sales
          </Badge>
        );
      case "boss":
        return (
          <Badge className="h-5 text-[10px] gap-1 bg-amber-500/10 text-amber-400 border-amber-500/20">
            <UserCircle className="h-3 w-3" />
            Boss
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="h-5 text-[10px] gap-1">
            <Bot className="h-3 w-3" />
            AI
          </Badge>
        );
    }
  };

  const renderChannelAvatarBadge = (conv: ConversationSummary) => {
    const kind = getChannelKind(conv);
    if (kind === "instagram_dm") {
      return (
        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-pink-600 rounded-full border-2 border-card flex items-center justify-center">
          <Instagram className="h-2.5 w-2.5 text-white" />
        </div>
      );
    }
    if (kind === "messenger") {
      return (
        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-violet-600 rounded-full border-2 border-card flex items-center justify-center">
          <MessageSquare className="h-2.5 w-2.5 text-white" />
        </div>
      );
    }
    if (kind === "facebook") {
      return (
        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-blue-600 rounded-full border-2 border-card flex items-center justify-center">
          <Facebook className="h-2.5 w-2.5 text-white" />
        </div>
      );
    }
    return (
      <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-emerald-500 rounded-full border-2 border-card flex items-center justify-center">
        <MessageCircle className="h-2.5 w-2.5 text-white" />
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <MessageCircle className="h-16 w-16 mb-4 opacity-30" />
        <p>No conversations yet</p>
      </div>
    );
  }

  return (
    <>
      <ResizablePanelGroup direction="horizontal" className="h-full">
        {/* Left Panel - Conversation List */}
        <ResizablePanel defaultSize={34} minSize={24} maxSize={45}>
          <div className="flex flex-col h-full min-h-0 border-r border-border">
            {/* Search */}
            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search name, phone, or preview..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 bg-secondary/50 border-0 h-9 text-sm"
                />
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-1 p-2 border-b border-border bg-secondary/30">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "unread", label: "Unread" },
                  { id: "takeover", label: "Human" },
                ] as const
              ).map((f) => (
                <Button
                  key={f.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    "h-7 px-2.5 text-xs",
                    filter === f.id && "bg-primary text-primary-foreground hover:bg-primary/90"
                  )}
                >
                  {f.label}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilter("whatsapp")}
                title="WhatsApp"
                className={cn(
                  "h-7 px-2 text-xs gap-1",
                  filter === "whatsapp" && "bg-emerald-600 text-white hover:bg-emerald-700"
                )}
              >
                <MessageCircle className="h-3 w-3" />
                WA
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilter("instagram_dm")}
                title="Instagram DM"
                className={cn(
                  "h-7 px-2 text-xs gap-1",
                  filter === "instagram_dm" && "bg-pink-600 text-white hover:bg-pink-700"
                )}
              >
                <Instagram className="h-3 w-3" />
                IG
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilter("messenger")}
                title="Facebook Messenger"
                className={cn(
                  "h-7 px-2 text-xs gap-1",
                  filter === "messenger" && "bg-violet-600 text-white hover:bg-violet-700"
                )}
              >
                <MessageSquare className="h-3 w-3" />
                DM
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilter("facebook")}
                title="Facebook Comments"
                className={cn(
                  "h-7 px-2 text-xs gap-1",
                  filter === "facebook" && "bg-blue-600 text-white hover:bg-blue-700"
                )}
              >
                <Facebook className="h-3 w-3" />
              </Button>
            </div>

            {/* List */}
            <ScrollArea className="flex-1">
              <div className="divide-y divide-border/50">
                {filteredConversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv.id)}
                    className={cn(
                      "p-3 cursor-pointer transition-all hover:bg-accent/50",
                      selectedConversationId === conv.id && "bg-accent border-l-2 border-l-primary"
                    )}
                  >
                    <div className="flex gap-3">
                      <div className="relative shrink-0">
                        <Avatar className="h-10 w-10">
                          <AvatarFallback
                            className={cn(
                              "text-sm font-semibold",
                              selectedConversationId === conv.id
                                ? "bg-primary text-primary-foreground"
                                : "bg-primary/10 text-primary"
                            )}
                          >
                            {getInitials(conv)}
                          </AvatarFallback>
                        </Avatar>
                        {renderChannelAvatarBadge(conv)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-0.5">
                          <span className="font-medium text-sm truncate">
                            {conv.customer_name || conv.phone || "Unknown"}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                            {formatDistanceToNow(new Date(conv.last_message_at || conv.started_at), {
                              addSuffix: false,
                            })}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mb-1">
                          {conv.last_message_preview || "Open thread to view messages"}
                        </p>
                        <div className="flex items-center justify-between">
                          {getAgentBadge(conv)}
                          {(conv.unread_count ?? 0) > 0 && (
                            <Badge className="h-5 min-w-5 px-1.5 rounded-full text-[10px]">
                              {conv.unread_count}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right Panel - Chat View */}
        <ResizablePanel defaultSize={66}>
          {selectedConversation ? (
            <div className="flex flex-col h-full min-h-0 relative">
              {/* Header */}
              <div className="flex items-center justify-between gap-2 p-3.5 border-b border-border bg-card/50 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback className="bg-primary text-primary-foreground font-semibold text-xs">
                      {getInitials(selectedConversation)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm truncate">
                        {selectedConversation.customer_name || selectedConversation.phone}
                      </h3>
                      {getAgentBadge(selectedConversation)}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {selectedConversation.phone}
                      {selectedConversation.human_takeover && selectedConversation.paused_until
                        ? ` · resumes ${formatDistanceToNow(new Date(selectedConversation.paused_until), {
                            addSuffix: true,
                          })}`
                        : ""}
                    </p>
                  </div>
                </div>

                {/* Inline Takeover & X-Ray Controls */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {selectedConversation.human_takeover ? (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={handleResumeAI}
                      disabled={updatingPause}
                      className="h-8 text-xs gap-1"
                    >
                      {updatingPause ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <PlayCircle className="h-3.5 w-3.5" />
                      )}
                      Resume AI
                    </Button>
                  ) : (
                    <Popover open={pausePopoverOpen} onOpenChange={setPausePopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button size="sm" variant="outline" className="h-8 text-xs gap-1">
                          <PauseCircle className="h-3.5 w-3.5 text-amber-500" />
                          Pause AI
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 space-y-3" align="end">
                        <div className="space-y-1">
                          <div className="text-xs font-semibold">Pause AI / Human Takeover</div>
                          <p className="text-[11px] text-muted-foreground">
                            Stops automated replies while an operator responds.
                          </p>
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          {[
                            { label: "30m", mins: 30 },
                            { label: "1h", mins: 60 },
                            { label: "4h", mins: 240 },
                            { label: "Manual", mins: 0 },
                          ].map((preset) => (
                            <Button
                              key={preset.label}
                              type="button"
                              size="sm"
                              variant={pauseMinutes === preset.mins ? "default" : "outline"}
                              className="h-7 px-2.5 text-xs"
                              onClick={() => setPauseMinutes(preset.mins)}
                            >
                              {preset.label}
                            </Button>
                          ))}
                        </div>
                        <Textarea
                          placeholder="Reason (optional)"
                          value={pauseReason}
                          onChange={(e) => setPauseReason(e.target.value)}
                          className="text-xs min-h-[60px]"
                        />
                        <Button
                          size="sm"
                          className="w-full h-8 text-xs"
                          onClick={handlePauseAI}
                          disabled={updatingPause}
                        >
                          {updatingPause ? "Pausing…" : "Confirm Pause"}
                        </Button>
                      </PopoverContent>
                    </Popover>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1"
                    onClick={() => openTraceForTurn()}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    AI X-Ray
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    title="Full Conversation Control"
                    onClick={() =>
                      navigate(`/admin/conversations/${selectedConversation.id}/control`)
                    }
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Messages */}
              <div
                className="flex-1 min-h-0 overflow-y-auto p-4"
                ref={scrollAreaRef}
                onScroll={handleScroll}
              >
                {loadingMessages ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-0 max-w-3xl mx-auto">
                    {activeMessages.map((message, idx) => {
                      const showDateDivider =
                        idx === 0 ||
                        format(new Date(message.created_at), "yyyy-MM-dd") !==
                          format(new Date(activeMessages[idx - 1].created_at), "yyyy-MM-dd");

                      const prevMsg = idx > 0 ? activeMessages[idx - 1] : null;
                      const nextMsg = idx < activeMessages.length - 1 ? activeMessages[idx + 1] : null;

                      const timeDiffFromPrev = prevMsg
                        ? (new Date(message.created_at).getTime() -
                            new Date(prevMsg.created_at).getTime()) /
                          1000 /
                          60
                        : Infinity;
                      const timeDiffToNext = nextMsg
                        ? (new Date(nextMsg.created_at).getTime() -
                            new Date(message.created_at).getTime()) /
                          1000 /
                          60
                        : Infinity;

                      const isFirstInGroup =
                        showDateDivider ||
                        !prevMsg ||
                        prevMsg.role !== message.role ||
                        timeDiffFromPrev > 2;
                      const isLastInGroup =
                        !nextMsg ||
                        nextMsg.role !== message.role ||
                        timeDiffToNext > 2 ||
                        format(new Date(nextMsg.created_at), "yyyy-MM-dd") !==
                          format(new Date(message.created_at), "yyyy-MM-dd");

                      return (
                        <div key={message.id} className="group relative">
                          {showDateDivider && <DateDivider date={message.created_at} />}
                          <div className="relative">
                            <ChatBubble
                              content={message.content}
                              role={message.role as "user" | "assistant"}
                              timestamp={message.created_at}
                              metadata={message.message_metadata}
                              isFirstInGroup={isFirstInGroup}
                              isLastInGroup={isLastInGroup}
                              showTimestamp={true}
                            />
                            {message.role === "assistant" && (
                              <button
                                type="button"
                                onClick={() => openTraceForTurn(message, idx)}
                                title="Inspect AI X-Ray for this turn"
                                className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity absolute top-1 right-1 p-1 rounded bg-background/80 border border-border text-muted-foreground hover:text-primary shadow-sm"
                              >
                                <Sparkles className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Scroll to bottom button */}
              {showScrollButton && (
                <Button
                  size="icon"
                  variant="secondary"
                  className="absolute bottom-24 right-6 h-10 w-10 rounded-full shadow-lg z-10"
                  onClick={scrollToBottom}
                >
                  <ChevronDown className="h-5 w-5" />
                </Button>
              )}

              {/* Input */}
              <div className="p-4 border-t border-border bg-card/50">
                <div className="flex gap-2">
                  <Input
                    placeholder={`Reply via ${
                      selectedConversation.phone?.startsWith("igdm:")
                        ? "Instagram DM"
                        : selectedConversation.phone?.startsWith("fbdm:")
                        ? "Messenger"
                        : selectedConversation.phone?.startsWith("fb:")
                        ? "Facebook Comment"
                        : "WhatsApp"
                    }...`}
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                    className="flex-1"
                    disabled={sending}
                  />
                  <Button onClick={sendMessage} disabled={sending || !messageInput.trim()}>
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <MessageCircle className="h-16 w-16 mb-4 opacity-30" />
              <p>Select a conversation to view messages</p>
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>

      {selectedCompany && selectedConversation && (
        <AITraceDrawer
          open={traceOpen}
          onOpenChange={setTraceOpen}
          companyId={selectedCompany.id}
          conversationId={selectedConversation.id}
          focusedMessage={focusedMessage}
          priorUserMessage={priorUserMessage}
        />
      )}
    </>
  );
};
