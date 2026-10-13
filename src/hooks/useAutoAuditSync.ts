import { useEffect } from 'react';
import { toast } from 'sonner';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useStore } from '@/contexts/StoreContext';
import { getSalesByDate } from '@/lib/db';
import { syncToVantage } from '@/lib/vantageSync';

function isNowAtTime(now: Date, time: string): boolean {
  const [hh, mm] = String(time || '').split(':').map((v) => Number(v));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false;
  return now.getHours() === hh && now.getMinutes() === mm;
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function runSlot(slot: 'opening' | 'closing', targetDate: Date, storeId?: string) {
  const sales = await getSalesByDate(targetDate, storeId);
  const result = await syncToVantage(sales);
  if (!result.success && result.error && !result.error.includes('Missing Vantage')) {
    toast.error(`Audit sync ${slot} failed`);
  }
}

export function useAutoAuditSync() {
  const { settings } = useSupabaseAuth();
  const { currentStoreId, isGlobalView } = useStore();

  useEffect(() => {
    if (!settings?.auditSyncEnabled) return;

    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const now = new Date();
      const openingTime = settings.auditOpeningTime || '08:00';
      const closingTime = settings.auditClosingTime || settings.eodClosingTime || '18:00';
      const storeId = isGlobalView ? undefined : currentStoreId;

      const openingKey = `pos:auditSync:${dateKey(now)}:opening`;
      const closingKey = `pos:auditSync:${dateKey(now)}:closing`;

      if (isNowAtTime(now, openingTime) && localStorage.getItem(openingKey) !== '1') {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        await runSlot('opening', new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), storeId);
        localStorage.setItem(openingKey, '1');
      }

      if (isNowAtTime(now, closingTime) && localStorage.getItem(closingKey) !== '1') {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        await runSlot('closing', now, storeId);
        localStorage.setItem(closingKey, '1');
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 30_000);

    return () => window.clearInterval(id);
  }, [settings, currentStoreId, isGlobalView]);
}