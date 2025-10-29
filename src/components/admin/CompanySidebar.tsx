import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { useCompany } from '@/context/CompanyContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Building2, Phone, MessageSquare, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import CompanyForm from '@/components/CompanyForm';

type Company = Database['public']['Tables']['companies']['Row'];

export const CompanySidebar = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { selectedCompany, setSelectedCompany } = useCompany();

  useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('name');
    
    if (error) {
      console.error('Error fetching companies:', error);
      return;
    }
    
    setCompanies(data || []);
    if (data && data.length > 0 && !selectedCompany) {
      setSelectedCompany(data[0]);
    }
  };

  const handleCreateSuccess = () => {
    setCreateDialogOpen(false);
    fetchCompanies();
  };

  return (
    <aside className="w-[280px] bg-[#1A1A1A] border-r border-white/10 flex flex-col">
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Companies</h2>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="w-full bg-[#84CC16] hover:bg-[#84CC16]/90 text-black">
              <Plus className="w-4 h-4 mr-2" />
              Create Company
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-[#1A1A1A] text-white border-white/10">
            <DialogHeader>
              <DialogTitle className="text-2xl text-white">Create New Company</DialogTitle>
            </DialogHeader>
            <CompanyForm 
              onSuccess={handleCreateSuccess}
              onCancel={() => setCreateDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {companies.map((company) => {
            const isActive = selectedCompany?.id === company.id;
            return (
              <button
                key={company.id}
                onClick={() => setSelectedCompany(company)}
                className={`w-full text-left p-4 rounded-lg transition-all ${
                  isActive 
                    ? 'bg-[#84CC16] text-black' 
                    : 'bg-[#0A0A0A] text-white hover:bg-[#2A2A2A]'
                }`}
              >
                <div className="flex items-start gap-3 mb-2">
                  <Building2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{company.name}</h3>
                    <p className={`text-sm truncate ${isActive ? 'text-black/70' : 'text-white/60'}`}>
                      {company.business_type || 'N/A'}
                    </p>
                  </div>
                </div>
                
                <div className="space-y-1 text-xs">
                  {company.whatsapp_number && (
                    <div className={`flex items-center gap-2 ${isActive ? 'text-black/70' : 'text-white/60'}`}>
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span className="truncate">{company.whatsapp_number}</span>
                    </div>
                  )}
                  {company.twilio_number && (
                    <div className={`flex items-center gap-2 ${isActive ? 'text-black/70' : 'text-white/60'}`}>
                      <Phone className="w-3.5 h-3.5" />
                      <span className="truncate">{company.twilio_number}</span>
                    </div>
                  )}
                </div>
                
                <div className="mt-2 pt-2 border-t border-current/10">
                  <span className={`text-xs font-medium ${isActive ? 'text-black' : 'text-[#84CC16]'}`}>
                    {company.credit_balance || 0} credits
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </aside>
  );
};
