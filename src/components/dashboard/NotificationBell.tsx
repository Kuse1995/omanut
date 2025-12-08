import { useState, useEffect } from "react";
import { Bell, X, Check, MessageSquare, Calendar, CreditCard, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface Notification {
  id: string;
  type: "conversation" | "reservation" | "payment" | "warning";
  title: string;
  description: string;
  time: string;
  read: boolean;
}

interface NotificationBellProps {
  companyId?: string;
}

const NotificationBell = ({ companyId }: NotificationBellProps) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (companyId) {
      fetchNotifications();
    }
  }, [companyId]);

  const fetchNotifications = async () => {
    if (!companyId) return;

    try {
      // Fetch recent conversations needing attention
      const { data: conversations } = await supabase
        .from("conversations")
        .select("id, customer_name, phone, human_takeover, created_at")
        .eq("company_id", companyId)
        .eq("human_takeover", true)
        .order("created_at", { ascending: false })
        .limit(3);

      // Fetch pending reservations
      const { data: reservations } = await supabase
        .from("reservations")
        .select("id, name, date, time, status, created_at")
        .eq("company_id", companyId)
        .eq("status", "pending_boss_approval")
        .order("created_at", { ascending: false })
        .limit(3);

      // Fetch company for credit warning
      const { data: company } = await supabase
        .from("companies")
        .select("credit_balance")
        .eq("id", companyId)
        .single();

      const notifs: Notification[] = [];

      // Add conversation notifications
      conversations?.forEach((conv) => {
        notifs.push({
          id: `conv-${conv.id}`,
          type: "conversation",
          title: "Human Takeover Requested",
          description: `${conv.customer_name || conv.phone} needs attention`,
          time: formatTime(conv.created_at),
          read: false,
        });
      });

      // Add reservation notifications
      reservations?.forEach((res) => {
        notifs.push({
          id: `res-${res.id}`,
          type: "reservation",
          title: "Pending Reservation",
          description: `${res.name} - ${res.date} at ${res.time}`,
          time: formatTime(res.created_at),
          read: false,
        });
      });

      // Add credit warning if low
      if (company && company.credit_balance < 50) {
        notifs.unshift({
          id: "credit-warning",
          type: "warning",
          title: "Low Credit Balance",
          description: `Only ${company.credit_balance} credits remaining`,
          time: "Now",
          read: false,
        });
      }

      setNotifications(notifs);
    } catch (error) {
      console.error("Error fetching notifications:", error);
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    
    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const markAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const clearAll = () => {
    setNotifications([]);
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  const getIcon = (type: Notification["type"]) => {
    switch (type) {
      case "conversation":
        return MessageSquare;
      case "reservation":
        return Calendar;
      case "payment":
        return CreditCard;
      case "warning":
        return AlertTriangle;
    }
  };

  const getIconColor = (type: Notification["type"]) => {
    switch (type) {
      case "conversation":
        return "text-blue-500";
      case "reservation":
        return "text-primary";
      case "payment":
        return "text-green-500";
      case "warning":
        return "text-yellow-500";
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-medium">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h4 className="font-semibold text-sm">Notifications</h4>
          {notifications.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-foreground h-auto py-1 px-2"
            >
              Clear all
            </Button>
          )}
        </div>
        
        <ScrollArea className="h-80">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No notifications</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((notification) => {
                const Icon = getIcon(notification.type);
                return (
                  <div
                    key={notification.id}
                    className={cn(
                      "flex gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer",
                      !notification.read && "bg-primary/5"
                    )}
                    onClick={() => markAsRead(notification.id)}
                  >
                    <div className={cn("mt-0.5", getIconColor(notification.type))}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "text-sm truncate",
                        !notification.read && "font-medium"
                      )}>
                        {notification.title}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {notification.description}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {notification.time}
                      </p>
                    </div>
                    {!notification.read && (
                      <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
