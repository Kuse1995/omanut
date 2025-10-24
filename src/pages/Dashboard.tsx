import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Phone, MessageSquare, Calendar, TrendingUp } from 'lucide-react';

const Dashboard = () => {
  const [stats, setStats] = useState({
    creditBalance: 0,
    todayCalls: 0,
    activeConversations: 0,
    totalReservations: 0
  });
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      // Get first company (in production, filter by user's company_id)
      const { data: companyData } = await supabase
        .from('companies')
        .select('*')
        .limit(1)
        .single();

      setCompany(companyData);

      const today = new Date().toISOString().split('T')[0];

      // Get today's conversations
      const { count: todayCount } = await supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyData?.id)
        .gte('started_at', today);

      // Get active conversations
      const { count: activeCount } = await supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyData?.id)
        .eq('status', 'active');

      // Get total reservations
      const { count: reservationCount } = await supabase
        .from('reservations')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyData?.id);

      setStats({
        creditBalance: companyData?.credit_balance || 0,
        todayCalls: todayCount || 0,
        activeConversations: activeCount || 0,
        totalReservations: reservationCount || 0
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      title: 'Credit Balance',
      value: stats.creditBalance,
      icon: TrendingUp,
      description: 'Available credits',
      className: 'text-primary'
    },
    {
      title: "Today's Calls",
      value: stats.todayCalls,
      icon: Phone,
      description: 'Calls received today',
      className: 'text-accent'
    },
    {
      title: 'Active Conversations',
      value: stats.activeConversations,
      icon: MessageSquare,
      description: 'Currently ongoing',
      className: 'text-primary'
    },
    {
      title: 'Total Reservations',
      value: stats.totalReservations,
      icon: Calendar,
      description: 'All-time bookings',
      className: 'text-accent'
    }
  ];

  return (
    <div className="min-h-screen bg-app p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gradient mb-2">{company?.name || 'Dashboard'}</h1>
          <p className="text-muted-foreground">Monitor your AI receptionist performance</p>
          {company?.credit_balance < 50 && (
            <div className="mt-4 p-4 bg-destructive/10 border border-destructive rounded-lg text-destructive">
              ⚠️ Your receptionist may pause soon. Please top up credits. Current balance: {company.credit_balance}
            </div>
          )}
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => (
            <Card key={stat.title} className="card-glass">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-foreground">
                  {stat.title}
                </CardTitle>
                <stat.icon className={`h-5 w-5 ${stat.className}`} />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-foreground">{loading ? '...' : stat.value}</div>
                <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 md:grid-cols-2 mt-6">
          <Card className="card-glass">
            <CardHeader>
              <CardTitle className="text-foreground">Quick Actions</CardTitle>
              <CardDescription>Common tasks and shortcuts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <a href="/" className="block p-3 rounded-md hover:bg-muted/50 transition-colors">
                <div className="font-medium text-foreground">Test Voice Agent</div>
                <div className="text-sm text-muted-foreground">Try the live demo</div>
              </a>
              <a href="/settings" className="block p-3 rounded-md hover:bg-muted/50 transition-colors">
                <div className="font-medium text-foreground">Update Settings</div>
                <div className="text-sm text-muted-foreground">Configure your AI persona</div>
              </a>
              <a href="/billing" className="block p-3 rounded-md hover:bg-muted/50 transition-colors">
                <div className="font-medium text-foreground">Add Credits</div>
                <div className="text-sm text-muted-foreground">Top up your balance</div>
              </a>
            </CardContent>
          </Card>

          <Card className="card-glass">
            <CardHeader>
              <CardTitle className="text-foreground">System Status</CardTitle>
              <CardDescription>AI receptionist health</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-foreground">Voice AI</span>
                <span className="text-primary font-medium">● Active</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-foreground">Twilio Integration</span>
                <span className="text-primary font-medium">● Connected</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-foreground">Database</span>
                <span className="text-primary font-medium">● Operational</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;