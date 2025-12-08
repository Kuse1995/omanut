import { useCompany } from '@/context/CompanyContext';
import { Building2, Phone, MessageSquare, CreditCard } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export const CompanyPanel = () => {
  const { selectedCompany } = useCompany();

  if (!selectedCompany) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">No company selected</p>
          <p className="text-sm">Press ⌘K to search and select a company</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 border-b border-border bg-card/50">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">{selectedCompany.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {selectedCompany.business_type || 'Business'}
            </p>
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              {selectedCompany.whatsapp_number && (
                <span className="flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />
                  {selectedCompany.whatsapp_number}
                </span>
              )}
              {selectedCompany.twilio_number && (
                <span className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" />
                  {selectedCompany.twilio_number}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={selectedCompany.test_mode ? "secondary" : "default"} className="text-xs">
            {selectedCompany.test_mode ? 'Test Mode' : 'Production'}
          </Badge>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary">
            <CreditCard className="w-4 h-4" />
            <span className="font-semibold">{selectedCompany.credit_balance || 0}</span>
            <span className="text-xs opacity-70">credits</span>
          </div>
        </div>
      </div>
    </div>
  );
};
