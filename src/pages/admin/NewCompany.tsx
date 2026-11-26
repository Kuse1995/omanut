import { AdminLayout } from "@/components/admin/AdminLayout";
import CompanyForm from "@/components/CompanyForm";

const NewCompany = () => {
  return (
    <AdminLayout>
      <div className="p-8 max-w-4xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gradient">Create New Company</h1>
          <p className="text-muted-foreground">Add a new client company to the system</p>
        </div>
        <CompanyForm />
      </div>
    </AdminLayout>
  );
};

export default NewCompany;
