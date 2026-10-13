import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { dexieDb, markEodClosed, upsertDailySummaryForDate } from '@/lib/db';
import { preloadEodPdfDeps, shareEodPdfToWhatsApp, shareOrDownloadEodPdf } from '@/lib/eodPdf';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { toast } from 'sonner';

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseClosingTimeToDate(args: { now: Date; closingTime: string }): Date | null {
  const match = String(args.closingTime ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hh = Math.min(23, Math.max(0, parseInt(match[1] ?? '0', 10)));
  const mm = Math.min(59, Math.max(0, parseInt(match[2] ?? '0', 10)));
  return new Date(args.now.getFullYear(), args.now.getMonth(), args.now.getDate(), hh, mm, 0, 0);
}

export function EodClosingPrompt() {
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith('/admin');

  const { settings } = useSupabaseAuth();
  const enabled = settings?.eodAutoPromptEnabled ?? false;
  const closingTime = settings?.eodClosingTime ?? '18:00';

  const [now, setNow] = useState(() => new Date());
  const dateKey = useMemo(() => localDateKey(now), [now]);

  const closingAt = useMemo(
    () => parseClosingTimeToDate({ now, closingTime }),
    [now, closingTime]
  );

  const afterClosing = Boolean(closingAt && now.getTime() >= closingAt.getTime());

  const closure = useLiveQuery(
    () => (enabled && afterClosing ? dexieDb.eodClosures.get(dateKey) : Promise.resolve(undefined)),
    [enabled, afterClosing, dateKey]
  );

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'export' | 'share' | null>(null);

  const snoozeKey = `eodPromptSnoozeUntil:${dateKey}`;
  const snoozedUntil = (() => {
    try {
      const raw = sessionStorage.getItem(snoozeKey);
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  })();

  useEffect(() => {
    if (!enabled) return;
    if (isAdminRoute) return;

    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, [enabled, isAdminRoute]);

  useEffect(() => {
    if (!enabled) return;
    if (isAdminRoute) return;
    if (!afterClosing) return;
    if (closure) return;
    if (Date.now() < snoozedUntil) return;

    setOpen(true);
  }, [afterClosing, closure, enabled, isAdminRoute, snoozedUntil]);

  const onDismiss = () => {
    try {
      sessionStorage.setItem(snoozeKey, String(Date.now() + 30 * 60_000));
    } catch {
      // ignore
    }
    setOpen(false);
  };

  const runExport = async () => {
    if (!settings) {
      toast.error('Settings not loaded');
      return;
    }

    setBusy('export');
    try {
      preloadEodPdfDeps();
      const summary = await upsertDailySummaryForDate(dateKey);

      // Pre-open window to reduce popup blocking.
      const preopened = window.open('about:blank', '_blank', 'noopener,noreferrer');
      await shareOrDownloadEodPdf({ summary, settings, preopenedWindow: preopened });

      await markEodClosed(dateKey);
      toast.success('EOD exported');
      setOpen(false);
    } catch (e: any) {
      console.error(e);
      toast.error(String(e?.message ?? 'Failed to export EOD'));
    } finally {
      setBusy(null);
    }
  };

  const runShare = async () => {
    if (!settings) {
      toast.error('Settings not loaded');
      return;
    }

    setBusy('share');
    try {
      preloadEodPdfDeps();
      const summary = await upsertDailySummaryForDate(dateKey);

      const res = await shareEodPdfToWhatsApp({ summary, settings });
      if (res.shared || res.reason === 'unsupported') {
        await markEodClosed(dateKey);
        toast.success('EOD shared');
        setOpen(false);
      } else if (res.reason === 'cancelled') {
        toast.message('Share cancelled');
      } else {
        toast.error('Failed to share');
      }
    } catch (e: any) {
      console.error(e);
      toast.error(String(e?.message ?? 'Failed to share EOD'));
    } finally {
      setBusy(null);
    }
  };

  if (!enabled || isAdminRoute) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>End-of-Day Report</DialogTitle>
          <DialogDescription>
            It’s after {closingTime}. Export or share today’s EOD report now.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={onDismiss} disabled={busy !== null}>
            Later
          </Button>
          <Button onClick={runExport} disabled={busy !== null}>
            {busy === 'export' ? 'Exporting…' : 'Export PDF'}
          </Button>
          <Button onClick={runShare} disabled={busy !== null}>
            {busy === 'share' ? 'Sharing…' : 'Share PDF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
