import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { getSettings, saveSettings, initializeSettings } from '@/lib/db';
import { getCompanyById } from '@/lib/companyManagement';
import type { Settings } from '@/types/pos';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  signUpCompanyAdmin,
  loginWithCredentials as loginWithCredentialsService,
  logout as authLogout,
  type CompanySignupData,
  type LoginCredentials,
} from '@/lib/multiTenantAuth';

interface AuthContextType {
  isAdminAuthenticated: boolean;
  isPinSetup: boolean;
  isSettingsReady: boolean;
  settings: Settings | null;
  login: (pin: string) => Promise<boolean>;
  setupPin: (pin: string) => Promise<void>;
  loginWithCredentials: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
  signup: (data: CompanySignupData) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  changePin: (oldPin: string, newPin: string) => Promise<boolean>;
  resetPin: (phone: string, newPin: string) => Promise<boolean>;
  refreshSettings: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [lastActivity, setLastActivity] = useState(Date.now());

  const refreshSettings = useCallback(async () => {
    const s = await initializeSettings();
    setSettings(s);
    setSettingsReady(true);
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

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

  const persistSettings = async (updatedSettings: Settings) => {
    await saveSettings(updatedSettings);
    setSettings(updatedSettings);
  };

  const signup = async (data: CompanySignupData): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await signUpCompanyAdmin(data);
      if (!result.success) {
        return { success: false, error: result.error };
      }

      if (result.company && settings) {
        const updatedSettings: Settings = {
          ...settings,
          companyId: result.company.id,
          shopName: result.company.name,
          shopPhone: result.company.owner_phone || settings.shopPhone,
          shopAddress: result.company.address || settings.shopAddress,
          currency: result.company.currency || settings.currency,
          currencySymbol: result.company.currency_symbol || settings.currencySymbol,
          userRole: (result.profile?.role as Settings['userRole']) || 'owner',
          pinSetupComplete: true,
        };

        await persistSettings(updatedSettings);
      }

      if (result.profile?.role) {
        setIsAdminAuthenticated(result.profile.role === 'owner' || result.profile.role === 'admin' || result.profile.role === 'manager');
      }

      return { success: true };
    } catch (error: any) {
      console.error('Signup error:', error);
      return { success: false, error: error.message || 'Signup failed' };
    }
  };

  const loginWithCredentials = async (credentials: LoginCredentials): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await loginWithCredentialsService(credentials);
      if (!result.success) {
        return { success: false, error: result.error };
      }

      if (result.company && settings) {
        const updatedSettings: Settings = {
          ...settings,
          companyId: result.company.id,
          shopName: result.company.name || settings.shopName,
          shopPhone: result.company.owner_phone || settings.shopPhone,
          shopAddress: result.company.address || settings.shopAddress,
          currency: result.company.currency || settings.currency,
          currencySymbol: result.company.currency_symbol || settings.currencySymbol,
          userRole: (result.profile?.role as Settings['userRole']) || settings.userRole,
        };

        await persistSettings(updatedSettings);
      }

      if (result.profile?.role) {
        setIsAdminAuthenticated(result.profile.role === 'owner' || result.profile.role === 'admin' || result.profile.role === 'manager');
      }

