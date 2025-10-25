import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import Sidebar from "@/components/Sidebar";
import { Edit, Phone, Plus, Mail, User, Trash2, MessageSquare } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

interface CompanyWithUser {
  company: any;
  users: any[];
}

const Companies = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [companies, setCompanies] = useState<CompanyWithUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAdminAccess();
    loadCompanies();
  }, []);

  const checkAdminAccess = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate('/admin/login');
      return;
    }

    const { data: isAdmin } = await supabase.rpc('has_role', {
      _user_id: session.user.id,
      _role: 'admin'
    });

    if (!isAdmin) {
      navigate('/');
    }
  };

  const loadCompanies = async () => {
    try {
      const { data: companiesData, error: companiesError } = await supabase
        .from('companies')
        .select('*')
        .order('created_at', { ascending: false });

      if (companiesError) throw companiesError;

      // Fetch users for each company
      const companiesWithUsers = await Promise.all(
        (companiesData || []).map(async (company) => {
          const { data: users, error: usersError } = await supabase
            .from('users')
            .select('id, email, role')
            .eq('company_id', company.id);

          if (usersError) {
            console.error(`Error loading users for company ${company.id}:`, usersError);
          }

          return {
            company,
            users: users || []
          };
        })
      );

      setCompanies(companiesWithUsers);
    } catch (error) {
      console.error('Error loading companies:', error);
      toast({
        title: "Error",
        description: "Failed to load companies",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCompany = async (companyId: string, companyName: string) => {
    try {
      const { data, error } = await supabase.rpc('delete_company', {
        p_company_id: companyId
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: `${companyName} and all related data deleted successfully`,
      });

      // Reload companies list
      loadCompanies();
    } catch (error: any) {
      console.error('Error deleting company:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete company",
        variant: "destructive",
      });
    }
  };

  const handleToggleWhatsAppVoice = async (companyId: string, currentValue: boolean) => {
    try {
      const { error } = await supabase
        .from('companies')
        .update({ whatsapp_voice_enabled: !currentValue })
        .eq('id', companyId);

      if (error) throw error;

      toast({
        title: "Success",
        description: `WhatsApp voice ${!currentValue ? 'enabled' : 'disabled'} successfully`,
      });

      loadCompanies();
    } catch (error: any) {
      console.error('Error toggling WhatsApp voice:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to toggle WhatsApp voice",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-app">
      <Sidebar />
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gradient">Companies</h1>
              <p className="text-muted-foreground">
                Managing {companies.length} {companies.length === 1 ? 'company' : 'companies'} • Each company has its own isolated data and settings
              </p>
            </div>
            <Button onClick={() => navigate('/admin/companies/new')}>
              <Plus className="h-4 w-4 mr-2" />
              Create Company
            </Button>
          </div>

          <Card className="card-glass">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company Name</TableHead>
                  <TableHead>Business Type</TableHead>
                  <TableHead>Login Credentials</TableHead>
                  <TableHead>Voice Number</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>WhatsApp Voice AI</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                <TableRow>
                    <TableCell colSpan={9} className="text-center">Loading...</TableCell>
                  </TableRow>
                ) : companies.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">"
                      No companies found. Create your first company to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  companies.map(({ company, users }) => (
                    <TableRow key={company.id}>
                      <TableCell className="font-medium">{company.name}</TableCell>
                      <TableCell className="capitalize">{company.business_type}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {users.length > 0 ? (
                            users.map((user) => (
                              <div key={user.id} className="flex items-center gap-2 text-sm">
                                <Mail className="h-3 w-3 text-muted-foreground" />
                                <span className="font-mono text-xs">{user.email}</span>
                              </div>
                            ))
                          ) : (
                            <span className="text-muted-foreground text-sm flex items-center gap-1">
                              <User className="h-3 w-3" />
                              No users
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {company.twilio_number ? (
                          <div className="flex items-center gap-1 text-sm">
                            <Phone className="h-3 w-3" />
                            <span>{company.twilio_number}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">Not set</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {company.whatsapp_number ? (
                          <div className="flex items-center gap-1 text-sm">
                            <MessageSquare className="h-3 w-3 text-green-500" />
                            <span>{company.whatsapp_number}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">Not set</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={company.whatsapp_voice_enabled || false}
                            onCheckedChange={() => handleToggleWhatsAppVoice(company.id, company.whatsapp_voice_enabled)}
                            disabled={!company.whatsapp_number}
                          />
                          {company.whatsapp_voice_enabled ? (
                            <Badge variant="default" className="text-xs">
                              <Phone className="h-3 w-3 mr-1" />
                              Active
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">Off</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={company.credit_balance > 50 ? "default" : "destructive"}>
                          {company.credit_balance}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={company.credit_balance > 0 ? "default" : "secondary"}>
                          {company.credit_balance > 0 ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate(`/admin/company/${company.id}`)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete {company.name}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete the company and ALL related data including:
                                  <ul className="list-disc list-inside mt-2 space-y-1">
                                    <li>{users.length} user account{users.length !== 1 ? 's' : ''}</li>
                                    <li>All conversations and transcripts</li>
                                    <li>All reservations</li>
                                    <li>All credit usage history</li>
                                  </ul>
                                  <p className="mt-2 font-semibold text-destructive">This action cannot be undone.</p>
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteCompany(company.id, company.name)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete Company
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Companies;
