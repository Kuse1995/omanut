import { useState } from 'react';
import { Check, ChevronsUpDown, Building2, Crown, Shield, Pencil, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { useCompany } from '@/context/CompanyContext';

type CompanyRole = 'owner' | 'manager' | 'contributor' | 'viewer';

const roleIcons: Record<CompanyRole, React.ReactNode> = {
  owner: <Crown className="h-3 w-3" />,
  manager: <Shield className="h-3 w-3" />,
  contributor: <Pencil className="h-3 w-3" />,
  viewer: <Eye className="h-3 w-3" />,
};

const roleColors: Record<CompanyRole, string> = {
  owner: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  manager: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  contributor: 'bg-green-500/20 text-green-400 border-green-500/30',
  viewer: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

export function CompanySwitcher() {
  const [open, setOpen] = useState(false);
  const { selectedCompany, userCompanies, switchCompany, currentRole, isLoading } = useCompany();

  if (isLoading) {
    return (
      <Button variant="outline" className="w-full justify-between" disabled>
        <span className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Loading...
        </span>
      </Button>
    );
  }

  if (userCompanies.length === 0) {
    return null;
  }

  // If only one company, show it without dropdown
  if (userCompanies.length === 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium truncate flex-1">
          {selectedCompany?.name || userCompanies[0].company_name}
        </span>
        {currentRole && (
          <Badge variant="outline" className={cn('text-xs gap-1', roleColors[currentRole])}>
            {roleIcons[currentRole]}
            {currentRole}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          <span className="flex items-center gap-2 truncate">
            <Building2 className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {selectedCompany?.name || 'Select company...'}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Search companies..." />
          <CommandList>
            <CommandEmpty>No company found.</CommandEmpty>
            <CommandGroup>
              {userCompanies.map((company) => (
                <CommandItem
                  key={company.company_id}
                  value={company.company_name}
                  onSelect={() => {
                    switchCompany(company.company_id);
                    setOpen(false);
                  }}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Check
                      className={cn(
                        'h-4 w-4',
                        selectedCompany?.id === company.company_id
                          ? 'opacity-100'
                          : 'opacity-0'
                      )}
                    />
                    <span className="truncate">{company.company_name}</span>
                  </div>
                  <Badge 
                    variant="outline" 
                    className={cn('text-xs gap-1 ml-2', roleColors[company.role])}
                  >
                    {roleIcons[company.role]}
                    {company.role}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default CompanySwitcher;
