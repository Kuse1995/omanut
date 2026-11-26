import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminContentTabs } from "@/components/admin/AdminContentTabs";
import { useCompany } from "@/context/CompanyContext";

const AdminDashboard = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedCompany, switchCompany } = useCompany();

  const activeTab = searchParams.get("tab") || "conversations";
  const companyParam = searchParams.get("company");

  useEffect(() => {
    if (companyParam && selectedCompany?.id !== companyParam) {
      switchCompany(companyParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyParam]);

  const handleTabChange = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    if (tab !== "ai-control") {
      next.delete("subtab");
      next.delete("section");
    }
    if (tab !== "conversations") {
      next.delete("conv");
    }
    setSearchParams(next, { replace: true });
  };

  return (
    <AdminLayout
      activeTab={activeTab}
      onTabChange={handleTabChange}
      showCompanyHeader
    >
      <AdminContentTabs activeTab={activeTab} onNavigateTab={handleTabChange} />
    </AdminLayout>
  );
};

export default AdminDashboard;
