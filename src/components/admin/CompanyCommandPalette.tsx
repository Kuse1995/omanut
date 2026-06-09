import { useEffect, useMemo, useState } from 'react';
import { Building2, Plus, Copy, Check, KeyRound, Clock, Star, CheckCircle2 } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useCompany, getRecentCompanyIds } from '@/context/CompanyContext';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { Badge } from '@/components/ui/badge';
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
  const [recents, setRecents] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { selectedCompany, switchCompany, setSelectedCompany } = useCompany();

  useEffect(() => {
    if (open) {
      setRecents(getRecentCompanyIds());
      fetchCompanies();
      fetchClaimCodes();
    }
  }, [open]);

  const fetchCompanies = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('companies')
      .select('*')
      .order('name');
    setCompanies(data || []);
    setLoading(false);
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

  const handleSelectCompany = async (company: Company) => {
    onOpenChange(false);
    // Use switchCompany when possible (refreshes role + persists),
    // otherwise fall back to direct set (admin not in membership list).
    try {
      await switchCompany(company.id);
      if (!selectedCompany || selectedCompany.id !== company.id) {
        // safety net: ensure selection landed
        setSelectedCompany(company);
      }
    } catch {
      setSelectedCompany(company);
    }
    toast.success(`Switched to ${company.name}`);
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

  const byId = useMemo(() => {
    const m: Record<string, Company> = {};
    companies.forEach((c) => { m[c.id] = c; });
    return m;
  }, [companies]);

  const recentCompanies = useMemo(
    () => recents.map((id) => byId[id]).filter(Boolean) as Company[],
    [recents, byId]
  );

  const otherCompanies = useMemo(() => {
    const recentSet = new Set(recents);
    return companies.filter(
      (c) => !recentSet.has(c.id) && c.id !== selectedCompany?.id
    );
  }, [companies, recents, selectedCompany?.id]);

  const renderItem = (company: Company, opts?: { showCurrent?: boolean }) => {
    const claim = claimMap[company.id];
    const isClaimed = !!claim?.claimed_at;
    const isCurrent = selectedCompany?.id === company.id;
    return (
      <CommandItem
        key={`${company.id}-${opts?.showCurrent ? 'current' : 'list'}`}
        value={`${company.name} ${company.business_type ?? ''} ${claim?.code ?? ''}`}
        onSelect={() => handleSelectCompany(company)}
        className="gap-3"
      >
        <Building2 className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{company.name}</span>
            {isCurrent && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] gap-0.5">
                <CheckCircle2 className="w-2.5 h-2.5" /> current
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {company.business_type || 'No type'} • {company.credit_balance ?? 0} credits
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
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search companies by name, type, or claim code..." />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>
          {loading ? 'Loading companies...' : 'No companies found.'}
        </CommandEmpty>

        {selectedCompany && (
          <>
            <CommandGroup heading="Current">
              <CommandItem
                value={`current ${selectedCompany.name}`}
                onSelect={() => onOpenChange(false)}
                className="gap-3"
              >
                <Star className="w-4 h-4 text-amber-500" />
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="font-medium truncate">{selectedCompany.name}</span>
                  <span className="text-xs text-muted-foreground">
                    Active workspace · stays selected on reload
                  </span>
                </div>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Actions">
          <CommandItem onSelect={handleCreateCompany} className="gap-2">
            <Plus className="w-4 h-4" />
            <span>Create new company</span>
          </CommandItem>
        </CommandGroup>

        {recentCompanies.filter((c) => c.id !== selectedCompany?.id).length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent">
              {recentCompanies
                .filter((c) => c.id !== selectedCompany?.id)
                .map((c) => renderItem(c))}
            </CommandGroup>
          </>
        )}

        {otherCompanies.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={`All companies (${companies.length})`}>
              {otherCompanies.map((c) => renderItem(c))}
            </CommandGroup>
          </>
        )}
      </CommandList>
      <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Selection is saved across reloads
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">⌘K</kbd>
          to reopen
        </span>
      </div>
    </CommandDialog>
  );
};
