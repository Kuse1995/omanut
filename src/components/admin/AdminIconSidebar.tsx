import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  Users,
  Calendar,
  Bot,
  Settings,
  CreditCard,
  DollarSign,
  LogOut,
  Search,
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  Sparkles,
  Image,
  Ticket,
  Headset,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import omanutLogo from '@/assets/omanut-logo-new.png';

interface AdminIconSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onOpenCommandPalette: () => void;
}

const navItems = [
  { id: 'conversations', icon: MessageSquare, label: 'Conversations' },
  { id: 'insights', icon: Users, label: 'Client Insights' },
  { id: 'reservations', icon: Calendar, label: 'Reservations' },
  { id: 'ai-control', icon: Bot, label: 'AI Control' },
  { id: 'image-gen', icon: Sparkles, label: 'Image Generation' },
  { id: 'media', icon: Image, label: 'Media Library' },
  { id: 'tickets', icon: Ticket, label: 'Support Tickets' },
  { id: 'settings', icon: Settings, label: 'Company Settings' },
  { id: 'billing', icon: CreditCard, label: 'Billing & Credits' },
  { id: 'payments', icon: DollarSign, label: 'Products & Payments' },
];

export const AdminIconSidebar = ({ activeTab, onTabChange, onOpenCommandPalette }: AdminIconSidebarProps) => {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const initialTheme = savedTheme || 'dark';
    setTheme(initialTheme);
    document.documentElement.classList.toggle('dark', initialTheme === 'dark');
    document.documentElement.classList.toggle('light', initialTheme === 'light');
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    document.documentElement.classList.toggle('light', newTheme === 'light');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/admin/login');
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "h-screen bg-sidebar-background border-r border-sidebar-border flex flex-col transition-all duration-300",
          collapsed ? "w-16" : "w-56"
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-center border-b border-sidebar-border px-3">
          <div className="flex items-center gap-2 overflow-hidden">
            <img src={omanutLogo} alt="Omanut" className="w-8 h-8 object-contain flex-shrink-0" />
            {!collapsed && (
              <span className="font-semibold text-sm text-sidebar-foreground whitespace-nowrap">
                Omanut Admin
              </span>
            )}
          </div>
        </div>

        {/* Search Button */}
        <div className="p-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                onClick={onOpenCommandPalette}
                className={cn(
                  "w-full justify-start gap-2 h-10 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                  collapsed && "justify-center px-0"
                )}
              >
                <Search className="w-4 h-4 flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="text-sm">Search...</span>
                    <kbd className="ml-auto text-xs bg-sidebar-accent px-1.5 py-0.5 rounded text-sidebar-foreground/50">
                      ⌘K
                    </kbd>
                  </>
                )}
              </Button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Search (⌘K)</TooltipContent>}
          </Tooltip>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-2 space-y-1">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onTabChange(item.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 h-10 rounded-lg transition-all text-sm",
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                      collapsed && "justify-center px-0"
                    )}
                  >
                    <item.icon className="w-4 h-4 flex-shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </button>
                </TooltipTrigger>
                {collapsed && <TooltipContent side="right">{item.label}</TooltipContent>}
              </Tooltip>
            );
          })}
        </nav>

        {/* Bottom Actions */}
        <div className="p-3 border-t border-sidebar-border space-y-1">
          {/* Theme Toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleTheme}
                className={cn(
                  "w-full flex items-center gap-3 px-3 h-10 rounded-lg transition-all text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                  collapsed && "justify-center px-0"
                )}
              >
                {theme === 'dark' ? (
                  <Sun className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <Moon className="w-4 h-4 flex-shrink-0" />
                )}
                {!collapsed && <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>}
              </button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</TooltipContent>}
          </Tooltip>

          {/* Collapse Toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setCollapsed(!collapsed)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 h-10 rounded-lg transition-all text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
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

          {/* Logout */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleLogout}
                className={cn(
                  "w-full flex items-center gap-3 px-3 h-10 rounded-lg transition-all text-sm text-destructive/80 hover:text-destructive hover:bg-destructive/10",
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
