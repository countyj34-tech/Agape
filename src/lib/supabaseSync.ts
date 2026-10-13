import { dexieDb } from './db';
import { supabase, isSupabaseConfigured, getDeviceStoreId, getDeviceId } from './supabase';

const LAST_EXPORT_KEY = 'auditLogs:lastExportTs';

export async function exportPendingAuditLogs(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;

  try {
    const lastTs = Number(localStorage.getItem(LAST_EXPORT_KEY) || '0');
    const all = await dexieDb.auditLogs.toArray();
    const pending = all.filter((a) => {
      const t = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      return t > lastTs;
    });
    if (!pending.length) return 0;

    const rows = pending.map((p) => ({
      id: p.id,
      store_id: getDeviceStoreId(),
      shift_id: p.shiftId,
      shift_report_id: p.shiftReportId ?? null,
      staff_name: p.staffName,
      expected_cash: p.expectedCash,
      actual_cash: p.actualCash,
      variance: p.variance,
      device_id: getDeviceId(),
      created_at: (p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt)).toISOString(),
    }));

    // Insert in one go; small payload expected. Use upsert to avoid duplicates.
    const { error } = await supabase.from('audit_logs').insert(rows, { upsert: true });
    if (error) {
      console.warn('Supabase audit log insert failed', error);
      return 0;
    }

    // Update last export ts to the latest createdAt we sent
    const maxTs = Math.max(...pending.map((p) => (p.createdAt instanceof Date ? p.createdAt.getTime() : new Date(p.createdAt).getTime())));
    localStorage.setItem(LAST_EXPORT_KEY, String(maxTs));

    return pending.length;
  } catch (e) {
    console.warn('exportPendingAuditLogs failed', e);
    return 0;
  }
}

let loopHandle: number | null = null;

export function startAuditLogAutoSync(intervalMs = 60_000) {
  // Don't start multiple loops
  if (loopHandle) return;
  // Run immediately then on interval
  (async () => {
    try {
      await exportPendingAuditLogs();
    } catch {
      // ignore
    }
  })();

  loopHandle = window.setInterval(() => {
    exportPendingAuditLogs().catch(() => {});
  }, intervalMs);
}

export function stopAuditLogAutoSync() {
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
}
