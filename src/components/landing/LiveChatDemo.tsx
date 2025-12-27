import { useState, useEffect } from "react";
import { Send, Bot, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const demoConversation: Message[] = [
  { role: "user", content: "Hi, I'd like to make a reservation for Friday" },
  { role: "assistant", content: "Hello! I'd be happy to help you with a reservation for Friday. How many guests will be joining you, and what time works best?" },
  { role: "user", content: "4 people at 7pm please" },
  { role: "assistant", content: "Perfect! I have availability for 4 guests at 7:00 PM on Friday. May I have your name and phone number to confirm the booking?" },
];

const LiveChatDemo = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < demoConversation.length) {
      const timer = setTimeout(() => {
        const nextMessage = demoConversation[currentIndex];
        
        if (nextMessage.role === "assistant") {
          setIsTyping(true);
          setTimeout(() => {
            setIsTyping(false);
            setMessages((prev) => [...prev, nextMessage]);
            setCurrentIndex((prev) => prev + 1);
          }, 1500);
        } else {
          setMessages((prev) => [...prev, nextMessage]);
          setCurrentIndex((prev) => prev + 1);
        }
      }, currentIndex === 0 ? 1000 : 2000);

      return () => clearTimeout(timer);
    }
  }, [currentIndex]);

  const handleSend = () => {
    if (!input.trim()) return;
    
    setMessages((prev) => [...prev, { role: "user", content: input }]);
    setInput("");
    
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "That's great! Your reservation is confirmed. You'll receive a confirmation message shortly. Is there anything else I can help you with?",
        },
      ]);
    }, 2000);
  };

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Phone Frame */}
      <div className="relative">
        {/* Phone Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-background rounded-b-2xl z-10" />
        
        {/* Phone Body */}
        <div className="bg-card border border-border rounded-[2.5rem] p-2 shadow-2xl shadow-primary/10">
          <div className="bg-background rounded-[2rem] overflow-hidden">
            {/* Chat Header */}
            <div className="bg-primary/10 px-3 py-2 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-xs">Omanut AI</p>
                  <p className="text-[10px] text-muted-foreground">Online • Replies instantly</p>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="h-64 overflow-y-auto p-3 space-y-2">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}
                >
                  <div
                    className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-muted text-foreground rounded-bl-md"
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              ))}
              
              {isTyping && (
                <div className="flex justify-start animate-fade-in">
                  <div className="bg-muted px-4 py-3 rounded-2xl rounded-bl-md">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-2 border-t border-border">
              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder="Type a message..."
                  className="flex-1 rounded-full bg-muted border-0 text-xs h-8"
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  className="rounded-full shrink-0 h-8 w-8"
                >
                  <Send className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveChatDemo;
