import { useEffect, useState } from 'react';
import { HardDrive, PauseCircle } from 'lucide-react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { dexieDb } from '@/lib/db';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  DEFAULT_HOSTING_PAYMENT_MESSAGE,
  isHostingPaused,
} from '@/lib/hostStatus';
import { isStandaloneDisplay } from '@/lib/deviceMode';

/**
 * Soft notice when hosting is paused: online shop is off,
 * but this installed POS keeps working from device storage.
 */
export function HostingPausedBanner() {
  const { company, settings } = useSupabaseAuth();
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState('');

  const companyId = company?.id || settings?.companyId || null;

  useEffect(() => {
    if (!companyId) {
      setPaused(false);
      return;
    }
    let cancelled = false;

    async function refresh() {
      try {
        let status = company?.hostStatus;
        let reason = company?.hostStatusReason;

        if (isSupabaseConfigured() && typeof navigator !== 'undefined' && navigator.onLine) {
          const { data } = await supabase
            .from('companies')
            .select('host_status, host_status_reason')
            .eq('id', companyId)
            .maybeSingle();
          if (data) {
            status = data.host_status;
            reason = data.host_status_reason;
          }
        } else {
          const local = await dexieDb.companies.get(companyId);
          if (local) {
            status = local.hostStatus;
            reason = local.hostStatusReason;
          }
        }

        if (cancelled) return;
        const nextPaused = isHostingPaused(status);
        setPaused(nextPaused);
        setMessage(
          String(reason || '').trim() ||
            (nextPaused ? DEFAULT_HOSTING_PAYMENT_MESSAGE : '')
        );
      } catch {
        if (!cancelled) {
          setPaused(isHostingPaused(company?.hostStatus));
        }
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [companyId, company?.hostStatus, company?.hostStatusReason]);

  if (!paused) return null;

  const onDevice = isStandaloneDisplay();

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
      <div className="mx-auto flex max-w-6xl items-start gap-2 text-xs sm:text-sm">
        <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 space-y-0.5">
          <p className="font-semibold">Online shop paused — POS still works on this device</p>
          <p className="text-amber-900/90">{message}</p>
          <p className="flex items-center gap-1 text-[11px] text-amber-800/80">
            <HardDrive className="h-3.5 w-3.5" />
            {onDevice
              ? 'Installed app: sales & stock save on this device even if hosting/Netlify is unpaid.'
              : 'Install the app for best offline use — sales already save to device storage.'}
          </p>
        </div>
      </div>
    </div>
  );
}
