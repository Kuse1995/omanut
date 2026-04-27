import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, MessageSquare, Calendar, Settings, Plug } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { name: "Home", href: "/dashboard", icon: LayoutDashboard },
  { name: "Chats", href: "/conversations", icon: MessageSquare },
  { name: "Setup", href: "/setup", icon: Plug },
  { name: "Bookings", href: "/reservations", icon: Calendar },
  { name: "More", href: "/settings", icon: Settings },
];

/**
 * Mobile bottom navigation — shown only on screens narrower than md (768px).
 * Designed for thumb reach on Zambian mobile users.
 */
const MobileBottomNav = () => {
  const location = useLocation();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-xl border-t border-border safe-area-bottom">
      <div className="grid grid-cols-5">
        {items.map((item) => {
          const isActive =
            location.pathname === item.href ||
            (item.href === "/conversations" && location.pathname.startsWith("/conversations"));
          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground active:bg-muted/50",
              )}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium leading-none">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
