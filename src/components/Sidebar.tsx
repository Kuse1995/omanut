import { Home, MessageSquare, Calendar, Settings } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

const Sidebar = () => {
  const location = useLocation();
  
  const navigation = [
    { name: 'Live Demo', href: '/', icon: Home },
    { name: 'Conversations', href: '/conversations', icon: MessageSquare },
    { name: 'Reservations', href: '/reservations', icon: Calendar },
    { name: 'Settings', href: '/settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-primary">AI Front Desk</h1>
        <p className="text-sm text-muted-foreground mt-1">Zambian Lodge</p>
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
    </aside>
  );
};

export default Sidebar;