import { useEffect, useState } from 'react';
import { Building2, Plus, Search } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useCompany } from '@/context/CompanyContext';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

type Company = Database['public']['Tables']['companies']['Row'];

interface CompanyCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateCompany: () => void;
}

export const CompanyCommandPalette = ({ open, onOpenChange, onCreateCompany }: CompanyCommandPaletteProps) => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const { setSelectedCompany } = useCompany();

  useEffect(() => {
    if (open) {
      fetchCompanies();
    }
  }, [open]);

  const fetchCompanies = async () => {
    const { data } = await supabase
      .from('companies')
      .select('*')
      .order('name');
    setCompanies(data || []);
  };

  const handleSelectCompany = (company: Company) => {
    setSelectedCompany(company);
    onOpenChange(false);
  };

  const handleCreateCompany = () => {
    onOpenChange(false);
    onCreateCompany();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search companies..." />
      <CommandList>
        <CommandEmpty>No companies found.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={handleCreateCompany} className="gap-2">
            <Plus className="w-4 h-4" />
            <span>Create new company</span>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Companies">
          {companies.map((company) => (
            <CommandItem
              key={company.id}
              onSelect={() => handleSelectCompany(company)}
              className="gap-3"
            >
              <Building2 className="w-4 h-4 flex-shrink-0" />
              <div className="flex flex-col">
                <span className="font-medium">{company.name}</span>
                <span className="text-xs text-muted-foreground">
                  {company.business_type || 'No type'} • {company.credit_balance || 0} credits
                </span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
