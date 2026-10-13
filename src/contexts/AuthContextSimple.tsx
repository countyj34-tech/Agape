import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { getSettings, saveSettings, initializeSettings } from '@/lib/db';
import type { Settings } from '@/types/pos';
import { 
  signUpCompanyAdmin, 
  loginWithCredentials, 
  logout as authLogout,
  isAuthenticated,
  getCurrentUser,
  getCurrentUserMembership,
  changePin as authChangePin,
  resetPin as authResetPin,
  type UserMembership,
  type Company,
  type CompanySignupData,
  type LoginCredentials
} from '@/lib/multiTenantAuthSimple';

interface AuthContextType {
  isAdminAuthenticated: boolean;
  isPinSetup: boolean;
  isSettingsReady: boolean;
  settings: Settings | null;
  user: any;
  membership: UserMembership | null;
  company: Company | null;
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
  signup: (data: CompanySignupData) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  changePin: (oldPin: string, newPin: string) => Promise<{ success: boolean; error?: string }>;
  resetPin: (phone: string, newPin: string) => Promise<{ success: boolean; error?: string }>;
  refreshSettings: () => Promise<void>;
  refreshUserMembership: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [user, setUser] = useState<any>(null);
  const [membership, setMembership] = useState<UserMembership | null>(null);
  const [company, setCompany] = useState<Company | null>(null);

  const refreshSettings = useCallback(async () => {
    const s = await initializeSettings();
    setSettings(s);
    setSettingsReady(true);
  }, []);

  const refreshUserMembership = useCallback(async () => {
    const isAuth = await isAuthenticated();
    if (isAuth) {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
      
      const { membership: userMembership, company: userCompany } = await getCurrentUserMembership();
      setMembership(userMembership || null);
      setCompany(userCompany || null);
      
      if (userMembership && userCompany) {
        // Update settings with company data
        const updatedSettings: Settings = {
          ...settings,
          companyId: userCompany.id,
          currency: userCompany.currency,
          currencySymbol: userCompany.currency_symbol,
          userRole: userMembership.role as any,
        };
        await saveSettings(updatedSettings);
        setSettings(updatedSettings);
      }
    } else {
      setUser(null);
      setMembership(null);
      setCompany(null);
    }
  }, [settings]);

  useEffect(() => {
    refreshSettings();
    refreshUserMembership();
  }, [refreshSettings, refreshUserMembership]);

  // Auto-lock on inactivity
  useEffect(() => {
    if (!isAdminAuthenticated) return;

    const checkInactivity = () => {
      if (Date.now() - lastActivity > INACTIVITY_TIMEOUT) {
        setIsAdminAuthenticated(false);
      }
    };

    const interval = setInterval(checkInactivity, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, [isAdminAuthenticated, lastActivity]);

  // Track activity
  useEffect(() => {
    if (!isAdminAuthenticated) return;

    const updateActivity = () => setLastActivity(Date.now());
    
    window.addEventListener('click', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('touchstart', updateActivity);

    return () => {
      window.removeEventListener('click', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('touchstart', updateActivity);
    };
  }, [isAdminAuthenticated]);

  const login = async (credentials: LoginCredentials): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await loginWithCredentials(credentials);
      
      if (result.success) {
        setUser(result.user);
        setMembership(result.membership || null);
        setCompany(result.company || null);
        setIsAdminAuthenticated(true);
        setLastActivity(Date.now());
        
        // Update settings with company data
        if (result.company) {
          const updatedSettings: Settings = {
            ...settings,
            companyId: result.company.id,
            currency: result.company.currency,
            currencySymbol: result.company.currency_symbol,
            userRole: result.membership?.role as any,
            pinSetupComplete: true,
          };
          await saveSettings(updatedSettings);
          setSettings(updatedSettings);
        }
        
        return { success: true };
      }
      
      return { success: false, error: result.error };
    } catch (error: any) {
      console.error('Login error:', error);
      return { success: false, error: error.message || 'Login failed' };
    }
  };

  const signup = async (data: CompanySignupData): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await signUpCompanyAdmin(data);
      
      if (result.success) {
        setUser(result.user);
        setMembership(result.membership || null);
        setCompany(result.company || null);
        setIsAdminAuthenticated(true);
        setLastActivity(Date.now());
        
        // Update settings with company data
        if (result.company) {
          const updatedSettings: Settings = {
            ...settings,
            companyId: result.company.id,
            currency: result.company.currency,
            currencySymbol: result.company.currency_symbol,
            userRole: result.membership?.role as any,
            pinSetupComplete: true,
          };
          await saveSettings(updatedSettings);
          setSettings(updatedSettings);
        }
        
        return { success: true };
      }
      
      return { success: false, error: result.error };
    } catch (error: any) {
      console.error('Signup error:', error);
      return { success: false, error: error.message || 'Signup failed' };
    }
  };

  const logout = async () => {
    await authLogout();
    setUser(null);
    setMembership(null);
    setCompany(null);
    setIsAdminAuthenticated(false);
    
    if (settings) {
      const updatedSettings: Settings = {
        ...settings,
        userRole: undefined,
        assignedStoreId: null,
      };
      await saveSettings(updatedSettings);
      setSettings(updatedSettings);
    }
  };

  const changePin = async (oldPin: string, newPin: string): Promise<{ success: boolean; error?: string }> => {
    return authChangePin(oldPin, newPin);
  };

  const resetPin = async (phone: string, newPin: string): Promise<{ success: boolean; error?: string }> => {
    return authResetPin(phone, newPin);
  };

  const isPinSetup = settingsReady && (settings?.pinSetupComplete ?? false);

  return (
    <AuthContext.Provider
      value={{
        isAdminAuthenticated,
        isPinSetup,
        isSettingsReady: settingsReady,
        settings,
        user,
        membership,
        company,
        login,
        signup,
        logout,
        changePin,
        resetPin,
        refreshSettings,
        refreshUserMembership,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
