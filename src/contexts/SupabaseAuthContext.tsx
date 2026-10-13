import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { getSettings, saveSettings, initializeSettings } from '@/lib/db';
import type { Settings } from '@/types/pos';
import type { 
  UserProfile,
  UserMembership,
  Company,
  Store
} from '@/lib/supabaseAuth';
import { signUpCompanyAdmin as signUpCompanyAdminEdge, type CompanySignupData as EdgeCompanySignupData } from '@/lib/multiTenantAuth';
import { 
  signUpCompanyAdmin, 
  signIn, 
  signOut as authLogout,
  isAuthenticated,
  getCurrentUser,
  getCurrentCompany,
  getCurrentStore,
  updateCompany,
  getCompanyStores,
  getCompanyMembers,
  createCompanyMember,
  type CompanySignupData,
  type LoginCredentials
} from '@/lib/supabaseAuth';
import { pruneLocalDataForCompany, clearAllLocalTenantData, bindDeviceToCompany, getDeviceCompanyId } from '@/lib/companyManagement';
import { runBackgroundSync } from '@/lib/sync';
import { isSupabaseConfigured } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';
import { isAdminRole } from '@/lib/permissions';
import { isOfflineMasterCredentials, unlockOfflineMaster, isMasterSessionActive, setMasterSessionActive, clearMasterSession, MASTER_EMAIL } from '@/lib/offlineMasterAuth';

interface SupabaseAuthContextType {
  isAdminAuthenticated: boolean;
  isPinSetup: boolean;
  isSettingsReady: boolean;
  isAuthReady: boolean;
  settings: Settings | null;
  user: any;
  profile: any;
  membership: any;
  company: any;
  store: any;
  stores: any[];
  members: any[];
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
    signup: (data: EdgeCompanySignupData) => Promise<{ success: boolean; error?: string }>;
  createMember: (data: any) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  changePin: (oldPin: string, newPin: string) => Promise<{ success: boolean; error?: string }>;
  resetPin: (phone: string, newPin: string) => Promise<{ success: boolean; error?: string }>;
  updateProfile: (updates: any) => Promise<{ success: boolean; error?: string }>;
  updateCompany: (updates: any) => Promise<{ success: boolean; error?: string }>;
  refreshSettings: () => Promise<void>;
  refreshUserProfile: () => Promise<void>;
  refreshCompanyData: () => Promise<void>;
}

  // Type alias for signup data (using the multiTenantAuth version which is what's actually called)
  type SignupData = EdgeCompanySignupData;

  // Export SignupData for use in consumers
  export type { SignupData as CompanySignupData };

const SupabaseAuthContext = createContext<SupabaseAuthContextType | undefined>(undefined);

