import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CompanyProvider } from '@/context/CompanyContext';
import { AdminIconSidebar } from '@/components/admin/AdminIconSidebar';
import { CompanyPanel } from '@/components/admin/CompanyPanel';
import { AdminContentTabs } from '@/components/admin/AdminContentTabs';
import { CompanyCommandPalette } from '@/components/admin/CompanyCommandPalette';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import CompanyForm from '@/components/CompanyForm';

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('conversations');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    checkAdminAccess();
  }, []);

  // Keyboard shortcut for command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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

  const handleCreateSuccess = () => {
    setCreateDialogOpen(false);
    toast.success('Company created successfully');
  };

  return (
    <CompanyProvider>
      <div className="min-h-screen bg-background flex w-full">
        <AdminIconSidebar 
          activeTab={activeTab} 
          onTabChange={setActiveTab}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        />
        
        <div className="flex-1 flex flex-col overflow-hidden">
          <CompanyPanel />
          <AdminContentTabs activeTab={activeTab} />
        </div>

        <CompanyCommandPalette 
          open={commandPaletteOpen} 
          onOpenChange={setCommandPaletteOpen}
          onCreateCompany={() => setCreateDialogOpen(true)}
        />

        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl">Create New Company</DialogTitle>
            </DialogHeader>
            <CompanyForm 
              onSuccess={handleCreateSuccess}
              onCancel={() => setCreateDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
    </CompanyProvider>
  );
};

export default AdminDashboard;
