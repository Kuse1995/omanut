import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Send, Sparkles, Video, PenLine, Loader2, Paperclip, X, Images, PanelLeft, Settings, FileText, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCompany } from "@/context/CompanyContext";
import { supabase } from "@/integrations/supabase/client";
import omanutLogo from "@/assets/omanut-logo-new.png";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: { url: string; type: "image" | "video" }[];
  action?: { type: string | null; job_id?: string | null; post_id?: string | null; connect_url?: string; state?: string; saved?: string[]; filename?: string } | null;
}

const QUICK_ACTIONS = [
  { label: "How much is the Pro plan?", prompt: "How much is the Pro plan?" },
  { label: "Make a video ad", prompt: "Make a video ad for our best-selling product" },
  { label: "Draft a post", prompt: "Draft a Facebook post about our free Saturday training" },
  { label: "What can you do?", prompt: "What can you do for my business?" },
];

const AgentConsole = () => {
  const { selectedCompany, refreshCompanies, isLoading: companyLoading } = useCompany();
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachedUrl, setAttachedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [postMedia, setPostMedia] = useState<{ url: string; type: "image" | "video"; name?: string } | null>(null);
  // The last media the owner shared — lets a follow-up "post it" refer back to
  // it even though the composer chip cleared when that message was sent.
  const [lastPostMedia, setLastPostMedia] = useState<{ url: string; type: "image" | "video" } | null>(null);
  const [docUploading, setDocUploading] = useState(false);
  const [postMediaUploading, setPostMediaUploading] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [mediaItems, setMediaItems] = useState<{ name: string; url: string; type: "image" | "video" | "file" }[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<{ id: string; title: string; updated_at: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const postMediaInputRef = useRef<HTMLInputElement>(null);
  // The company the chat is working with — null while we're still onboarding
  // a brand-new owner (the agent creates the company mid-conversation).
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(selectedCompany?.id || null);
  // CompanyContext resolves asynchronously — keep the chat's company in sync
  // once it lands (a logged-in owner must never fall into onboarding mode).
  useEffect(() => {
    if (selectedCompany?.id) setActiveCompanyId(selectedCompany.id);
  }, [selectedCompany?.id]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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

  // Load the persistent ChatGPT-style thread on mount (server owns history).
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("agent-console", {
          body: { message: "", history_only: true, company_id: activeCompanyId },
        });
        if (data?.thread?.length) {
          setMessages(data.thread.map((m: any) => ({ role: m.role, content: m.content, attachments: Array.isArray(m.attachments) && m.attachments.length ? m.attachments : undefined })));
        }
      } catch { /* thread load is best-effort */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, activeCompanyId]);

  if (authLoading || companyLoading) {
    // Wait for BOTH the session and the company context before rendering, so a
    // signed-in owner never glimpses (or lands in) onboarding mode.
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // Guest mode: the agent console IS the public homepage, so signed-out
  // visitors can chat and get onboarded. No selectedCompany = self-serve
  // onboarding mode: the agent runs without a company and prompts sign-up
  // when it's time to create/save one.
  const isGuest = !session;

  const uploadReference = async (file: File) => {
    if (!selectedCompany) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      // First path segment MUST be the company UUID — company-media storage
      // policies cast it (user_has_company_access(foldername[1])::uuid).
      const path = `${selectedCompany.id}/references/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("company-media").upload(path, file, { upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("company-media").getPublicUrl(path);
      setAttachedUrl(data.publicUrl);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Image upload failed: " + (e?.message || "unknown error") }]);
    } finally {
      setUploading(false);
    }
  };

  // Knowledge document upload — stored to company-documents + parsed by
  // parse-document, so the agent can answer from it (searchKnowledgeBase
  // reads company_documents.parsed_content).
  const uploadKnowledgeDocument = async (file: File) => {
    if (!selectedCompany) return;
    const allowed = ["application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv", "text/plain"];
    if (!allowed.includes(file.type)) {
      setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ That file type isn't supported for knowledge. Upload PDF, Word, Excel, CSV, or text." }]);
      return;
    }
    setDocUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      // company-documents bucket policy keys on the first path segment = user id.
      const filePath = user.id + "/" + Date.now() + "-" + file.name;
      const { error: upErr } = await supabase.storage.from("company-documents").upload(filePath, file);
      if (upErr) throw upErr;
      const { data: doc, error: docErr } = await supabase
        .from("company_documents")
        .insert({
          company_id: selectedCompany.id,
          filename: file.name,
          file_path: filePath,
          file_type: file.type,
          file_size: file.size,
          uploaded_by: user.id,
        })
        .select("id")
        .single();
      if (docErr) throw docErr;
      // Parse in the background so the agent can ground on it.
      supabase.functions.invoke("parse-document", { body: { documentId: doc.id } }).catch(() => {});
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: "📄 Got it — I've added \u201c" + file.name + "\u201d to your knowledge base. It may take a moment to process; after that I can answer questions straight from it.",
      }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Document upload failed: " + (e?.message || "unknown error") }]);
    } finally {
      setDocUploading(false);
    }
  };

  // Post/schedule media upload — stored to company-media; the agent attaches
  // it to a drafted post (image_url / video_url on scheduled_posts).
  const uploadPostMedia = async (file: File) => {
    const companyId = activeCompanyId || selectedCompany?.id;
    if (!companyId) return;
    setPostMediaUploading(true);
    try {
      const ext = file.name.split(".").pop() || "image";
      const type = file.type.startsWith("video") ? "video" : "image";
      // First path segment MUST be the company UUID (company-media RLS).
      const p = companyId + "/posts/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
      const { error } = await supabase.storage.from("company-media").upload(p, file, { upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("company-media").getPublicUrl(p);
      setPostMedia({ url: data.publicUrl, type, name: file.name });
      setLastPostMedia({ url: data.publicUrl, type });
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Media upload failed: " + (e?.message || "unknown error") }]);
    } finally {
      setPostMediaUploading(false);
    }
  };

  // Meta connect: mirror the MetaIntegrationsPanel popup flow — popup →
  // postMessage(code) → meta-oauth-exchange → meta-oauth-connect-pages
  // (auto-connects every Page found on the owner's account).
  const startMetaConnect = (connectUrl: string, state: string) => {
    sessionStorage.setItem('meta_oauth_state', state);
    const popup = window.open(connectUrl, 'meta-oauth', 'width=600,height=720,menubar=no,toolbar=no,location=no');
    if (!popup) {
      setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Could not open the Facebook window — allow popups for this site and try again." }]);
      return;
    }
    let settled = false;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedPoll);
      window.clearTimeout(timeoutId);
    };
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      if (!ev.data || ev.data.source !== 'meta-oauth' || settled) return;
      settled = true;
      cleanup();
      const expected = sessionStorage.getItem('meta_oauth_state');
      sessionStorage.removeItem('meta_oauth_state');
      if (ev.data.error) {
        setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Facebook login failed: " + ev.data.error }]);
        return;
      }
      if (!ev.data.code || ev.data.state !== expected) {
        setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Facebook login was cancelled or failed the security check. Say \"connect\" to try again." }]);
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: "🔗 Pages found — linking them to your agent now…" }]);
      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke('meta-oauth-exchange', {
            body: { code: ev.data.code, redirect_uri: window.location.origin + '/auth/meta/callback', company_id: activeCompanyId },
          });
          if (error) throw error;
          const pages = data?.pages || [];
          if (!pages.length) {
            setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ No Facebook Pages were found on that account. Create one, then say \"connect\" here." }]);
            return;
          }
          const { data: connData, error: connErr } = await supabase.functions.invoke('meta-oauth-connect-pages', {
            body: { session_id: data.session_id, page_ids: pages.map((pg: any) => pg.id) },
          });
          if (connErr) throw connErr;
          const okCount = (connData?.connected || []).filter((c: any) => !c.error).length;
          setMessages((prev) => [...prev, {
            role: "assistant",
            content: "✅ Connected " + okCount + " page" + (okCount === 1 ? "" : "s") + "! Comments and DMs are now answered by your agent automatically. Anything else you'd like me to remember about the business?",
          }]);
        } catch (e: any) {
          setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Meta connect failed: " + (e?.message || "unknown error") }]);
        }
      })();
    };
    const closedPoll = window.setInterval(() => {
      if (popup.closed && !settled) { settled = true; cleanup(); }
    }, 700);
    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        try { popup.close(); } catch { /* ignore */ }
        setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Facebook login timed out — say \"connect\" to try again." }]);
      }
    }, 5 * 60 * 1000);
    window.addEventListener('message', onMessage);
  };

  // Load the company's media (product references, generated images, videos)
  // from company-media storage — a ChatGPT-style media library, browsable.
  // ChatGPT-style thread rail: list this context's conversations.
  const loadThreads = async () => {
    try {
      const { data } = await supabase.functions.invoke("agent-console", {
        body: { message: "", list_threads: true, company_id: activeCompanyId },
      });
      if (data?.threads) setThreads(data.threads);
    } catch { /* best-effort */ }
  };

  const openSidebar = () => {
    setShowSidebar((v) => !v);
    if (!showSidebar) { loadThreads(); loadMedia(); }
  };

  const startNewThread = () => {
    setCurrentThreadId(null);
    setMessages([]);
  };

  const openThread = (id: string) => {
    setCurrentThreadId(id);
    setMessages([]);
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("agent-console", {
          body: { message: "", history_only: true, company_id: activeCompanyId, thread_id: id },
        });
        if (data?.thread) setMessages(data.thread.map((m: any) => ({ role: m.role, content: m.content, attachments: Array.isArray(m.attachments) && m.attachments.length ? m.attachments : undefined })));
      } catch { /* best-effort */ }
    })();
  };

  const loadMedia = async () => {
    setMediaLoading(true);
    try {
      if (!activeCompanyId) { setMediaItems([]); return; }
      const folders = [activeCompanyId + "/references", activeCompanyId + "/images", "videos/" + activeCompanyId];
      const items: { name: string; url: string; type: "image" | "video" | "file" }[] = [];
      for (const folder of folders) {
        try {
          const { data, error } = await supabase.storage.from("company-media").list(folder, { limit: 50 });
          if (error || !data) continue;
          for (const fileObj of data) {
            if (fileObj.id === null) continue; // sub-folder
            const ext = (fileObj.name.split(".").pop() || "").toLowerCase();
            const type: "image" | "video" | "file" = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext) ? "image" : (["mp4", "mov", "webm"].includes(ext) ? "video" : "file");
            const { data: pub } = supabase.storage.from("company-media").getPublicUrl(folder + "/" + fileObj.name);
            items.push({ name: fileObj.name, url: pub.publicUrl, type });
          }
        } catch { /* folder may not exist */ }
      }
      setMediaItems(items);
    } finally {
      setMediaLoading(false);
    }
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    // ChatGPT-style: the attachment travels WITH the sent message and stays
    // visible in the bubble, not just as a composer chip.
    const pendingAttachments: ChatMessage["attachments"] = [
      ...(attachedUrl ? [{ url: attachedUrl, type: "image" as const }] : []),
      ...(postMedia ? [{ url: postMedia.url, type: postMedia.type }] : []),
    ];
    // The composer chip disappears the instant the message is sent — the
    // attachment now lives in the sent bubble. (The invoke below still uses
    // the values captured in this closure, so clearing state here is safe.)
    setPostMedia(null);
    setAttachedUrl(null);
    const userMsg: ChatMessage = { role: "user", content: message, attachments: pendingAttachments };
    setMessages((prev) => [...prev, userMsg]);
    // "post it" / "schedule this" after the fact: fall back to the last media
    // the owner shared, so the follow-up refers to the thing they just showed.
    const refersToIt = /\b(post|schedule|publish)\b[^.!?]*\b(it|this|that|them)\b/i.test(message) || /^(post|schedule|publish)\b/i.test(message.trim());
    const mediaForPost = postMedia ?? (refersToIt ? lastPostMedia : null);
    try {
      const { data, error } = await supabase.functions.invoke("agent-console", {
        body: {
          company_id: activeCompanyId,
          message,
          image_urls: attachedUrl ? [attachedUrl] : [],
          post_media_url: mediaForPost?.url ?? null,
          post_media_type: mediaForPost?.type ?? null,
          // Persisted with the user message so attachments stay in history.
          attachments: pendingAttachments,
          thread_id: currentThreadId,
          new_thread: !currentThreadId,
          // Guests have no server thread — carry the in-state conversation so
          // onboarding memory survives across turns.
          history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        },
      });
      if (error) throw new Error(error.message || "Agent request failed");
      if (data?.thread_id) setCurrentThreadId(data.thread_id);
      const action = data?.action || null;
      if (action?.type === "company_created" || action?.type === "company_claimed") {
        if (action.company_id) setActiveCompanyId(action.company_id);
        refreshCompanies();
      }
      // A generated image becomes the "last media" — a follow-up "post it"
      // attaches it without re-uploading.
      if (action?.type === "image_created" && action.url) {
        setLastPostMedia({ url: action.url, type: "image" });
      }
      if (data?.thread?.length) {
        // Server-authoritative thread (ChatGPT-style) — replaces local messages.
        const thread: ChatMessage[] = data.thread.map((m: any) => ({ role: m.role, content: m.content, attachments: Array.isArray(m.attachments) && m.attachments.length ? m.attachments : undefined }));
        // Fallback while the attachments column is new: graft this turn's
        // media onto the sent bubble if the server row didn't carry it yet.
        if (pendingAttachments.length) {
          for (let i = thread.length - 1; i >= 0; i--) {
            if (thread[i].role === "user" && !thread[i].attachments) { thread[i] = { ...thread[i], attachments: pendingAttachments }; break; }
          }
        }
        setMessages(thread);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: data?.reply || "I couldn't process that just now.", action: data?.action || null }]);
      }
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ " + (e?.message || "Something went wrong. Please try again.") },
      ]);
    } finally {
      setBusy(false);
      setAttachedUrl(null);
      setPostMedia(null);
    }
  };

  return (
    <div className="relative flex h-screen overflow-hidden bg-background">
      {/* ChatGPT-style left rail: a true pane that pushes the chat (overlays on mobile) */}
      {showSidebar && (
        <aside className="w-80 shrink-0 h-screen border-r border-border flex flex-col bg-muted/30 overflow-hidden animate-sidebar-in max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40">
          <div className="p-3 border-b border-border flex items-center gap-2">
            <img src={omanutLogo} alt="Omanut" className="h-6 w-6 object-contain" />
            <span className="text-sm font-semibold text-foreground">Omanut Agent</span>
            <button type="button" onClick={() => setShowSidebar(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
          <div className="p-3">
            <button
              type="button"
              onClick={startNewThread}
              className="w-full text-left text-sm px-3 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
            >
              + New chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Conversations</h4>
              </div>
              <div className="space-y-1">
                {threads.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No conversations yet.</p>
                ) : threads.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => openThread(t.id)}
                    className={"w-full text-left text-sm px-3 py-2.5 rounded-lg border transition-colors " + (currentThreadId === t.id ? "bg-primary/10 border-primary/30" : "bg-card hover:bg-accent border-border")}
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Media</h4>
                <Images className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              {mediaLoading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : mediaItems.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {activeCompanyId ? "Upload a product photo with 📎, or ask for a video/image — it appears here." : "Connect a business first, then your media lives here."}
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {mediaItems.map((item) => (
                    <a key={item.name + item.url} href={item.url} target="_blank" rel="noreferrer" className="block aspect-square rounded-lg overflow-hidden bg-card border">
                      {item.type === "image" ? (
                        <img src={item.url} alt={item.name} className="w-full h-full object-cover" loading="lazy" />
                      ) : item.type === "video" ? (
                        <video src={item.url} className="w-full h-full object-cover" preload="metadata" muted />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground p-1 text-center">file</div>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>
      )}
      <main className="flex-1 flex flex-col h-screen min-w-0 overflow-hidden">
        {/* Header */}
        <div className="border-b px-6 py-4 flex items-center gap-3">
          <div className="relative">
            <div className="h-10 w-10 rounded-full bg-white flex items-center justify-center border border-border shadow-sm overflow-hidden">
              <img src={omanutLogo} alt="Omanut" className="h-7 w-7 object-contain" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 border-2 border-background"></span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground leading-tight">AI Agent</h1>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 font-medium">● online</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {activeCompanyId
                ? "Answers from your knowledge base, makes videos, drafts posts"
                : "Let's set up your business — chat me through it, I'll do the heavy lifting"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openSidebar}
              className="h-9 px-3 rounded-lg border bg-card flex items-center gap-2 text-xs text-foreground hover:bg-accent transition-colors"
              title="Open conversations & media"
            >
              <PanelLeft className="h-4 w-4" /> Chats &amp; media
            </button>
            {isGuest ? (
              <Button
                size="sm"
                className="h-9 px-4 gap-2"
                onClick={() => navigate("/signup")}
              >
                Get my agent
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-9 px-3 gap-2"
                onClick={() => navigate("/settings")}
                title="Settings & modules"
              >
                <Settings className="h-4 w-4" /> Settings
              </Button>
            )}
          </div>
        </div>

        {/* Thread */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-10">
                <Sparkles className="h-10 w-10 mx-auto text-primary/60 mb-4" />
                <div className="mx-auto h-14 w-14 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center mb-4 shadow-lg">
                  <Sparkles className="h-7 w-7 text-primary-foreground" />
                </div>
                <h2 className="text-2xl font-bold text-foreground">
                  {activeCompanyId
                    ? "Hey! I'm your " + (selectedCompany?.name || "business") + " agent."
                    : "Hey! Let's set up your business."}
                </h2>
                <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                  {activeCompanyId
                    ? "Ask me anything about your business, or tell me what to make — videos, posts, answers for customers."
                    : "Just tell me about your business — name, what you sell, hours. I'll build your profile, knowledge base and connect your channels as we chat."}
                </p>
                {activeCompanyId && (
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
                )}
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={"flex animate-msg-in " + (m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={
                    "max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed " +
                    (m.role === "user"
                      ? "bg-gradient-to-br from-primary to-primary/90 text-primary-foreground rounded-br-sm shadow-md"
                      : "bg-card text-foreground rounded-bl-sm border border-border shadow-sm")
                  }
                >
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {m.attachments.map((a, ai) => (
                        a.type === "video" ? (
                          <video
                            key={ai}
                            src={a.url}
                            controls
                            preload="metadata"
                            className="max-w-[240px] rounded-xl border border-white/30 bg-black/20"
                          />
                        ) : (
                          <img
                            key={ai}
                            src={a.url}
                            alt="Attachment"
                            className="max-w-[240px] max-h-[240px] w-auto rounded-xl border border-white/30 object-cover cursor-zoom-in"
                            onClick={(ev) => window.open(a.url, "_blank")}
                          />
                        )
                      ))}
                    </div>
                  )}
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
                  {m.action?.type === "facts_saved" && m.action.saved && m.action.saved.length > 0 && (
                    <div className="mt-2 flex items-center gap-2 text-xs bg-background/60 rounded-lg px-2 py-1.5">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Saved to your profile: {m.action.saved.join(", ")}</span>
                    </div>
                  )}
                  {m.action?.type === "kb_saved" && (
                    <div className="mt-2 flex items-center gap-2 text-xs bg-background/60 rounded-lg px-2 py-1.5">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Knowledge base updated: {m.action.filename}</span>
                    </div>
                  )}
                  {m.action?.type === "meta_connect" && m.action.connect_url && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => startMetaConnect(m.action!.connect_url!, m.action!.state!)}
                        className="w-full text-sm px-3 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
                      >
                        Connect Facebook &amp; Instagram →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex justify-start">
                <div className="bg-card rounded-2xl px-4 py-3.5 flex items-center gap-2 border border-border shadow-sm">
                  <div className="flex items-center gap-1 text-primary">
                    <span className="typing-dot"></span>
                    <span className="typing-dot"></span>
                    <span className="typing-dot"></span>
                  </div>
                  <span className="text-sm text-muted-foreground">Thinking…</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="border-t px-4 py-3">
          {(attachedUrl || postMedia || docUploading) && (
            <div className="max-w-3xl mx-auto mb-2 flex items-end gap-2 flex-wrap">
              {attachedUrl && (
                <div className="relative">
                  <img
                    src={attachedUrl}
                    alt="Reference"
                    className="h-16 w-16 rounded-xl object-cover border border-border bg-card"
                  />
                  <button
                    type="button"
                    onClick={() => setAttachedUrl(null)}
                    title="Remove reference image"
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-destructive shadow-sm"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <span className="absolute bottom-0 inset-x-0 bg-background/85 text-[9px] leading-4 text-center text-muted-foreground rounded-b-xl">Reference</span>
                </div>
              )}
              {postMedia && (
                <div className="relative">
                  {postMedia.type === "video" ? (
                    <video
                      src={postMedia.url}
                      className="h-16 w-16 rounded-xl object-cover border border-border bg-card"
                      preload="metadata"
                      muted
                    />
                  ) : (
                    <img
                      src={postMedia.url}
                      alt={postMedia.name || "Post media"}
                      className="h-16 w-16 rounded-xl object-cover border border-border bg-card"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setPostMedia(null)}
                    title="Remove media"
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-destructive shadow-sm"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <span className="absolute bottom-0 inset-x-0 bg-background/85 text-[9px] leading-4 text-center text-muted-foreground rounded-b-xl">
                    {postMedia.type === "video" ? "Post video" : "Post image"}
                  </span>
                </div>
              )}
              {docUploading && (
                <div className="h-16 w-16 rounded-xl border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground bg-card">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-[9px] mt-1">Reading</span>
                </div>
              )}
            </div>
          )}
          <form
            className="max-w-3xl mx-auto flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadReference(file);
                e.target.value = "";
              }}
            />
            <input
              ref={docInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadKnowledgeDocument(file);
                e.target.value = "";
              }}
            />
            <input
              ref={postMediaInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadPostMedia(file);
                e.target.value = "";
              }}
            />
            <Popover open={attachOpen} onOpenChange={setAttachOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={uploading || docUploading || postMediaUploading || busy}
                  title="Attach images, documents or media"
                  className="h-11 w-11 rounded-xl border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                >
                  {uploading || docUploading || postMediaUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-80 p-1.5">
                <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Attach to your message</p>
                <button
                  type="button"
                  onClick={() => { setAttachOpen(false); fileInputRef.current?.click(); }}
                  className="w-full text-left flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-accent transition-colors"
                >
                  <span className="h-8 w-8 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Paperclip className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">Reference image</span>
                    <span className="block text-xs text-muted-foreground">Product shot or brand asset — grounds video ads</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => { setAttachOpen(false); docInputRef.current?.click(); }}
                  className="w-full text-left flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-accent transition-colors"
                >
                  <span className="h-8 w-8 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><FileText className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">Knowledge document</span>
                    <span className="block text-xs text-muted-foreground">PDF, Word, Excel, CSV, text — the agent learns from it</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => { setAttachOpen(false); postMediaInputRef.current?.click(); }}
                  className="w-full text-left flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-accent transition-colors"
                >
                  <span className="h-8 w-8 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><ImagePlus className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">Media to post or schedule</span>
                    <span className="block text-xs text-muted-foreground">Image or video attached to your drafted post</span>
                  </span>
                </button>
              </PopoverContent>
            </Popover>
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
            Ask me for images, videos and posts &mdash; upload docs to teach your agent. Images &amp; videos cost generation credits.
          </p>
        </div>
      </main>
    </div>
  );
};

export default AgentConsole;