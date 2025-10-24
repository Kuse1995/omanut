import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Sidebar from "@/components/Sidebar";
import CompanyForm from "@/components/CompanyForm";

const EditCompany = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    checkAdminAccess();
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

  return (
    <div className="flex min-h-screen w-full bg-app">
      <Sidebar />
      <main className="flex-1 p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-gradient">Edit Company</h1>
            <p className="text-muted-foreground">Update company settings and configuration</p>
          </div>
          <CompanyForm companyId={id} />
        </div>
      </main>
    </div>
  );
};

export default EditCompany;
