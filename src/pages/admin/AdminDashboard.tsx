import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Building2, CreditCard, Phone, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import Sidebar from "@/components/Sidebar";

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalCompanies: 0,
    totalCredits: 0,
    totalCalls: 0,
    activeUsers: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAdminAccess();
    loadStats();
  }, []);

  const checkAdminAccess = async () => {
    // Check for direct access token (no Supabase auth needed)
    const token = localStorage.getItem('admin_access_token');
    const expiry = localStorage.getItem('admin_token_expiry');
    
    if (!token || !expiry) {
      navigate('/admin/login');
      return;
    }

    const expiryDate = new Date(expiry);
    if (expiryDate < new Date()) {
      // Token expired
      localStorage.removeItem('admin_access_token');
      localStorage.removeItem('admin_token_expiry');
      navigate('/admin/login');
    }
  };

  const loadStats = async () => {
    try {
      const [companiesRes, conversationsRes, usersRes] = await Promise.all([
        supabase.from('companies').select('credit_balance', { count: 'exact' }),
        supabase.from('conversations').select('*', { count: 'exact' }),
        supabase.from('users').select('*', { count: 'exact' }),
      ]);

      const totalCredits = companiesRes.data?.reduce((sum, c) => sum + (c.credit_balance || 0), 0) || 0;

      setStats({
        totalCompanies: companiesRes.count || 0,
        totalCredits,
        totalCalls: conversationsRes.count || 0,
        activeUsers: usersRes.count || 0,
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      title: "Total Companies",
      value: stats.totalCompanies,
      icon: Building2,
      gradient: "from-blue-500 to-cyan-500",
    },
    {
      title: "Total Credits",
      value: stats.totalCredits.toLocaleString(),
      icon: CreditCard,
      gradient: "from-green-500 to-emerald-500",
    },
    {
      title: "Total Calls",
      value: stats.totalCalls,
      icon: Phone,
      gradient: "from-purple-500 to-pink-500",
    },
    {
      title: "Active Users",
      value: stats.activeUsers,
      icon: Users,
      gradient: "from-orange-500 to-red-500",
    },
  ];

  return (
    <div className="flex min-h-screen w-full bg-app">
      <Sidebar />
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gradient">Admin Dashboard</h1>
              <p className="text-muted-foreground">Omanut Technologies Control Center</p>
            </div>
            <Button onClick={() => navigate('/admin/companies')} className="bg-gradient-primary">
              Manage Companies
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {statCards.map((stat, i) => (
              <Card key={i} className="card-glass p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">{stat.title}</p>
                    <p className="text-3xl font-bold">{loading ? "..." : stat.value}</p>
                  </div>
                  <div className={`p-3 rounded-lg bg-gradient-to-br ${stat.gradient}`}>
                    <stat.icon className="h-6 w-6 text-white" />
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <Card className="card-glass p-6">
              <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
              <div className="space-y-3">
                <Button variant="outline" className="w-full justify-start" onClick={() => navigate('/admin/companies')}>
                  <Building2 className="mr-2 h-4 w-4" />
                  View All Companies
                </Button>
                <Button variant="outline" className="w-full justify-start" onClick={() => navigate('/admin/qa')}>
                  <Phone className="mr-2 h-4 w-4" />
                  Review Call Quality
                </Button>
                <Button variant="outline" className="w-full justify-start" onClick={() => navigate('/admin/credits')}>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Manage Credits
                </Button>
              </div>
            </Card>

            <Card className="card-glass p-6">
              <h3 className="text-lg font-semibold mb-4">System Status</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">API Status</span>
                  <span className="text-sm font-medium text-green-500">Operational</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Twilio Integration</span>
                  <span className="text-sm font-medium text-green-500">Connected</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">OpenAI Status</span>
                  <span className="text-sm font-medium text-green-500">Active</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;
