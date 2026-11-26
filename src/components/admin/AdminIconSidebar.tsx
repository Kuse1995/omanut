import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  Building2,
  Calendar,
  CalendarClock,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  CreditCard,
  DollarSign,
  Headset,
  Image,
  LogOut,
  Megaphone,
  MessageSquare,
  Moon,
  ScrollText,
  Search,
  Settings,
  Share2,
  ShieldAlert,
  Sparkles,
  Sun,
  Ticket,
  Users,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import omanutLogo from "@/assets/omanut-logo-new.png";

interface AdminIconSidebarProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  onOpenCommandPalette: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: typeof Building2;
  route?: string;
  tab?: string;
  badgeCount?: number;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const COLLAPSE_STORAGE_KEY = "adminSidebarCollapsed";

export const AdminIconSidebar = ({
  activeTab,
  onTabChange,
  onOpenCommandPalette,
}: AdminIconSidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (saved !== null) return saved === "true";
    return window.innerWidth < 1280;
  });

  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as "light" | "dark" | null;
    const initialTheme = savedTheme || "dark";
    setTheme(initialTheme);
    document.documentElement.classList.toggle("dark", initialTheme === "dark");
    document.documentElement.classList.toggle("light", initialTheme === "light");
  }, []);

  const { data: pendingMediaCount = 0 } = useQuery({
    queryKey: ["admin-pending-media-count"],
    staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("company_media")
        .select("id", { count: "exact", head: true })
        .eq("asset_validation_status", "pending");
      if (error) return 0;
      return count ?? 0;
    },
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    document.documentElement.classList.toggle("dark", newTheme === "dark");
    document.documentElement.classList.toggle("light", newTheme === "light");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/admin/login");
  };

  const groups: NavGroup[] = [
    {
      title: "Platform Ops",
      items: [
        { id: "fleet", label: "Fleet", icon: Building2, route: "/admin/companies" },
        { id: "observability", label: "Observability", icon: Activity, route: "/admin/observability" },
        {
          id: "media-approvals",
          label: "Media Approvals",
          icon: CheckSquare,
          route: "/admin/media-approvals",
          badgeCount: pendingMediaCount,
        },
        { id: "audit-log", label: "Audit Log", icon: ScrollText, route: "/admin/audit-log" },
      ],
    },
    {
      title: "Customers & Inbox",
      items: [
        { id: "conversations", label: "Conversations", icon: MessageSquare, tab: "conversations" },
        { id: "workspace", label: "Agent Workspace", icon: Headset, tab: "workspace" },
        { id: "tickets", label: "Support Tickets", icon: Ticket, tab: "tickets" },
        { id: "reservations", label: "Reservations", icon: Calendar, tab: "reservations" },
        { id: "insights", label: "Client Insights", icon: Users, tab: "insights" },
      ],
    },
    {
      title: "AI Brain",
      items: [
        { id: "ai-control", label: "AI Control", icon: Bot, tab: "ai-control" },
        { id: "rule-violations", label: "Rule Violations", icon: ShieldAlert, tab: "rule-violations" },
        { id: "ai-agent", label: "AI Agent", icon: Wand2, route: "/agent" },
      ],
    },
    {
      title: "Content & Growth",
      items: [
        { id: "video-studio", label: "Video Studio", icon: Clapperboard, tab: "video-studio" },
        { id: "image-gen", label: "Image Studio", icon: Sparkles, tab: "image-gen" },
        { id: "media", label: "Media Library", icon: Image, tab: "media" },
        { id: "content-scheduler", label: "Content Scheduler", icon: CalendarClock, tab: "content-scheduler" },
        { id: "ads", label: "Meta Ads", icon: Megaphone, tab: "ads" },
      ],
    },
    {
      title: "Tenant Config",
      items: [
        { id: "meta-integrations", label: "Social & Channels", icon: Share2, tab: "meta-integrations" },
        { id: "settings", label: "Company Settings", icon: Settings, tab: "settings" },
        { id: "payments", label: "Products & Payments", icon: DollarSign, tab: "payments" },
        { id: "billing", label: "Billing & Spend", icon: CreditCard, tab: "billing" },
      ],
    },
  ];

  const isDashboard = location.pathname === "/admin/dashboard";

  const isItemActive = (item: NavItem) => {
    if (item.route) {
      if (item.route === "/admin/companies") {
        return (
          location.pathname === "/admin/companies" ||
          location.pathname === "/admin/companies/new" ||
          location.pathname.startsWith("/admin/company/")
        );
      }
      return location.pathname === item.route;
    }
    if (item.tab && isDashboard) {
      return activeTab === item.tab;
    }
    return false;
  };

  const handleItemClick = (item: NavItem) => {
    if (item.route) {
      navigate(item.route);
      return;
    }
    if (item.tab) {
      if (isDashboard && onTabChange) {
        onTabChange(item.tab);
      } else {
        navigate(`/admin/dashboard?tab=${item.tab}`);
      }
    }
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "h-screen sticky top-0 bg-sidebar-background border-r border-sidebar-border flex flex-col transition-all duration-300 shrink-0",
          collapsed ? "w-16" : "w-60"
        )}
      >
        {/* Logo */}
        <button
          type="button"
          onClick={() => navigate("/admin/companies")}
          className="h-16 flex items-center justify-center border-b border-sidebar-border px-3 hover:bg-sidebar-accent/40 transition-colors shrink-0"
          title="Open Fleet Command"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <img src={omanutLogo} alt="Omanut" className="w-8 h-8 object-contain flex-shrink-0" />
            {!collapsed && (
              <span className="font-semibold text-sm text-sidebar-foreground whitespace-nowrap">
                Omanut Admin
              </span>
            )}
          </div>
        </button>

        {/* Search Button */}
        <div className="p-2.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                onClick={onOpenCommandPalette}
                className={cn(
                  "w-full justify-start gap-2 h-9 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent border border-sidebar-border/60",
                  collapsed && "justify-center px-0"
                )}
              >
                <Search className="w-4 h-4 flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="text-xs">Switch / Jump…</span>
                    <kbd className="ml-auto text-[10px] bg-sidebar-accent px-1.5 py-0.5 rounded text-sidebar-foreground/60">
                      ⌘K
                    </kbd>
                  </>
                )}
              </Button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Switch company or jump (⌘K)</TooltipContent>}
          </Tooltip>
        </div>

        {/* Scrollable Grouped Navigation */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-2.5 py-1 space-y-4">
          {groups.map((group) => (
            <div key={group.title} className="space-y-1">
              {!collapsed ? (
                <div className="px-2.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
                  {group.title}
                </div>
              ) : (
                <div className="mx-2 my-1 border-t border-sidebar-border/60" />
              )}
              {group.items.map((item) => {
                const active = isItemActive(item);
                const hasBadge = typeof item.badgeCount === "number" && item.badgeCount > 0;
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => handleItemClick(item)}
                        className={cn(
                          "relative w-full flex items-center gap-2.5 px-2.5 h-9 rounded-lg transition-all text-sm",
                          active
                            ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                            : "text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                          collapsed && "justify-center px-0"
                        )}
                      >
                        <item.icon className="w-4 h-4 flex-shrink-0" />
                        {!collapsed && <span className="truncate flex-1 text-left">{item.label}</span>}
                        {hasBadge && !collapsed && (
                          <Badge
                            variant={active ? "secondary" : "destructive"}
                            className="h-4 min-w-4 px-1 text-[10px] rounded-full"
                          >
                            {item.badgeCount}
                          </Badge>
                        )}
                        {hasBadge && collapsed && (
                          <span className="absolute top-1 right-1.5 h-2 w-2 rounded-full bg-destructive" />
                        )}
                      </button>
                    </TooltipTrigger>
                    {collapsed && (
                      <TooltipContent side="right">
                        {item.label}
                        {hasBadge ? ` (${item.badgeCount})` : ""}
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Bottom Actions */}
        <div className="p-2.5 border-t border-sidebar-border space-y-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleTheme}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2.5 h-9 rounded-lg transition-all text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                  collapsed && "justify-center px-0"
                )}
              >
                {theme === "dark" ? (
                  <Sun className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <Moon className="w-4 h-4 flex-shrink-0" />
                )}
                {!collapsed && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
              </button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">
                {theme === "dark" ? "Light Mode" : "Dark Mode"}
              </TooltipContent>
            )}
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleCollapsed}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2.5 h-9 rounded-lg transition-all text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                  collapsed && "justify-center px-0"
                )}
              >
                {collapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <>
                    <ChevronLeft className="w-4 h-4" />
                    <span>Collapse</span>
                  </>
                )}
              </button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Expand</TooltipContent>}
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleLogout}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2.5 h-9 rounded-lg transition-all text-sm text-destructive/80 hover:text-destructive hover:bg-destructive/10",
                  collapsed && "justify-center px-0"
                )}
              >
                <LogOut className="w-4 h-4 flex-shrink-0" />
                {!collapsed && <span>Logout</span>}
              </button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Logout</TooltipContent>}
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
};
