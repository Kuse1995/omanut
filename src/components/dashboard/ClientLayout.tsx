import { useState } from "react";
import ClientSidebar from "./ClientSidebar";
import MobileBottomNav from "./MobileBottomNav";
import { cn } from "@/lib/utils";

const ClientLayout = ({ children }: { children: React.ReactNode }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar hidden on mobile, bottom nav takes over */}
      <div className="hidden md:block">
        <ClientSidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      </div>
      <main
        className={cn(
          "min-h-screen transition-all duration-300",
          "md:ml-60",
          sidebarCollapsed && "md:ml-16",
        )}
      >
        {children}
      </main>
      <MobileBottomNav />
    </div>
  );
};

export default ClientLayout;

