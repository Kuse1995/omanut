import { useParams } from "react-router-dom";
import { AdminLayout } from "@/components/admin/AdminLayout";
import CompanyForm from "@/components/CompanyForm";

const EditCompany = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <AdminLayout>
      <div className="p-8 max-w-4xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gradient">Edit Company</h1>
          <p className="text-muted-foreground">Update company settings and configuration</p>
        </div>
        <CompanyForm companyId={id} />
      </div>
    </AdminLayout>
  );
};

export default EditCompany;
