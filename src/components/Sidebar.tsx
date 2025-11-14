import { LayoutDashboard, Phone, MessageSquare, Calendar, Settings, CreditCard, Info, Users } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import omanutLogo from '@/assets/omanut-logo.jpg';
import ThemeToggle from './ThemeToggle';

const Sidebar = () => {
  const location = useLocation();
  
  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Live Demo', href: '/live-demo', icon: Phone },
    { name: 'Conversations', href: '/conversations', icon: MessageSquare },
    { name: 'Client Insights', href: '/client-insights', icon: Info },
    { name: 'Customer Segments', href: '/customer-segments', icon: Users },
    { name: 'Reservations', href: '/reservations', icon: Calendar },
    { name: 'Company Settings', href: '/settings', icon: Settings },
    { name: 'Billing & Credits', href: '/billing', icon: CreditCard },
  ];

  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-6 flex items-center gap-3">
        <img src={omanutLogo} alt="Omanut Assistant" className="w-12 h-12 object-contain" />
        <div>
          <h1 className="text-xl font-bold text-foreground">Omanut Assistant</h1>
          <p className="text-xs text-muted-foreground">Powered by Omanut Technologies</p>
        </div>
      </div>
      
      <nav className="flex-1 px-3 space-y-1">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.name}
              to={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive 
                  ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>
      
      <div className="p-3 border-t border-sidebar-border">
        <ThemeToggle />
      </div>
    </aside>
  );
};

export default Sidebar;