import { useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { getMthunziDeviceId, verifyLicenseKey } from '@/lib/deviceId';
import { isCompanySubscriptionActive } from '@/lib/companyManagement';
import { dexieDb } from '@/lib/db';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  isTenantAppBlocked,
  normalizeHostStatus,
  type HostStatus,
} from '@/lib/hostStatus';
import { HostBlockedScreen } from '@/components/admin/HostBlockedScreen';
import { BootSplash } from '@/components/BootSplash';

const ACTIVATION_KEY_STORAGE = 'mthunzi_activation_key';
const ACTIVATION_STATUS_STORAGE = 'mthunzi_activation_status';

type Status = 'checking' | 'activated' | 'locked' | 'expired' | 'host_blocked';

export function ActivationGate() {
  const { settings, company } = useSupabaseAuth();
  const location = useLocation();
  const deviceId = useMemo(() => getMthunziDeviceId(), []);
  const [status, setStatus] = useState<Status>(() => {
    try {
      const fromStatus = localStorage.getItem(ACTIVATION_STATUS_STORAGE) === 'true';
      const hasKey = Boolean((localStorage.getItem(ACTIVATION_KEY_STORAGE) || '').trim());
      return fromStatus || hasKey ? 'activated' : 'checking';
    } catch {
      return 'checking';
    }
  });

  const persistedActivation = useMemo(() => {
    try {
      const fromSettings = Boolean(settings?.isActivated);
      const fromStatus = localStorage.getItem(ACTIVATION_STATUS_STORAGE) === 'true';
      const hasKey = Boolean((localStorage.getItem(ACTIVATION_KEY_STORAGE) || '').trim());
      return fromSettings || fromStatus || hasKey;
    } catch {
      return Boolean(settings?.isActivated);
    }
  }, [settings?.isActivated]);

  const hashActivationRedirect = useMemo(() => {
    const hash = window.location.hash || '';
    if (!hash.startsWith('#/activate')) return null;

    const qIndex = hash.indexOf('?');
    const query = qIndex >= 0 ? hash.slice(qIndex + 1) : '';
    const sp = new URLSearchParams(query);

    const key = (sp.get('key') || '').trim();
    const next = (sp.get('next') || '').trim();
    const out = new URLSearchParams();
    if (key) out.set('key', key);
    if (next) out.set('next', next);
    const qs = out.toString();
    return `/activate${qs ? `?${qs}` : ''}`;
  }, []);

  const newSignupFlag = useMemo(() => {
    try {
      return localStorage.getItem('mthunzi_new_signup') || '';
    } catch {
      return '';
    }
  }, []);

  const [liveHostStatus, setLiveHostStatus] = useState<HostStatus | null>(null);
  const [liveHostReason, setLiveHostReason] = useState<string | null>(null);
  const effectiveHostStatus = liveHostStatus ?? company?.hostStatus ?? 'active';
  const effectiveHostReason = liveHostReason ?? company?.hostStatusReason ?? null;
  const companyId = company?.id || settings?.companyId || null;

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;

    async function refreshHostStatus() {
      try {
        if (isSupabaseConfigured()) {
          const { data, error } = await supabase
            .from('companies')
            .select('host_status, host_status_reason')
            .eq('id', companyId)
            .maybeSingle();
          if (!cancelled && !error && data) {
            const nextStatus = normalizeHostStatus(data.host_status);
            const nextReason = data.host_status_reason || null;
            setLiveHostStatus(nextStatus);
            setLiveHostReason(nextReason);
            const existing = await dexieDb.companies.get(companyId);
            if (existing) {
              await dexieDb.companies.put({
                ...existing,
                hostStatus: nextStatus,
                hostStatusReason: nextReason,
                updatedAt: new Date(),
              });
            }
            return;
          }
        }

        const local = await dexieDb.companies.get(companyId);
        if (!cancelled && local) {
          setLiveHostStatus(normalizeHostStatus(local.hostStatus));
          setLiveHostReason(local.hostStatusReason || null);
        }
      } catch {
        /* ignore */
      }
    }

    void refreshHostStatus();
    const timer = window.setInterval(() => void refreshHostStatus(), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [companyId]);

  useEffect(() => {
    if (!newSignupFlag) return;
    try {
      localStorage.removeItem('mthunzi_new_signup');
    } catch {
      /* ignore */
    }
  }, [newSignupFlag]);

  useEffect(() => {
    let cancelled = false;

    if (company && company.subscriptionExpiresAt && !isCompanySubscriptionActive(company)) {
      setStatus('expired');
      return () => {
        cancelled = true;
      };
    }

    if (isTenantAppBlocked(effectiveHostStatus)) {
      setStatus('host_blocked');
      return () => {
        cancelled = true;
      };
    }

    if (persistedActivation || newSignupFlag) {
      setStatus('activated');
      return () => {
        cancelled = true;
      };
    }

    if (settings?.activationLockEnabled === false) {
      setStatus('activated');
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const stored =
          (settings?.activationKey && String(settings.activationKey).trim()) ||
          (localStorage.getItem(ACTIVATION_KEY_STORAGE) || '').trim();

        const ok = stored
          ? await Promise.race([
              verifyLicenseKey(deviceId, stored),
              new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
            ])
          : false;

        if (!cancelled) {
          if (!ok && settings?.activationLockEnabled !== true) {
            setStatus('activated');
          } else {
            setStatus(ok ? 'activated' : 'locked');
          }
        }
      } catch {
        if (!cancelled) {
          setStatus(settings?.activationLockEnabled === true ? 'locked' : 'activated');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    deviceId,
    persistedActivation,
    settings?.activationKey,
    settings?.activationLockEnabled,
    newSignupFlag,
    company,
    company?.subscriptionExpiresAt,
    company?.subscriptionStatus,
    company?.hostStatus,
    effectiveHostStatus,
  ]);

  if (hashActivationRedirect) {
    return <Navigate to={hashActivationRedirect} replace />;
  }

  if (status === 'checking') {
    return <BootSplash />;
  }

  if (status === 'expired') {
    const next = encodeURIComponent(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to={`/activate?reason=subscription&next=${next}`} replace />;
  }

  if (status === 'host_blocked') {
    return (
      <HostBlockedScreen
        hostStatus={effectiveHostStatus}
        hostStatusReason={effectiveHostReason}
        companyName={company?.name}
      />
    );
  }

  if (status === 'locked') {
    const next = encodeURIComponent(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to={`/activate?next=${next}`} replace />;
  }

  return <Outlet />;
}

export function getActivationKeyStorageName() {
  return ACTIVATION_KEY_STORAGE;
}
