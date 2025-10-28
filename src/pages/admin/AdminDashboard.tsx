import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { CompanyProvider } from '@/context/CompanyContext';
import { CompanySidebar } from '@/components/admin/CompanySidebar';
import { CompanyHeader } from '@/components/admin/CompanyHeader';
import { CompanyTabs } from '@/components/admin/CompanyTabs';

const AdminDashboard = () => {
  const navigate = useNavigate();

  useEffect(() => {
    checkAdminAccess();
  }, []);

  const checkAdminAccess = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/admin/login');
      return;
    }

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (!roles || roles.role !== 'admin') {
      toast.error('Access denied');
      navigate('/admin/login');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/admin/login');
  };

  return (
    <CompanyProvider>
      <div className="min-h-screen bg-[#0A0A0A] flex flex-col">
        <header className="border-b border-white/10 bg-[#1A1A1A]">
          <div className="px-6 py-4 flex justify-between items-center">
            <h1 className="text-2xl font-semibold text-white">Omanut Assistant Admin</h1>
            <Button 
              variant="outline" 
              onClick={handleLogout}
              className="bg-transparent border-white/20 text-white hover:bg-white/10"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <CompanySidebar />
          
          <div className="flex-1 flex flex-col overflow-hidden">
            <CompanyHeader />
            <CompanyTabs />
          </div>
        </div>
      </div>
    </CompanyProvider>
  );
};

export default AdminDashboard;
