import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Send, Loader2, RotateCcw, GraduationCap, User, Sparkles, Copy, Check, Database, Settings } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

interface Message {
  role: "user" | "assistant";
  content: string;
  savedItems?: Array<{ target: string; summary: string }>;
}

interface AITrainingCoachProps {
  companyId: string;
  onDataChanged?: () => void;
}

const starterPrompts = [
  "How should I greet customers?",
  "Help me handle complaints better",
  "What should the AI do after hours?",
  "Let's discuss upselling strategies",
  "How to handle payment questions?",
];

export const AITrainingCoach = ({ companyId, onDataChanged }: AITrainingCoachProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (messages.length === 0) {
      sendMessage("Hi, I'd like to train my AI assistant. Let's get started.");
    }
  }, []);

  const sendMessage = async (overrideMessage?: string) => {
    const messageText = overrideMessage || input.trim();
    if (!messageText || isLoading) return;

    if (!overrideMessage) setInput("");

    if (!overrideMessage) {
      setMessages(prev => [...prev, { role: "user", content: messageText }]);
    }
    setIsLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please log in first");
        setIsLoading(false);
        return;
      }

      const history = overrideMessage ? [] : messages.map(m => ({ role: m.role, content: m.content }));

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-training-coach`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            company_id: companyId,
            message: messageText,
            conversation_history: history,
          }),
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to get response");
      }

      const data = await response.json();
      const saved = data.saved || [];

      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.response,
        savedItems: saved.length > 0 ? saved : undefined,
      }]);

      if (saved.length > 0) {
        saved.forEach((item: { target: string; summary: string }) => {
          toast.success(`Saved to ${item.target}`, { description: item.summary });
        });
        onDataChanged?.();
      }
    } catch (error: any) {
      console.error("Coach error:", error);
      toast.error(error.message || "Failed to get AI response");
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setTimeout(() => {
      sendMessage("Hi, I'd like to train my AI assistant. Let's get started.");
    }, 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const getTargetIcon = (target: string) => {
    if (target === 'Knowledge Base') return <Database className="h-3 w-3" />;
    return <Settings className="h-3 w-3" />;
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <GraduationCap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">AI Training Coach</CardTitle>
              <CardDescription>
                Chat with your AI coach — agreed items are saved automatically
              </CardDescription>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={clearChat} title="Start over">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ScrollArea className="h-[450px] rounded-lg border bg-muted/20 p-4" ref={scrollRef}>
          {messages.length === 0 && !isLoading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Sparkles className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Starting your training session...</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, idx) => (
                <div key={idx}>
                  <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`flex items-start gap-2 max-w-[85%] ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                      <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-1 ${
                        msg.role === "user" ? "bg-primary" : "bg-primary/10"
                      }`}>
                        {msg.role === "user" ? (
                          <User className="h-3.5 w-3.5 text-primary-foreground" />
                        ) : (
                          <GraduationCap className="h-3.5 w-3.5 text-primary" />
                        )}
                      </div>
                      <div className="group relative">
                        <div
                          className={`rounded-lg px-4 py-3 ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-card border shadow-sm"
                          }`}
                        >
                          {msg.role === "assistant" ? (
                            <div className="text-sm prose prose-sm dark:prose-invert max-w-none [&>p]:mb-2 [&>ul]:mb-2 [&>ol]:mb-2">
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                          ) : (
                            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                          )}
                        </div>
                        {msg.role === "assistant" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute -right-8 top-0 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6"
                            onClick={() => copyToClipboard(msg.content, idx)}
                          >
                            {copiedIdx === idx ? (
                              <Check className="h-3 w-3 text-primary" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Saved items indicator */}
                  {msg.savedItems && msg.savedItems.length > 0 && (
                    <div className="flex justify-start ml-9 mt-2">
                      <div className="space-y-1">
                        {msg.savedItems.map((item, si) => (
                          <div
                            key={si}
                            className="flex items-center gap-2 text-xs bg-primary/10 text-primary rounded-full px-3 py-1"
                          >
                            {getTargetIcon(item.target)}
                            <span className="font-medium">Saved to {item.target}:</span>
                            <span className="text-foreground/70">{item.summary}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex items-start gap-2">
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <GraduationCap className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="bg-card border rounded-lg px-4 py-3 shadow-sm">
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" />
                        <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:150ms]" />
                        <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:300ms]" />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        {messages.length <= 1 && !isLoading && (
          <div className="flex flex-wrap gap-2">
            {starterPrompts.map((prompt) => (
              <Button
                key={prompt}
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setInput("");
                  setMessages(prev => [...prev, { role: "user", content: prompt }]);
                  sendMessage(prompt);
                }}
              >
                {prompt}
              </Button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Discuss how your AI should behave..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button onClick={() => sendMessage()} disabled={!input.trim() || isLoading} size="icon">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
