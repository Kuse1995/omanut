import { useCompany } from '@/context/CompanyContext';

type CompanyRole = 'owner' | 'manager' | 'contributor' | 'viewer';

interface UseCompanyRoleResult {
  role: CompanyRole | null;
  isOwner: boolean;
  isManager: boolean;
  isContributor: boolean;
  isViewer: boolean;
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canManageUsers: boolean;
  canManageSettings: boolean;
  canManageBilling: boolean;
  hasRole: (requiredRole: CompanyRole) => boolean;
}

/**
 * Hook for checking user's role and permissions within the current company
 * 
 * Role Hierarchy (highest to lowest):
 * - owner: Full access - can delete company, manage all users, all settings
 * - manager: Can manage content, users (except owners), settings
 * - contributor: Can create/edit content, view all data
 * - viewer: Read-only access to company data
 */
export const useCompanyRole = (): UseCompanyRoleResult => {
  const { currentRole } = useCompany();

  const roleHierarchy: Record<CompanyRole, number> = {
    owner: 0,
    manager: 1,
    contributor: 2,
    viewer: 3,
  };

  const hasRole = (requiredRole: CompanyRole): boolean => {
    if (!currentRole) return false;
    return roleHierarchy[currentRole] <= roleHierarchy[requiredRole];
  };

  const isOwner = currentRole === 'owner';
  const isManager = hasRole('manager');
  const isContributor = hasRole('contributor');
  const isViewer = hasRole('viewer');

  return {
    role: currentRole,
    isOwner,
    isManager,
    isContributor,
    isViewer,
    canView: isViewer, // All roles can view
    canEdit: isContributor, // Contributors and above can edit
    canDelete: isManager, // Managers and above can delete
    canManageUsers: isManager, // Managers and above can manage users
    canManageSettings: isManager, // Managers and above can manage settings
    canManageBilling: isOwner, // Only owners can manage billing
    hasRole,
  };
};

export default useCompanyRole;
