import { useCompany } from '@/context/CompanyContext';
import { Building2, Phone, MessageSquare, CreditCard } from 'lucide-react';

export const CompanyHeader = () => {
  const { selectedCompany } = useCompany();

  if (!selectedCompany) {
    return (
      <div className="p-6 border-b border-white/10">
        <p className="text-white/60">Select a company to view details</p>
      </div>
    );
  }

  return (
    <div className="p-6 border-b border-white/10 bg-[#1A1A1A]">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-[#84CC16] rounded-lg">
            <Building2 className="w-6 h-6 text-black" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-white mb-1">{selectedCompany.name}</h1>
            <p className="text-white/60">{selectedCompany.business_type || 'N/A'}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 px-4 py-2 bg-[#84CC16]/10 border border-[#84CC16]/20 rounded-lg">
          <CreditCard className="w-4 h-4 text-[#84CC16]" />
          <span className="font-semibold text-[#84CC16]">{selectedCompany.credit_balance || 0} credits</span>
        </div>
      </div>
      
      <div className="mt-4 flex gap-6">
        {selectedCompany.whatsapp_number && (
          <div className="flex items-center gap-2 text-sm text-white/60">
            <MessageSquare className="w-4 h-4" />
            <span>{selectedCompany.whatsapp_number}</span>
          </div>
        )}
        {selectedCompany.twilio_number && (
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Phone className="w-4 h-4" />
            <span>{selectedCompany.twilio_number}</span>
          </div>
        )}
      </div>
    </div>
  );
};
