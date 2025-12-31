import { ReactNode } from 'react';
import { useCompanyRole } from '@/hooks/useCompanyRole';
import { ShieldX } from 'lucide-react';

type CompanyRole = 'owner' | 'manager' | 'contributor' | 'viewer';

interface RequireRoleProps {
  children: ReactNode;
  role: CompanyRole;
  fallback?: ReactNode;
}

/**
 * Guard component that ensures user has at least the specified role.
 * Use this to wrap features that require specific permissions.
 * 
 * Role hierarchy (highest to lowest):
 * - owner: Full access
 * - manager: Can manage content and users
 * - contributor: Can create/edit content
 * - viewer: Read-only access
 */
export function RequireRole({ children, role, fallback }: RequireRoleProps) {
  const { hasRole, role: currentRole } = useCompanyRole();

  if (!hasRole(role)) {
    if (fallback) {
      return <>{fallback}</>;
    }

    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] p-8">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <ShieldX className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="text-xl font-semibold">Access Denied</h2>
          <p className="text-muted-foreground">
            This feature requires <span className="font-medium">{role}</span> role or higher.
            {currentRole && (
              <> Your current role is <span className="font-medium">{currentRole}</span>.</>
            )}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Convenience components for common role requirements
 */
export function RequireOwner({ children, fallback }: Omit<RequireRoleProps, 'role'>) {
  return <RequireRole role="owner" fallback={fallback}>{children}</RequireRole>;
}

export function RequireManager({ children, fallback }: Omit<RequireRoleProps, 'role'>) {
  return <RequireRole role="manager" fallback={fallback}>{children}</RequireRole>;
}

export function RequireContributor({ children, fallback }: Omit<RequireRoleProps, 'role'>) {
  return <RequireRole role="contributor" fallback={fallback}>{children}</RequireRole>;
}

export default RequireRole;
