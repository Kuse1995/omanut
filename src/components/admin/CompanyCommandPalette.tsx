import { useEffect, useState } from 'react';
import { Building2, Plus, Copy, Check, KeyRound } from 'lucide-react';
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
import { toast } from 'sonner';

type Company = Database['public']['Tables']['companies']['Row'];

type ClaimRow = {
  company_id: string;
  company_name: string;
  code: string;
  claimed_by: string | null;
  claimed_at: string | null;
};

interface CompanyCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateCompany: () => void;
}

export const CompanyCommandPalette = ({ open, onOpenChange, onCreateCompany }: CompanyCommandPaletteProps) => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [claimMap, setClaimMap] = useState<Record<string, ClaimRow>>({});
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const { setSelectedCompany } = useCompany();

  useEffect(() => {
    if (open) {
      fetchCompanies();
      fetchClaimCodes();
    }
  }, [open]);

  const fetchCompanies = async () => {
    const { data } = await supabase
      .from('companies')
      .select('*')
      .order('name');
    setCompanies(data || []);
  };

  const fetchClaimCodes = async () => {
    const { data, error } = await supabase.rpc('admin_list_claim_codes');
    if (error) return;
    const map: Record<string, ClaimRow> = {};
    (data as ClaimRow[] | null)?.forEach((r) => {
      map[r.company_id] = r;
    });
    setClaimMap(map);
  };

  const handleSelectCompany = (company: Company) => {
    setSelectedCompany(company);
    onOpenChange(false);
  };

  const handleCreateCompany = () => {
    onOpenChange(false);
    onCreateCompany();
  };

  const handleCopyCode = async (e: React.MouseEvent, code: string) => {
    e.stopPropagation();
    e.preventDefault();
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success('Claim code copied');
    setTimeout(() => setCopiedCode(null), 1500);
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
          {companies.map((company) => {
            const claim = claimMap[company.id];
            const isClaimed = !!claim?.claimed_at;
            return (
              <CommandItem
                key={company.id}
                onSelect={() => handleSelectCompany(company)}
                className="gap-3"
              >
                <Building2 className="w-4 h-4 flex-shrink-0" />
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="font-medium truncate">{company.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {company.business_type || 'No type'} • {company.credit_balance || 0} credits
                  </span>
                  {claim && (
                    <span className="flex items-center gap-1 text-[10px] mt-0.5 font-mono text-muted-foreground">
                      <KeyRound className="w-3 h-3" />
                      {claim.code}
                      {isClaimed && (
                        <span className="text-emerald-500 ml-1 not-font-mono">• claimed</span>
                      )}
                    </span>
                  )}
                </div>
                {claim && !isClaimed && (
                  <button
                    type="button"
                    onClick={(e) => handleCopyCode(e, claim.code)}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="ml-auto p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Copy claim code"
                  >
                    {copiedCode === claim.code ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
