import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { 
  TrendingUp, 
  MessageSquare, 
  Calendar, 
  Phone,
  Zap,
  Search,
  MoreHorizontal
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ClientLayout from "@/components/dashboard/ClientLayout";
import StatCard from "@/components/dashboard/StatCard";
import NotificationBell from "@/components/dashboard/NotificationBell";
import ActivityTimeline from "@/components/dashboard/ActivityTimeline";
import SetupChecklist from "@/components/dashboard/SetupChecklist";
import AiDigest from "@/components/dashboard/AiDigest";
import WhatsAppNumberBanner from "@/components/dashboard/WhatsAppNumberBanner";
import ThemeToggle from "@/components/ThemeToggle";

const Dashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    creditBalance: 0,
    todayConversations: 0,
    activeConversations: 0,
    totalReservations: 0,
    pendingReservations: 0,
    whatsappMessages: 0,
  });
  const [company, setCompany] = useState<any>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/login");
        return;
      }

      const { data: userData } = await supabase
        .from("users")
        .select("company_id")
        .eq("id", session.user.id)
        .single();

      if (!userData?.company_id) {
        throw new Error("No company associated with this user");
      }

      setCompanyId(userData.company_id);

      const { data: companyData } = await supabase
        .from("companies")
        .select("*")
        .eq("id", userData.company_id)
        .single();

      setCompany(companyData);

      const today = new Date().toISOString().split("T")[0];

      // Fetch stats in parallel
      const [
        todayConversations,
        activeConversations,
        totalReservations,
        pendingReservations,
        whatsappMessages,
      ] = await Promise.all([
        supabase
          .from("conversations")
          .select("*", { count: "exact", head: true })
          .eq("company_id", companyData?.id)
          .gte("started_at", today),
        supabase
          .from("conversations")
          .select("*", { count: "exact", head: true })
          .eq("company_id", companyData?.id)
          .eq("status", "active"),
        supabase
          .from("reservations")
          .select("*", { count: "exact", head: true })
          .eq("company_id", companyData?.id),
        supabase
          .from("reservations")
          .select("*", { count: "exact", head: true })
          .eq("company_id", companyData?.id)
          .eq("status", "pending_boss_approval"),
        supabase
          .from("credit_usage")
          .select("*", { count: "exact", head: true })
          .eq("company_id", companyData?.id)
          .eq("reason", "whatsapp_message")
          .gte("created_at", today),
      ]);

      setStats({
        creditBalance: companyData?.credit_balance || 0,
        todayConversations: todayConversations.count || 0,
        activeConversations: activeConversations.count || 0,
        totalReservations: totalReservations.count || 0,
        pendingReservations: pendingReservations.count || 0,
        whatsappMessages: whatsappMessages.count || 0,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const quickActions = [
    { name: "View Conversations", href: "/conversations", icon: MessageSquare },
    { name: "Reservations", href: "/reservations", icon: Calendar },
    { name: "Supervisor AI", href: "/supervisor-insights", icon: Zap },
    { name: "Live Demo", href: "/live-demo", icon: Phone },
  ];

  return (
    <ClientLayout>
      <div className="p-4 sm:p-6 lg:p-8 pb-24 md:pb-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Welcome back{company?.name ? `, ${company.name}` : ""}
            </h1>
            <p className="text-muted-foreground mt-1">
              Here's what's happening with your AI assistant today.
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search..." 
                className="w-64 pl-9 bg-card/50 border-border"
              />
            </div>
            <NotificationBell companyId={companyId || undefined} />
            <ThemeToggle />
          </div>
        </header>

        <WhatsAppNumberBanner companyName={company?.name} />
        <SetupChecklist />
        <AiDigest companyId={companyId || undefined} />

        {/* Credit Warning */}
        {company?.credit_balance < 50 && (
          <div className="mb-6 p-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <Zap className="w-5 h-5 text-yellow-500" />
              </div>
              <div>
                <p className="font-medium">Low Credit Balance</p>
                <p className="text-sm text-muted-foreground">
                  Only {company.credit_balance} credits remaining. Top up to avoid service interruption.
                </p>
              </div>
            </div>
            <Button onClick={() => navigate("/billing")} size="sm">
              Add Credits
            </Button>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="Credit Balance"
            value={loading ? "..." : stats.creditBalance}
            description="Available credits"
            icon={TrendingUp}
            onClick={() => navigate("/billing")}
          />
          <StatCard
            title="Today's Conversations"
            value={loading ? "..." : stats.todayConversations}
            description={`${stats.activeConversations} currently active`}
            icon={MessageSquare}
            trend="up"
            trendValue="+12%"
            onClick={() => navigate("/conversations")}
          />
          <StatCard
            title="Reservations"
            value={loading ? "..." : stats.totalReservations}
            description={`${stats.pendingReservations} pending approval`}
            icon={Calendar}
            onClick={() => navigate("/reservations")}
          />
          <StatCard
            title="Messages Today"
            value={loading ? "..." : stats.whatsappMessages}
            description="WhatsApp messages"
            icon={Phone}
            trend="up"
            trendValue="+8%"
            onClick={() => navigate("/conversations")}
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Activity Timeline */}
          <Card className="lg:col-span-2 border-border bg-card/50">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <CardTitle className="text-lg font-semibold">Recent Activity</CardTitle>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <ActivityTimeline companyId={companyId || undefined} />
            </CardContent>
          </Card>

          {/* Quick Actions & System Status */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <Card className="border-border bg-card/50">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {quickActions.map((action) => (
                  <Button
                    key={action.href}
                    variant="ghost"
                    onClick={() => navigate(action.href)}
                    className="w-full justify-start gap-3 h-11"
                  >
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <action.icon className="h-4 w-4 text-primary" />
                    </div>
                    {action.name}
                  </Button>
                ))}
              </CardContent>
            </Card>

            {/* System Status */}
            <Card className="border-border bg-card/50">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold">System Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Voice AI</span>
                  <span className="flex items-center gap-2 text-sm">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    Active
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">WhatsApp</span>
                  <span className="flex items-center gap-2 text-sm">
                    <span className={`w-2 h-2 rounded-full ${company?.whatsapp_number ? "bg-green-500" : "bg-muted"}`} />
                    {company?.whatsapp_number ? "Connected" : "Pending setup"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Phone</span>
                  <span className="flex items-center gap-2 text-sm">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    Connected
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Database</span>
                  <span className="flex items-center gap-2 text-sm">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    Operational
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </ClientLayout>
  );
};

export default Dashboard;