      return { success: true };
    } catch (error: any) {
      console.error('Login with credentials error:', error);
      return { success: false, error: error.message || 'Login failed' };
    }
  };

  const login = async (pin: string): Promise<boolean> => {
    const normalizedPin = pin.trim();
    if (!normalizedPin || !settings) {
      return false;
    }

    let validPin = settings.adminPin === normalizedPin;

    if (!validPin && isSupabaseConfigured() && settings.companyId) {
      const remoteCompany = await getCompanyById(settings.companyId);
      if (remoteCompany?.ownerPin === normalizedPin) {
        validPin = true;
      }
    }

    if (!validPin) {
      return false;
    }

    setIsAdminAuthenticated(true);
    setLastActivity(Date.now());
    return true;
  };

  const setupPin = async (pin: string) => {
    if (!settings) return;

    const updatedSettings: Settings = {
      ...settings,
      adminPin: pin.trim(),
      pinSetupComplete: true,
    };

    await saveSettings(updatedSettings);
    setSettings(updatedSettings);
    setIsAdminAuthenticated(true);
    setLastActivity(Date.now());
  };

  const logout = () => {
    if (isSupabaseConfigured()) {
      authLogout().catch(console.error);
    }

    setIsAdminAuthenticated(false);

    if (settings) {
      const updatedSettings: Settings = {
        ...settings,
        userRole: undefined,
        assignedStoreId: null,
      };

      saveSettings(updatedSettings).catch(console.error);
      setSettings(updatedSettings);
    }
  };

  const changePin = async (oldPin: string, newPin: string): Promise<boolean> => {
    if (!settings || settings.adminPin !== oldPin) {
      return false;
    }
    
    if (isSupabaseConfigured()) {
      await supabase.auth.updateUser({
        password: newPin,
      });
    }

    const updatedSettings: Settings = {
      ...settings,
      adminPin: newPin,
    };
    
    await saveSettings(updatedSettings);
    setSettings(updatedSettings);
    return true;
  };

  const resetPin = async (phone: string, newPin: string): Promise<boolean> => {
    if (!settings) return false;

    // Normalize phone number
    const normalizedPhone = phone.trim().replace(/\D/g, '');
    if (normalizedPhone.length < 10) {
      return false;
    }

    // Check if phone belongs to a company owner
    const { getCompanyByOwnerPhone, updateCompany } = await import('@/lib/companyManagement');
    const company = await getCompanyByOwnerPhone(normalizedPhone);
    
    // Check if phone belongs to a direct store owner
    let storeFound = false;
    if (isSupabaseConfigured()) {
      const { data: stores } = await supabase
        .from('stores')
        .select('*')
        .eq('phone', normalizedPhone);
      
      if (stores && stores.length > 0) {
        storeFound = true;
      }
    }
    
    // If neither company nor store found, return false
    if (!company && !storeFound) {
      return false;
    }

    // Update company PIN if found
    if (company) {
      await updateCompany(company.id, { ownerPin: newPin });

      const updatedSettings: Settings = {
        ...settings,
        adminPin: newPin,
      };
      await saveSettings(updatedSettings);
      setSettings(updatedSettings);
      setIsAdminAuthenticated(true);
      setLastActivity(Date.now());
      return true;
    }

    // Update store PIN if found (by updating local settings for this device)
    if (storeFound) {
      const updatedSettings: Settings = {
        ...settings,
        adminPin: newPin,
      };
      
      await saveSettings(updatedSettings);
      setSettings(updatedSettings);
      
      if (isSupabaseConfigured()) {
        try {
          await supabase.auth.updateUser({
            password: newPin,
          });
        } catch (error) {
          console.error('Failed to update Supabase password:', error);
        }
      }
      
      setIsAdminAuthenticated(true);
      setLastActivity(Date.now());
      return true;
    }

    return true;
  };

  const isPinSetup = settingsReady && (settings?.pinSetupComplete ?? false);

  return (
    <AuthContext.Provider
      value={{
        isAdminAuthenticated,
        isPinSetup,
        isSettingsReady: settingsReady,
        settings,
        login,
        setupPin,
        loginWithCredentials,
        signup,
        logout,
        changePin,
        resetPin,
        refreshSettings,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    console.warn('useAuth called outside AuthProvider; returning fallback legacy auth state.');
    return {
      isAdminAuthenticated: false,
      isPinSetup: false,
      isSettingsReady: false,
      settings: null,
      login: async () => false,
      setupPin: async () => {},
      loginWithCredentials: async () => ({ success: false, error: 'Auth provider not initialized' }),
      signup: async () => ({ success: false, error: 'Auth provider not initialized' }),
      logout: () => {},
      changePin: async () => false,
      resetPin: async () => false,
      refreshSettings: async () => {},
    };
  }
  return context;
}
