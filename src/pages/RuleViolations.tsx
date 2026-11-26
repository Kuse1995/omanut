import { useCompany } from "@/context/CompanyContext";
import ClientLayout from "@/components/dashboard/ClientLayout";
import { RuleViolationsPanel } from "@/components/admin/RuleViolationsPanel";

export default function RuleViolations() {
  const { selectedCompany } = useCompany();

  return (
    <ClientLayout>
      {selectedCompany ? (
        <RuleViolationsPanel companyId={selectedCompany.id} mode="client" />
      ) : (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Select a company to view rule violations.
        </div>
      )}
    </ClientLayout>
  );
}
