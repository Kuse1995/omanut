import { useState, useEffect } from "react";
import { MessageSquare, Calendar, CreditCard, Phone, UserCheck, Bot } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Activity {
  id: string;
  type: "conversation" | "reservation" | "payment" | "call" | "handoff" | "ai_response";
  title: string;
  description: string;
  timestamp: string;
}

interface ActivityTimelineProps {
  companyId?: string;
}

const ActivityTimeline = ({ companyId }: ActivityTimelineProps) => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (companyId) {
      fetchActivities();
      
      // Subscribe to real-time updates
      const channel = supabase
        .channel("activity-updates")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "conversations",
            filter: `company_id=eq.${companyId}`,
          },
          (payload) => {
            const newActivity: Activity = {
              id: payload.new.id,
              type: "conversation",
              title: "New Conversation",
              description: payload.new.customer_name || payload.new.phone || "Unknown customer",
              timestamp: payload.new.created_at,
            };
            setActivities((prev) => [newActivity, ...prev].slice(0, 10));
          }
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "reservations",
            filter: `company_id=eq.${companyId}`,
          },
          (payload) => {
            const newActivity: Activity = {
              id: payload.new.id,
              type: "reservation",
              title: "New Reservation",
              description: `${payload.new.name} - ${payload.new.date} at ${payload.new.time}`,
              timestamp: payload.new.created_at,
            };
            setActivities((prev) => [newActivity, ...prev].slice(0, 10));
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [companyId]);

  const fetchActivities = async () => {
    if (!companyId) return;
    
    try {
      const activities: Activity[] = [];

      // Fetch recent conversations
      const { data: conversations } = await supabase
        .from("conversations")
        .select("id, customer_name, phone, human_takeover, created_at, active_agent")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(5);

      conversations?.forEach((conv) => {
        activities.push({
          id: `conv-${conv.id}`,
          type: conv.human_takeover ? "handoff" : "conversation",
          title: conv.human_takeover ? "Handoff to Human" : "AI Conversation",
          description: conv.customer_name || conv.phone || "Unknown customer",
          timestamp: conv.created_at,
        });
      });

      // Fetch recent reservations
      const { data: reservations } = await supabase
        .from("reservations")
        .select("id, name, date, time, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(3);

      reservations?.forEach((res) => {
        activities.push({
          id: `res-${res.id}`,
          type: "reservation",
          title: "Reservation Created",
          description: `${res.name} - ${res.date}`,
          timestamp: res.created_at,
        });
      });

      // Sort by timestamp
      activities.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      setActivities(activities.slice(0, 10));
    } catch (error) {
      console.error("Error fetching activities:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  const getIcon = (type: Activity["type"]) => {
    switch (type) {
      case "conversation":
        return Bot;
      case "reservation":
        return Calendar;
      case "payment":
        return CreditCard;
      case "call":
        return Phone;
      case "handoff":
        return UserCheck;
      case "ai_response":
        return MessageSquare;
    }
  };

  const getIconBg = (type: Activity["type"]) => {
    switch (type) {
      case "conversation":
        return "bg-blue-500/10 text-blue-500";
      case "reservation":
        return "bg-primary/10 text-primary";
      case "payment":
        return "bg-green-500/10 text-green-500";
      case "call":
        return "bg-purple-500/10 text-purple-500";
      case "handoff":
        return "bg-yellow-500/10 text-yellow-500";
      case "ai_response":
        return "bg-cyan-500/10 text-cyan-500";
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-muted rounded w-1/3" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-4 top-2 bottom-2 w-px bg-border" />
      
      <div className="space-y-4">
        {activities.map((activity, index) => {
          const Icon = getIcon(activity.type);
          return (
            <div
              key={activity.id}
              className={cn(
                "relative flex gap-4 pl-1 animate-fade-in",
                index === 0 && "animate-pulse-glow rounded-lg"
              )}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className={cn(
                "relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                getIconBg(activity.type)
              )}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{activity.title}</p>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatTime(activity.timestamp)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {activity.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ActivityTimeline;
