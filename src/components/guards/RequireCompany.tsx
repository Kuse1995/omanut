import { ReactNode } from 'react';
import { useCompany } from '@/context/CompanyContext';
import { Building2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompanySwitcher } from '@/components/admin/CompanySwitcher';

interface RequireCompanyProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Guard component that ensures a company is selected before rendering children.
 * Use this to wrap any feature that operates within company context.
 */
export function RequireCompany({ children, fallback }: RequireCompanyProps) {
  const { selectedCompany, isLoading, userCompanies } = useCompany();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!selectedCompany) {
    if (fallback) {
      return <>{fallback}</>;
    }

    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <div className="rounded-full bg-muted p-4">
            <Building2 className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold">No Company Selected</h2>
          {userCompanies.length > 0 ? (
            <>
              <p className="text-muted-foreground">
                Please select a company to continue.
              </p>
              <div className="w-64 mt-2">
                <CompanySwitcher />
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">
              You don't have access to any companies yet. 
              Please contact an administrator to get access.
            </p>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Hook to require company context in a component.
 * Throws if no company is selected - use with error boundary or RequireCompany wrapper.
 */
export function useRequireCompany() {
  const context = useCompany();
  
  if (!context.selectedCompany && !context.isLoading) {
    throw new CompanyContextError('No company selected. This feature requires a company context.');
  }
  
  return {
    ...context,
    company: context.selectedCompany!, // Non-null assertion since we check above
  };
}

/**
 * Custom error for company context violations
 */
export class CompanyContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompanyContextError';
  }
}

/**
 * Helper function to assert company context exists.
 * Use in functions/handlers that must operate within a company.
 */
export function assertCompanyContext(companyId: string | null | undefined, operation: string): asserts companyId is string {
  if (!companyId) {
    throw new CompanyContextError(
      `Cannot ${operation}: No company context. Please select a company first.`
    );
  }
}

export default RequireCompany;
