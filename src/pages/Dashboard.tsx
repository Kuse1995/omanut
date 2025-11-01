import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Phone, MessageSquare, Calendar, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import BackButton from '@/components/BackButton';
import ThemeToggle from '@/components/ThemeToggle';

const Dashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    creditBalance: 0,
    todayCalls: 0,
    todayWhatsAppMessages: 0,
    todayWhatsAppCalls: 0,
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
      // Get current user's company
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/login');
        return;
      }

      // Get user's company_id
      const { data: userData } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', session.user.id)
        .single();

      if (!userData?.company_id) {
        throw new Error('No company associated with this user');
      }

      const { data: companyData } = await supabase
        .from('companies')
        .select('*')
        .eq('id', userData.company_id)
        .single();

      setCompany(companyData);

      const today = new Date().toISOString().split('T')[0];

      // Get today's conversations
      const { count: todayCount } = await supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyData?.id)
        .gte('started_at', today);

      // Get today's credit usage for WhatsApp
      const { data: whatsappMessages } = await supabase
        .from('credit_usage')
        .select('*', { count: 'exact' })
        .eq('company_id', companyData?.id)
        .eq('reason', 'whatsapp_message')
        .gte('created_at', today);

      const { data: whatsappCalls } = await supabase
        .from('credit_usage')
        .select('*', { count: 'exact' })
        .eq('company_id', companyData?.id)
        .eq('reason', 'whatsapp_call_start')
        .gte('created_at', today);

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
        todayWhatsAppMessages: whatsappMessages?.length || 0,
        todayWhatsAppCalls: whatsappCalls?.length || 0,
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
      className: 'text-primary',
      onClick: () => navigate('/billing')
    },
    {
      title: "Today's Phone Calls",
      value: stats.todayCalls,
      icon: Phone,
      description: 'PSTN calls received',
      className: 'text-accent',
      onClick: () => navigate('/conversations')
    },
    {
      title: "WhatsApp Messages",
      value: stats.todayWhatsAppMessages,
      icon: MessageSquare,
      description: 'Messages handled today',
      className: 'text-primary',
      onClick: () => navigate('/conversations')
    },
    {
      title: "WhatsApp Calls",
      value: stats.todayWhatsAppCalls,
      icon: Phone,
      description: 'WhatsApp calls today',
      className: 'text-accent',
      onClick: () => navigate('/conversations')
    },
    {
      title: 'Active Conversations',
      value: stats.activeConversations,
      icon: MessageSquare,
      description: 'Currently ongoing',
      className: 'text-primary',
      onClick: () => navigate('/conversations')
    },
    {
      title: 'Total Reservations',
      value: stats.totalReservations,
      icon: Calendar,
      description: 'All-time bookings',
      className: 'text-accent',
      onClick: () => navigate('/reservations')
    }
  ];

  return (
    <div className="min-h-screen bg-app p-8 animate-fade-in">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <BackButton />
          <ThemeToggle />
        </div>
        <div className="mb-8">
          <h1 className="text-5xl font-bold mb-3">
            <span className="text-gradient">{company?.name || 'Dashboard'}</span>
          </h1>
          <p className="text-lg text-muted-foreground">Monitor your AI receptionist performance</p>
          {company?.credit_balance < 50 && (
            <div className="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-foreground">
              ⚠️ <span className="font-medium">Low Credit Warning:</span> Your receptionist may pause soon. Current balance: <span className="font-bold">{company.credit_balance} credits</span>
            </div>
          )}
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {statCards.map((stat) => (
            <Card 
              key={stat.title} 
              className="card-glass cursor-pointer transition-all hover:scale-105 hover:shadow-lg"
              onClick={stat.onClick}
            >
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
              <Button 
                variant="ghost" 
                className="w-full justify-start p-3 h-auto"
                onClick={() => navigate('/conversations')}
              >
                <div className="text-left">
                  <div className="font-medium text-foreground">View Conversations</div>
                  <div className="text-sm text-muted-foreground">See all customer chats</div>
                </div>
              </Button>
              <Button 
                variant="ghost" 
                className="w-full justify-start p-3 h-auto"
                onClick={() => navigate('/reservations')}
              >
                <div className="text-left">
                  <div className="font-medium text-foreground">View Reservations</div>
                  <div className="text-sm text-muted-foreground">See all bookings</div>
                </div>
              </Button>
              <Button 
                variant="ghost" 
                className="w-full justify-start p-3 h-auto"
                onClick={() => navigate('/client-insights')}
              >
                <div className="text-left">
                  <div className="font-medium text-foreground">Client Insights</div>
                  <div className="text-sm text-muted-foreground">View customer information</div>
                </div>
              </Button>
              <Button 
                variant="ghost" 
                className="w-full justify-start p-3 h-auto"
                onClick={() => navigate('/live-demo')}
              >
                <div className="text-left">
                  <div className="font-medium text-foreground">Test Voice Agent</div>
                  <div className="text-sm text-muted-foreground">Try the live demo</div>
                </div>
              </Button>
              <Button 
                variant="ghost" 
                className="w-full justify-start p-3 h-auto"
                onClick={() => navigate('/settings')}
              >
                <div className="text-left">
                  <div className="font-medium text-foreground">Update Settings</div>
                  <div className="text-sm text-muted-foreground">Configure your AI persona</div>
                </div>
              </Button>
              <Button 
                variant="ghost" 
                className="w-full justify-start p-3 h-auto"
                onClick={() => navigate('/billing')}
              >
                <div className="text-left">
                  <div className="font-medium text-foreground">Add Credits</div>
                  <div className="text-sm text-muted-foreground">Top up your balance</div>
                </div>
              </Button>
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
                <span className="text-foreground">Phone Integration</span>
                <span className="text-primary font-medium">● Connected</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-foreground">WhatsApp Integration</span>
                <span className={company?.whatsapp_number ? "text-primary font-medium" : "text-muted-foreground"}>
                  {company?.whatsapp_number ? "● Active" : "○ Not configured"}
                </span>
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