const ADMIN_AUTH_STORAGE_KEY = 'mthunzi_admin_authenticated';

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(() => {
    try {
      return localStorage.getItem(ADMIN_AUTH_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [membership, setMembership] = useState<UserMembership | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const settingsRef = useRef<Settings | null>(null);
  settingsRef.current = settings;

  const refreshSettings = useCallback(async () => {
    const s = await initializeSettings();
    // Never let a background refresh downgrade an active master session
    if (isMasterSessionActive() && s.userRole !== 'super_admin') {
      const patched = { ...s, userRole: 'super_admin' as const, pinSetupComplete: true };
      await saveSettings(patched);
      setSettings(patched);
      settingsRef.current = patched;
      return;
    }
    setSettings(s);
    settingsRef.current = s;
    setSettingsReady(true);
    try {
      // If a localStorage activation marker exists, ensure settings reflects it
      const ACT_STATUS = 'mthunzi_activation_status';
      const ACT_KEY = 'mthunzi_activation_key';
      const fromStatus = typeof window !== 'undefined' && localStorage.getItem(ACT_STATUS) === 'true';
      const hasKey = typeof window !== 'undefined' && Boolean((localStorage.getItem(ACT_KEY) || '').trim());
      if ((fromStatus || hasKey) && !s.isActivated) {
        const updated = { ...s, isActivated: true, activationKey: (localStorage.getItem(ACT_KEY) || s.activationKey || '') };
        await saveSettings(updated);
        setSettings(updated);
      }
    } catch (e) {
      // ignore storage errors
    }
  }, []);

  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    try {
      if (isAdminAuthenticated || isMasterSessionActive()) {
        localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, 'true');
      } else {
        localStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }, [isAdminAuthenticated]);

  const refreshCompanyData = useCallback(async () => {
    if (!company) return;

    try {
      if (isSupabaseConfigured()) {
        const { success: storesSuccess, stores: companyStores } = await getCompanyStores(company.id);
        if (storesSuccess && companyStores) {
          setStores(companyStores);
        }

        const { success: membersSuccess, members: companyMembers } = await getCompanyMembers(company.id);
        if (membersSuccess && companyMembers) {
          setMembers(companyMembers);
        }
      } else {
        console.log('Supabase not available, skipping company data refresh');
        setStores([]);
        setMembers([]);
      }
    } catch (error) {
      console.error('Error refreshing company data:', error);
      setStores([]);
      setMembers([]);
    }
  }, [company]);

  const refreshUserProfile = useCallback(async () => {
    // Return existing promise if refresh is in progress
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    refreshPromiseRef.current = (async () => {
      try {
        const currentSettings = settingsRef.current;

        // Master session is local-first — do not let Supabase profile refresh wipe it
        if (isMasterSessionActive()) {
          setIsAdminAuthenticated(true);
          if (currentSettings?.userRole !== 'super_admin') {
            const patched: Settings = {
              ...(currentSettings || (await initializeSettings())),
              userRole: 'super_admin',
              pinSetupComplete: true,
              isActivated: true,
              activationLockEnabled: false,
              updatedAt: new Date(),
            };
            await saveSettings(patched);
            setSettings(patched);
            settingsRef.current = patched;
          }
          // Restore company/store so POS FirstRunGate does not bounce to login.
          try {
            const offline = await unlockOfflineMaster();
            if (offline.success) {
              setUser({ id: 'offline-master', email: MASTER_EMAIL });
              setCompany(offline.company);
              setStore(offline.store);
              if (offline.settings) {
                setSettings(offline.settings);
                settingsRef.current = offline.settings;
              }
            }
          } catch (masterRestoreError) {
            console.warn('Master company restore skipped:', masterRestoreError);
          }
          return;
        }

        // Check if Supabase is configured before trying authentication
        if (isSupabaseConfigured()) {
          const isAuth = await isAuthenticated();
          if (isAuth) {
            const currentUser = await Promise.race([
              getCurrentUser(),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
            ]);
            setUser(currentUser);

            if (!currentUser) {
              return;
            }

            const profilePromise = supabase
              .from('profiles')
              .select('id, company_id, store_id, role, email, phone')
              .eq('id', currentUser.id)
              .maybeSingle();
            const membershipPromise = supabase
              .from('memberships')
              .select('*')
              .eq('user_id', currentUser.id)
              .maybeSingle();

            const [{ data: remoteProfile }, { data: remoteMembership }] = await Promise.race([
              Promise.all([profilePromise, membershipPromise]),
              new Promise<[{ data: null }, { data: null }]>((resolve) =>
                setTimeout(() => resolve([{ data: null }, { data: null }]), 2500)
              ),
            ]);

            const resolvedRole =
              remoteMembership?.role ||
              remoteProfile?.role ||
              (isAdminRole(currentSettings?.userRole) ? currentSettings?.userRole : 'staff');
            const isAdmin = isAdminRole(resolvedRole);
            setIsAdminAuthenticated(isAdmin);

            const userCompany = await Promise.race([
              getCurrentCompany(),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
            ]);
            const userStore = await Promise.race([
              getCurrentStore(),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
            ]);
            setProfile((remoteProfile as UserProfile) || null);
            setMembership((remoteMembership as UserMembership) || null);
            setCompany(userCompany || null);
            setStore(userStore || null);

            if (userCompany) {
              const updatedSettings: Settings = {
                ...(currentSettings || (await initializeSettings())),
                companyId: userCompany.id,
                currency: userCompany.currency,
                currencySymbol: userCompany.currencySymbol,
                userRole: resolvedRole as Settings['userRole'],
                assignedStoreId: userStore?.id || null,
                pinSetupComplete: true,
              };
              await saveSettings(updatedSettings);
              setSettings(updatedSettings);
              settingsRef.current = updatedSettings;

              await refreshCompanyData();
            }
          } else {
            // No cloud session — keep local admin state if present
            if (!isAdminRole(currentSettings?.userRole)) {
              setUser(null);
              setProfile(null);
              setMembership(null);
              setCompany(null);
              setStore(null);
              setStores([]);
              setMembers([]);
            }
          }
        } else {
          // Supabase not configured — keep existing local session (don't reset to staff)
          if (!currentSettings?.companyId && !isAdminRole(currentSettings?.userRole)) {
            console.log('Supabase not available, running in offline mode');
            const offlineSettings: Settings = {
              ...(currentSettings || (await initializeSettings())),
              companyId: 'offline',
              currency: 'ZMW',
              currencySymbol: 'K',
              userRole: 'staff',
              assignedStoreId: null,
              pinSetupComplete: false,
            };
            await saveSettings(offlineSettings);
            setSettings(offlineSettings);
            settingsRef.current = offlineSettings;
          }
        }
      } catch (error: any) {
        // Filter out lock errors to prevent console spam
        if (error?.message && !String(error.message).includes('Lock')) {
          console.error('Error refreshing user profile:', error);
        }
      } finally {
        // Clear promise after refresh completes
        setTimeout(() => {
          refreshPromiseRef.current = null;
        }, 1000);
        // Do not overwrite stores, members or saved settings here —
        // refresh logic above already sets them appropriately when available.
      }
    })();

    return refreshPromiseRef.current;
  }, [refreshCompanyData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Local settings first — POS can render without waiting on cloud.
      try {
        const local = await initializeSettings();
        if (!cancelled) {
          const offlineRestore = local?.companyId
            ? null
            : await (async () => {
                try {
                  const { restoreOfflineLocalSession } = await import('@/lib/offlineStartup');
                  const restored = await restoreOfflineLocalSession(local);
                  return restored.success ? restored : null;
                } catch {
                  return null;
                }
              })();

          if (offlineRestore?.success && offlineRestore.settings) {
            setSettings(offlineRestore.settings);
            if (offlineRestore.company) setCompany(offlineRestore.company);
            if (offlineRestore.store) setStore(offlineRestore.store);
          } else if (isMasterSessionActive() && local.userRole !== 'super_admin') {
            const patched = { ...local, userRole: 'super_admin' as const, pinSetupComplete: true };
            await saveSettings(patched);
            setSettings(patched);
          } else {
            setSettings((prev) => prev ?? local);
          }
          setSettingsReady(true);
          setAuthReady(true);
        }
      } catch {
        if (!cancelled) {
          setSettingsReady(true);
          setAuthReady(true);
        }
      }

      // Cloud refresh in background — never block cashier taps.
      try {
        await Promise.race([
          Promise.all([refreshSettings(), refreshUserProfile()]),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      } catch {
        /* ignore offline */
      }

      if (cancelled) return;
      try {
        const s = await initializeSettings();
        if (isMasterSessionActive() && s.userRole !== 'super_admin') {
          const patched = { ...s, userRole: 'super_admin' as const, pinSetupComplete: true };
          await saveSettings(patched);
          setSettings(patched);
        } else {
          setSettings((prev) => prev ?? s);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Bootstrap once on mount — avoid re-running after login and wiping master session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyOfflineMasterSession = async () => {
    const offline = await unlockOfflineMaster();
    if (!offline.success) {
      return { success: false as const, error: offline.error || 'Offline master unlock failed' };
    }

    try {
      localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, 'true');
    } catch {
      // ignore
    }

    setUser({ id: 'offline-master', email: MASTER_EMAIL });
    setProfile({
      id: 'offline-master',
      email: MASTER_EMAIL,
      full_name: 'Mthunzi Labs Master',
      role: 'super_admin',
      company_id: offline.company?.id,
    } as any);
    setMembership({
      user_id: 'offline-master',
      company_id: offline.company?.id,
      role: 'super_admin',
      is_active: true,
    } as any);
    setCompany(offline.company);
    setStore(offline.store);
    // Commit auth + role before login page navigates (avoids AdminGate bounce)
    flushSync(() => {
      setIsAdminAuthenticated(true);
      setSettings(offline.settings);
      settingsRef.current = offline.settings;
    });
    setMasterSessionActive();
    return { success: true as const, company: offline.company };
  };

  const login = async (credentials: LoginCredentials): Promise<{ success: boolean; error?: string; company?: any }> => {
    // Master: establish cloud session when possible, always grant local super_admin UI access.
    if (isOfflineMasterCredentials(credentials.emailOrPhone, credentials.pin)) {
      let cloudOk = false;
      try {
        const result = await Promise.race([
          signIn(credentials),
          new Promise<{ success: false; error: string }>((resolve) =>
            setTimeout(() => resolve({ success: false, error: 'Cloud login timed out' }), 6000)
          ),
        ]);

        if (result.success) {
          cloudOk = true;
          setUser(result.user);
          setProfile(
            result.profile ||
              ({
                id: result.user?.id,
                email: MASTER_EMAIL,
                full_name: 'Mthunzi Labs Master',
                role: 'super_admin',
              } as any)
          );
          setMembership(result.membership || null);
          if (result.company) setCompany(result.company);
          if (result.store) setStore(result.store);
        }
      } catch {
        // continue with offline unlock
      }

      // Always unlock local master role/settings so AdminGate lets us through
      const offline = await applyOfflineMasterSession();
      if (!offline.success) return offline;

      // If cloud signed in with a real company, prefer that company in UI state
      // (settings already have super_admin from offline unlock)
      if (cloudOk) {
        try {
          localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, 'true');
        } catch {
          // ignore
        }
      }

      return { success: true, company: offline.company };
    }

    try {
      const result = await signIn(credentials);

      if (result.success) {
        setUser(result.user);
        setProfile(result.profile || null);
        setMembership(result.membership || null);
        setCompany(result.company || null);
        setStore(result.store || null);

        // Resolve role once and reuse for admin detection + settings update
        const resolvedRole = result.membership?.role || result.profile?.role || 'staff';
        const isAdmin = isAdminRole(resolvedRole);
        setIsAdminAuthenticated(isAdmin);
        if (isAdmin) {
          try {
            localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, 'true');
          } catch {
            // ignore
          }
        }

        // Temporary debug helper: logs resolved role and admin flag to console
        // Remove when verification complete
        try {
          // eslint-disable-next-line no-console
          console.debug('AUTH-DEBUG login -> resolvedRole:', resolvedRole, 'isAdmin:', isAdmin, 'membership.role:', result.membership?.role, 'profile.role:', result.profile?.role);
        } catch (e) {
          // ignore console errors in environments where console isn't available
        }

        // Update settings with company data
        if (result.company) {
          const assignedStore = result.membership?.store_id || result.store?.id || null;
          const updatedSettings: Settings = {
            ...settings,
            companyId: result.company.id,
            currency: result.company.currency,
            currencySymbol: result.company.currencySymbol,
            userRole: resolvedRole as any,
            assignedStoreId: assignedStore,
            pinSetupComplete: true,
          };
          await saveSettings(updatedSettings);
          setSettings(updatedSettings);
          await bindDeviceToCompany(result.company.id);
        }

        // Enforce tenant isolation by pruning local cache before loading company data
        try {
          if (result.company?.id) {
            await pruneLocalDataForCompany(result.company.id);
          }
        } catch (e) {
          console.warn('Prune local data failed:', e);
        }

        await refreshCompanyData();
        // Background: push queued sales + pull catalog onto this device (never blocks login UI).
        void runBackgroundSync({
          storeId: result.store?.id || result.membership?.store_id || undefined,
          pullCatalog: true,
        });
        return result;
      }

      return result;
    } catch (error: any) {
      console.error('Login error:', error);
      return { success: false, error: error.message || 'Login failed' };
    }
  };

  const signup = async (data: SignupData): Promise<{ success: boolean; error?: string }> => {
    try {
      // Use the SupabaseFirst/Edge-function signup which creates users via
      // server-side logic (avoids client-triggered confirmation emails and rate limits).
        const result = await signUpCompanyAdminEdge(data);
      
      if (result.success) {
        setUser(result.user);
        setProfile(result.profile || null);
        setMembership(result.membership || null);
        setCompany(result.company || null);
        setStore(result.store || null);
        setIsAdminAuthenticated(isAdminRole(result.membership?.role || result.profile?.role));

        // Update settings with company data (do not block signup/ui)
        if (result.company) {
          const updatedSettings: Settings = {
            ...settings,
            companyId: result.company.id,
            currency: result.company.currency,
            currencySymbol: result.company.currency_symbol,
            userRole: result.membership?.role as any,
            assignedStoreId: result.store?.id || null,
            pinSetupComplete: true,
          };
          // Save in background and update state immediately
          saveSettings(updatedSettings).catch(err => console.error('Failed to save settings:', err));
          setSettings(updatedSettings);
          void bindDeviceToCompany(result.company.id);
        }

        // Refresh company data in background so signup returns quickly
        try {
          if (result.company?.id) {
            await pruneLocalDataForCompany(result.company.id);
          }
        } catch (e) {
          console.warn('Prune local data failed during signup:', e);
        }

        refreshCompanyData().catch(err => console.error('Failed to refresh company data:', err));
        void runBackgroundSync({
          storeId: result.store?.id || undefined,
          pullCatalog: true,
        });

        return { success: true };
      }
      
      return { success: false, error: typeof result.error === 'string' ? result.error : (result.error?.message || String(result.error || 'Signup failed')) };
    } catch (error: any) {
      console.error('Signup error:', error);
      return { success: false, error: error.message || 'Signup failed' };
    }
  };

  const logout = async () => {
    // Clear server session
    await authLogout();
    clearMasterSession();

    // Keep THIS device's company permanently. Only remove foreign tenant cache.
    const lockedCompanyId =
      getDeviceCompanyId() ||
      (settings?.companyId && settings.userRole !== 'super_admin' ? String(settings.companyId) : '');

    try {
      if (lockedCompanyId) {
        await bindDeviceToCompany(lockedCompanyId);
      } else {
        // No bound shop (e.g. fresh master session) — clear tenant caches only
        await clearAllLocalTenantData();
      }
    } catch (e) {
      console.warn('Failed to isolate local tenant data on logout:', e);
    }

    setUser(null);
    setProfile(null);
    setMembership(null);
    setCompany(null);
    setStore(null);
    setStores([]);
    setMembers([]);
    setIsAdminAuthenticated(false);

    if (settings) {
      const updatedSettings: Settings = {
        ...settings,
        // Keep companyId so this device stays bound to the shop that was created here.
        companyId: lockedCompanyId || settings.companyId,
        userRole: lockedCompanyId ? 'owner' : undefined,
        assignedStoreId: null,
        pinSetupComplete: Boolean(lockedCompanyId),
      };
      await saveSettings(updatedSettings);
      setSettings(updatedSettings);
    }
  };

  const changePin = async (oldPin: string, newPin: string): Promise<{ success: boolean; error?: string }> => {
    return { success: false, error: 'PIN change not implemented in local auth' };
  };

  const resetPin = async (phone: string, newPin: string): Promise<{ success: boolean; error?: string }> => {
    return { success: false, error: 'PIN reset not implemented in local auth' };
  };

  const createMember = async (data: any): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await createCompanyMember(data);
      if (result.success) {
        await refreshUserProfile();
      }
      return result;
    } catch (error: any) {
      console.error('Create member error:', error);
      return { success: false, error: error.message || 'Failed to create member' };
    }
  };

  const updateProfileData = async (updates: Partial<UserProfile>): Promise<{ success: boolean; error?: string }> => {
    return { success: false, error: 'Profile update not implemented in local auth' };
  };

  const updateCompanyData = async (updates: Partial<Company>): Promise<{ success: boolean; error?: string }> => {
    if (!company) return { success: false, error: 'No company selected' };
    
    const result = await updateCompany(company.id, updates);
    if (result.success) {
      await refreshUserProfile();
    }
    return result;
  };

  const isPinSetup = settingsReady && (settings?.pinSetupComplete ?? false);

  return (
    <SupabaseAuthContext.Provider
      value={{
        isAdminAuthenticated,
        isPinSetup,
        isSettingsReady: settingsReady,
        isAuthReady: authReady,
        settings,
        user,
        profile,
        membership,
        company,
        store,
        stores,
        members,
        login,
        signup,
        createMember,
        logout,
        changePin,
        resetPin,
        updateProfile: updateProfileData,
        updateCompany: updateCompanyData,
        refreshSettings,
        refreshUserProfile,
        refreshCompanyData,
      }}
    >
      {children}
    </SupabaseAuthContext.Provider>
  );
}

export function useSupabaseAuth() {
  const context = useContext(SupabaseAuthContext);
  if (context === undefined) {
    // Defensive fallback: avoid throwing in non-React or tooling contexts
    // (e.g., injected scripts or background callers). Return a safe no-op
    // implementation so callers fail gracefully instead of crashing the app.
    console.warn('useSupabaseAuth called outside SupabaseAuthProvider; returning fallback.');
    const fallback: SupabaseAuthContextType = {
      isAdminAuthenticated: false,
      isPinSetup: false,
      isSettingsReady: false,
      isAuthReady: false,
      settings: null,
      user: null,
      profile: null,
      membership: null,
      company: null,
      store: null,
      stores: [],
      members: [],
      login: async () => ({ success: false, error: 'Auth provider not initialized' }),
      signup: async () => ({ success: false, error: 'Auth provider not initialized' }),
      createMember: async () => ({ success: false, error: 'Auth provider not initialized' }),
      logout: async () => {},
      changePin: async () => ({ success: false, error: 'Auth provider not initialized' }),
      resetPin: async () => ({ success: false, error: 'Auth provider not initialized' }),
      updateProfile: async () => ({ success: false, error: 'Auth provider not initialized' }),
      updateCompany: async () => ({ success: false, error: 'Auth provider not initialized' }),
      refreshSettings: async () => {},
      refreshUserProfile: async () => {},
      refreshCompanyData: async () => {},
    };
    return fallback;
  }

  return context;
}
