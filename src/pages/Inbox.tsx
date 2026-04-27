import ClientLayout from "@/components/dashboard/ClientLayout";
import { CompanyInbox } from "@/components/inbox/CompanyInbox";
import ThemeToggle from "@/components/ThemeToggle";

const Inbox = () => {
  return (
    <ClientLayout>
      <div className="p-4 sm:p-6 lg:p-8 pb-24 md:pb-8">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Inbox</h1>
            <p className="text-muted-foreground mt-1">
              Facebook & Instagram messages and comments — review AI drafts before they go out.
            </p>
          </div>
          <ThemeToggle />
        </header>
        <CompanyInbox />
      </div>
    </ClientLayout>
  );
};

export default Inbox;
