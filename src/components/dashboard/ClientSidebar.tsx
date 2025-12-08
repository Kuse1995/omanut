import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { 
  LayoutDashboard, 
  MessageSquare, 
  Calendar, 
  Settings, 
  CreditCard, 
  Users, 
  Brain,
  Phone,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Info
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import omanutLogo from "@/assets/omanut-logo-new.png";

interface ClientSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Conversations", href: "/conversations", icon: MessageSquare },
  { name: "Reservations", href: "/reservations", icon: Calendar },
  { name: "Supervisor AI", href: "/supervisor-insights", icon: Brain },
  { name: "Client Insights", href: "/client-insights", icon: Info },
  { name: "Segments", href: "/customer-segments", icon: Users },
  { name: "Live Demo", href: "/live-demo", icon: Phone },
];

const bottomNav = [
  { name: "Settings", href: "/settings", icon: Settings },
  { name: "Billing", href: "/billing", icon: CreditCard },
];

const ClientSidebar = ({ collapsed, onToggle }: ClientSidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [company, setCompany] = useState<any>(null);

  useEffect(() => {
    fetchCompany();
  }, []);

  const fetchCompany = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: userData } = await supabase
        .from("users")
        .select("company_id")
        .eq("id", session.user.id)
        .single();

      if (userData?.company_id) {
        const { data: companyData } = await supabase
          .from("companies")
          .select("name")
          .eq("id", userData.company_id)
          .single();
        setCompany(companyData);
      }
    } catch (error) {
      console.error("Error fetching company:", error);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const NavItem = ({ item }: { item: typeof navigation[0] }) => {
    const isActive = location.pathname === item.href;
    
    const content = (
      <Button
        variant="ghost"
        onClick={() => navigate(item.href)}
        className={cn(
          "w-full justify-start gap-3 h-10 px-3 transition-all duration-200",
          isActive 
            ? "bg-primary/10 text-primary hover:bg-primary/15" 
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
          collapsed && "justify-center px-2"
        )}
      >
        <item.icon className={cn("h-4 w-4 shrink-0", isActive && "text-primary")} />
        {!collapsed && <span className="truncate">{item.name}</span>}
      </Button>
    );

    if (collapsed) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {item.name}
          </TooltipContent>
        </Tooltip>
      );
    }

    return content;
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen border-r border-border bg-card/50 backdrop-blur-xl transition-all duration-300 flex flex-col",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Header */}
      <div className={cn(
        "h-16 flex items-center border-b border-border px-4",
        collapsed ? "justify-center" : "justify-between"
      )}>
        {!collapsed && (
          <div className="flex items-center gap-3">
            <img src={omanutLogo} alt="Omanut" className="w-8 h-8 object-contain" />
            <div className="overflow-hidden">
              <p className="font-semibold text-sm truncate">{company?.name || "Dashboard"}</p>
              <p className="text-xs text-muted-foreground">Client Portal</p>
            </div>
          </div>
        )}
        {collapsed && (
          <img src={omanutLogo} alt="Omanut" className="w-8 h-8 object-contain" />
        )}
      </div>

      {/* Toggle Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggle}
        className="absolute -right-3 top-20 h-6 w-6 rounded-full border border-border bg-card shadow-sm hover:bg-muted"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronLeft className="h-3 w-3" />
        )}
      </Button>

      {/* Main Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navigation.map((item) => (
          <NavItem key={item.href} item={item} />
        ))}
      </nav>

      {/* Bottom Navigation */}
      <div className="border-t border-border py-4 px-2 space-y-1">
        {bottomNav.map((item) => (
          <NavItem key={item.href} item={item} />
        ))}
        
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                className="w-full h-10 text-muted-foreground hover:text-destructive"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Sign Out</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            onClick={handleLogout}
            className="w-full justify-start gap-3 h-10 px-3 text-muted-foreground hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </Button>
        )}
      </div>
    </aside>
  );
};

export default ClientSidebar;
