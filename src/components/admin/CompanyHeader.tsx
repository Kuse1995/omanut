import { useCompany } from '@/context/CompanyContext';
import { Building2, Phone, MessageSquare, CreditCard, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const CompanyHeader = () => {
  const { selectedCompany, setSelectedCompany } = useCompany();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteCompany = async () => {
    if (!selectedCompany) return;
    
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('delete_company', {
        p_company_id: selectedCompany.id
      });

      if (error) throw error;

      toast.success('Company deleted successfully');
      setSelectedCompany(null);
      setShowDeleteDialog(false);
      window.location.reload(); // Refresh to update company list
    } catch (error) {
      console.error('Error deleting company:', error);
      toast.error('Failed to delete company');
    } finally {
      setDeleting(false);
    }
  };

  if (!selectedCompany) {
    return (
      <div className="p-6 border-b border-white/10">
        <p className="text-white/60">Select a company to view details</p>
      </div>
    );
  }

  return (
    <>
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-[#1A1A1A] border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete Company</AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              Are you sure you want to delete <span className="font-semibold text-white">{selectedCompany.name}</span>? 
              This will permanently delete all associated data including conversations, reservations, and documents. 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-[#2A2A2A] border-white/10 text-white hover:bg-white/5">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCompany}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'Deleting...' : 'Delete Company'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-4 py-2 bg-[#84CC16]/10 border border-[#84CC16]/20 rounded-lg">
              <CreditCard className="w-4 h-4 text-[#84CC16]" />
              <span className="font-semibold text-[#84CC16]">{selectedCompany.credit_balance || 0} credits</span>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowDeleteDialog(true)}
              className="border-red-600/20 bg-red-600/10 hover:bg-red-600/20 text-red-600"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
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
    </>
  );
};
