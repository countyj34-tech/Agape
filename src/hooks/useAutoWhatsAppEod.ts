import { useEffect } from 'react';
import { toast } from 'sonner';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { generateWhatsAppReport } from '@/lib/whatsAppReport';

function getLocalDateKey(d: Date): string {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseClosingTime(closingTime: string): { hh: number; mm: number } | null {
  const [hh, mm] = String(closingTime || '').split(':').map((v) => Number(v));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return { hh, mm };
}

function isAtOrAfterClosingTime(now: Date, closingTime: string): boolean {
  const parsed = parseClosingTime(closingTime);
  if (!parsed) return false;

  const closingDate = new Date(now);
  closingDate.setHours(parsed.hh, parsed.mm, 0, 0);

  return now >= closingDate && now.toDateString() === closingDate.toDateString();
}

function validateWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function useAutoWhatsAppEod() {
  const { settings } = useSupabaseAuth();

  useEffect(() => {
    if (!settings) return;
    if (!settings.autoWhatsAppEnabled) return;

    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const now = new Date();
      const closingTime = settings.eodClosingTime || '18:00';
      if (!isAtOrAfterClosingTime(now, closingTime)) return;

      const dayKey = getLocalDateKey(now);
      const sentKey = `pos:eodAutoSent:${dayKey}`;
      if (localStorage.getItem(sentKey) === '1') return;

      // Only attempt when online.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

      try {
        const text = await generateWhatsAppReport(now);

        const method = settings.autoWhatsAppMethod || 'web';
        const number = String(settings.autoWhatsAppNumber || '').replace(/\D/g, '');

        if (method === 'webhook') {
          const webhookUrl = String(settings.autoWhatsAppWebhookUrl || '').trim();
          if (!validateWebhookUrl(webhookUrl)) {
            toast.error('Auto WhatsApp webhook URL is missing or invalid.');
            return;
          }

          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: number, text, dateKey: dayKey }),
          });
          localStorage.setItem(sentKey, '1');
          toast.success('EOD report sent via webhook');
          return;
        }

        // Browser-safe fallback: we cannot silently send WhatsApp messages.
        // We prepare a link and ask for a tap.
        const url = number
          ? `https://wa.me/${number}?text=${encodeURIComponent(text)}`
          : `https://wa.me/?text=${encodeURIComponent(text)}`;

        localStorage.setItem(sentKey, '1');
        toast.message('End-of-day report ready', {
          duration: 12000,
          description: 'Tap to open WhatsApp and send the report.',
          action: {
            label: 'Open WhatsApp',
            onClick: () => window.open(url, '_blank', 'noopener,noreferrer'),
          },
        });
      } catch (e) {
        console.error('Auto EOD report failed', e);
      }
    };

    void tick();

    const id = window.setInterval(() => {
      void tick();
    }, 30_000);

    return () => window.clearInterval(id);
  }, [settings]);
}
