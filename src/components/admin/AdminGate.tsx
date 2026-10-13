import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { isAdminRole } from '@/lib/permissions';
import { isMasterSessionActive } from '@/lib/offlineMasterAuth';
import { BootSplash } from '@/components/BootSplash';

const ADMIN_AUTH_STORAGE_KEY = 'mthunzi_admin_authenticated';

export function AdminGate({ children }: { children: ReactNode }) {
  const { isAdminAuthenticated, isSettingsReady, settings } = useSupabaseAuth();

  if (isMasterSessionActive()) {
    return <>{children}</>;
  }

  let storedAdmin = false;
  try {
    storedAdmin = localStorage.getItem(ADMIN_AUTH_STORAGE_KEY) === 'true';
  } catch {
    storedAdmin = false;
  }

  const authed = isAdminAuthenticated || storedAdmin;
  const roleOk = isAdminRole(settings?.userRole);

  if (!isSettingsReady) {
    return <BootSplash />;
  }

  if (!authed || !roleOk) {
    return <Navigate to="/login?tab=admin" replace />;
  }

  return <>{children}</>;
}
