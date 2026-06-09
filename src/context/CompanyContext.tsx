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

const STORAGE_KEY = 'selectedCompanyId';
const RECENTS_KEY = 'recentCompanyIds';
const MAX_RECENTS = 5;

const readStoredId = (): string | null => {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
};

const writeStoredId = (id: string | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
};

const pushRecent = (id: string) => {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const arr: string[] = raw ? JSON.parse(raw) : [];
    const next = [id, ...arr.filter((x) => x !== id)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {}
};

export const getRecentCompanyIds = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

export const CompanyProvider = ({ children }: { children: ReactNode }) => {
  const [selectedCompany, setSelectedCompanyState] = useState<Company | null>(null);
  const [userCompanies, setUserCompanies] = useState<CompanyMembership[]>([]);
  const [currentRole, setCurrentRole] = useState<CompanyRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Persistent setter — writes to localStorage on every change.
  const setSelectedCompany = useCallback((company: Company | null) => {
    setSelectedCompanyState(company);
    writeStoredId(company?.id ?? null);
    if (company?.id) pushRecent(company.id);
  }, []);

  const loadCompanyDetails = useCallback(async (companyId: string): Promise<Company | null> => {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .maybeSingle();

    if (!error && data) {
      setSelectedCompanyState(data);
      writeStoredId(data.id);
      pushRecent(data.id);
      return data;
    }
    return null;
  }, []);

  const fetchUserCompanies = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setUserCompanies([]);
        setCurrentRole(null);
        setSelectedCompanyState(null);
        writeStoredId(null);
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase.rpc('get_user_companies');
      if (error) {
        console.error('Error fetching user companies:', error);
      }
      const companies = (data || []) as CompanyMembership[];
      setUserCompanies(companies);

      const storedId = readStoredId();

      // Already have a selection → just refresh role
      if (selectedCompany) {
        const membership = companies.find(c => c.company_id === selectedCompany.id);
        setCurrentRole(membership?.role || null);
        setIsLoading(false);
        return;
      }

      // 1. Try stored ID (works for admins too — they may not be members).
      if (storedId) {
        const loaded = await loadCompanyDetails(storedId);
        if (loaded) {
          const membership = companies.find(c => c.company_id === loaded.id);
          setCurrentRole(membership?.role || null);
          setIsLoading(false);
          return;
        }
      }

      // 2. Fall back to default / first membership.
      if (companies.length > 0) {
        const target = companies.find(c => c.is_default) || companies[0];
        await loadCompanyDetails(target.company_id);
        setCurrentRole(target.role);
      }
    } catch (err) {
      console.error('Error in fetchUserCompanies:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany, loadCompanyDetails]);

  const switchCompany = async (companyId: string) => {
    setIsLoading(true);
    const loaded = await loadCompanyDetails(companyId);
    const membership = userCompanies.find(c => c.company_id === companyId);
    setCurrentRole(membership?.role || null);
    setIsLoading(false);
    if (!loaded) {
      console.warn('switchCompany: company not accessible', companyId);
    }
  };

  const refreshCompanies = async () => {
    setIsLoading(true);
    await fetchUserCompanies();
  };

  useEffect(() => {
    if (selectedCompany && userCompanies.length > 0) {
      const membership = userCompanies.find(c => c.company_id === selectedCompany.id);
      setCurrentRole(membership?.role || null);
    }
  }, [selectedCompany, userCompanies]);

  useEffect(() => {
    fetchUserCompanies();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchUserCompanies();
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
