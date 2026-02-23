import { useState } from 'react';
import { useCompany } from '@/context/CompanyContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Trash2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import CompanyForm from '@/components/CompanyForm';
import { ApiKeysSection } from '@/components/admin/ApiKeysSection';

export const CompanySettingsPanel = () => {
  const { selectedCompany, setSelectedCompany, refreshCompanies } = useCompany();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteCompany = async () => {
    if (!selectedCompany) return;
    
    setDeleting(true);
    try {
      const { data, error } = await supabase.rpc('delete_company', {
        p_company_id: selectedCompany.id
      });

      if (error) throw error;

      toast.success(`Company "${selectedCompany.name}" deleted successfully`);
      setSelectedCompany(null);
      refreshCompanies();
      setShowDeleteDialog(false);
    } catch (error: any) {
      console.error('Error deleting company:', error);
      toast.error(error.message || 'Failed to delete company');
    } finally {
      setDeleting(false);
    }
  };

  if (!selectedCompany) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Select a company to edit settings</p>
      </div>
    );
  }

  return (
    <>
      <ScrollArea className="h-full">
        <div className="p-6 space-y-8">
          <CompanyForm 
            companyId={selectedCompany.id} 
            onSuccess={() => window.location.reload()}
            onCancel={() => {}}
          />

          <Separator className="my-8" />

          <ApiKeysSection />

          <Separator className="my-8" />

          {/* Danger Zone */}
          <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h3 className="text-lg font-semibold text-destructive">Danger Zone</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Permanently delete this company and all associated data including conversations, 
              messages, reservations, payments, and user accounts. This action cannot be undone.
            </p>
            <Button
              variant="destructive"
              onClick={() => setShowDeleteDialog(true)}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Delete Company
            </Button>
          </div>
        </div>
      </ScrollArea>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete "{selectedCompany.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This will permanently delete:</p>
              <ul className="list-disc list-inside text-sm space-y-1 ml-2">
                <li>All conversations and messages</li>
                <li>All reservations and payments</li>
                <li>All media, documents, and AI settings</li>
                <li>User accounts (if not linked to other companies)</li>
              </ul>
              <p className="font-medium text-destructive mt-4">
                This action cannot be undone. Deleted emails can be reused.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCompany}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting...' : 'Delete Company'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
