import { ReactNode } from 'react';
import { RequireCompany } from './RequireCompany';
import { CompanyProvider } from '@/context/CompanyContext';

interface CompanyProtectedRoutesProps {
  children: ReactNode;
}

/**
 * Wraps entire feature sections that require company context.
 * This centralizes the guard instead of repeating it in every component.
 * 
 * Usage in App.tsx:
 * <CompanyProtectedRoutes>
 *   <Routes>
 *     <Route path="/dashboard" element={<Dashboard />} />
 *     <Route path="/conversations" element={<Conversations />} />
 *     ...
 *   </Routes>
 * </CompanyProtectedRoutes>
 */
export function CompanyProtectedRoutes({ children }: CompanyProtectedRoutesProps) {
  return (
    <CompanyProvider>
      <RequireCompany>
        {children}
      </RequireCompany>
    </CompanyProvider>
  );
}

export default CompanyProtectedRoutes;
