import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Sidebar from "@/components/Sidebar";
import { Edit, Phone, Plus, Mail, User } from "lucide-react";
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

  return (
    <div className="flex min-h-screen w-full bg-app">
      <Sidebar />
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gradient">Companies</h1>
              <p className="text-muted-foreground">Manage all client companies</p>
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
                  <TableHead>Twilio Number</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center">Loading...</TableCell>
                  </TableRow>
                ) : companies.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      No companies found
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
                          <div className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {company.twilio_number}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Not set</span>
                        )}
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
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/admin/company/${company.id}`)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
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
