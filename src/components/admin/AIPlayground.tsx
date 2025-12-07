import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, RotateCcw, Loader2, Clock, Zap, Brain, User, Bot, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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

export const AIPlayground = ({ companyId }: AIPlaygroundProps) => {
  const [mode, setMode] = useState<"customer" | "boss" | "training">("customer");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<Analysis | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please log in to use the playground");
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-playground`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            company_id: companyId,
            mode,
            message: userMessage,
            conversation_history: messages,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to get AI response");
      }

      const data = await response.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.response }]);
      setLastAnalysis(data.analysis);
    } catch (error) {
      console.error("Playground error:", error);
      toast.error("Failed to get AI response");
      setMessages(prev => prev.slice(0, -1)); // Remove user message on error
    } finally {
      setIsLoading(false);
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

  return (
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
                  <div
                    key={idx}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-2 ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-card border"
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

          {/* Quick Scenarios */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInput("I want to make a reservation for 4 people tomorrow at 7pm")}
            >
              Test Reservation
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInput("What are your prices?")}
            >
              Test Pricing
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInput("I have a complaint about my last visit")}
            >
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
                  {lastAnalysis.model_used.split('/')[1]}
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
  );
};
