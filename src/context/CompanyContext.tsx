import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Database } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';

type Company = Database['public']['Tables']['companies']['Row'];
type CompanyRole = 'owner' | 'manager' | 'contributor' | 'viewer';

interface CompanyMembership {
  company_id: string;
  company_name: string;
  role: CompanyRole;
  is_default: boolean;
}

interface CompanyContextType {
  selectedCompany: Company | null;
  setSelectedCompany: (company: Company | null) => void;
  userCompanies: CompanyMembership[];
  currentRole: CompanyRole | null;
  isLoading: boolean;
  refreshCompanies: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<void>;
  // Role check helpers
  isOwner: boolean;
  isManager: boolean;
  isContributor: boolean;
  canEdit: boolean;
  canManageUsers: boolean;
  canManageSettings: boolean;
  canDelete: boolean;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export const CompanyProvider = ({ children }: { children: ReactNode }) => {
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [userCompanies, setUserCompanies] = useState<CompanyMembership[]>([]);
  const [currentRole, setCurrentRole] = useState<CompanyRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUserCompanies = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setUserCompanies([]);
        setCurrentRole(null);
        setIsLoading(false);
        return;
      }

      // Use the security definer function to get user's companies
      const { data, error } = await supabase.rpc('get_user_companies');
      
      if (error) {
        console.error('Error fetching user companies:', error);
        setIsLoading(false);
        return;
      }

      const companies = (data || []) as CompanyMembership[];
      setUserCompanies(companies);

      // If we have a selected company, update the role
      if (selectedCompany) {
        const membership = companies.find(c => c.company_id === selectedCompany.id);
        setCurrentRole(membership?.role || null);
      } else if (companies.length > 0) {
        // Restore previously selected company from localStorage if still accessible
        const storedId = typeof window !== 'undefined'
          ? localStorage.getItem('selectedCompanyId')
          : null;
        const storedMembership = storedId
          ? companies.find(c => c.company_id === storedId)
          : null;
        const target = storedMembership
          || companies.find(c => c.is_default)
          || companies[0];
        if (target) {
          await loadCompanyDetails(target.company_id);
          setCurrentRole(target.role);
        }
      }
    } catch (err) {
      console.error('Error in fetchUserCompanies:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany]);

  const loadCompanyDetails = async (companyId: string) => {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    if (!error && data) {
      setSelectedCompany(data);
      try {
        localStorage.setItem('selectedCompanyId', data.id);
      } catch {}
    }
  };

  const switchCompany = async (companyId: string) => {
    const membership = userCompanies.find(c => c.company_id === companyId);
    if (!membership) return;

    setIsLoading(true);
    try {
      localStorage.setItem('selectedCompanyId', companyId);
    } catch {}
    await loadCompanyDetails(companyId);
    setCurrentRole(membership.role);
    setIsLoading(false);
  };

  const refreshCompanies = async () => {
    setIsLoading(true);
    await fetchUserCompanies();
  };

  // Update role when selected company changes
  useEffect(() => {
    if (selectedCompany && userCompanies.length > 0) {
      const membership = userCompanies.find(c => c.company_id === selectedCompany.id);
      setCurrentRole(membership?.role || null);
    }
  }, [selectedCompany, userCompanies]);

  // Fetch companies on mount and auth state change
  useEffect(() => {
    fetchUserCompanies();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchUserCompanies();
    });

    return () => subscription.unsubscribe();
  }, [fetchUserCompanies]);

  // Role check helpers
  const isOwner = currentRole === 'owner';
  const isManager = currentRole === 'owner' || currentRole === 'manager';
  const isContributor = isManager || currentRole === 'contributor';
  const canEdit = isContributor;
  const canManageUsers = isManager;
  const canManageSettings = isManager;
  const canDelete = isManager;

  return (
    <CompanyContext.Provider value={{ 
      selectedCompany, 
      setSelectedCompany,
      userCompanies,
      currentRole,
      isLoading,
      refreshCompanies,
      switchCompany,
      isOwner,
      isManager,
      isContributor,
      canEdit,
      canManageUsers,
      canManageSettings,
      canDelete,
    }}>
      {children}
    </CompanyContext.Provider>
  );
};

export const useCompany = () => {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
};

// Convenience hook for role-based access
export const useCompanyRole = () => {
  const { 
    currentRole, 
    isOwner, 
    isManager, 
    isContributor, 
    canEdit, 
    canManageUsers, 
    canManageSettings,
    canDelete 
  } = useCompany();
  
  return {
    role: currentRole,
    isOwner,
    isManager,
    isContributor,
    canView: true, // All roles can view
    canEdit,
    canManageUsers,
    canManageSettings,
    canDelete,
  };
};
