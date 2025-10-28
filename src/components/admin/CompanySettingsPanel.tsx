import { useCompany } from '@/context/CompanyContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import CompanyForm from '@/components/CompanyForm';

export const CompanySettingsPanel = () => {
  const { selectedCompany } = useCompany();

  if (!selectedCompany) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white/60">Select a company to edit settings</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6">
        <CompanyForm 
          companyId={selectedCompany.id} 
          onSuccess={() => window.location.reload()}
          onCancel={() => {}}
        />
      </div>
    </ScrollArea>
  );
};
