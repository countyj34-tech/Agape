import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  DEFAULT_HOSTING_PAYMENT_MESSAGE,
  HOST_STATUS_OPTIONS,
  hostStatusLabel,
  normalizeHostStatus,
  type HostStatus,
} from '@/lib/hostStatus';
import { setCompanyHostStatus } from '@/lib/companyManagement';
import { cn } from '@/lib/utils';
import { Loader2, PauseCircle, PlayCircle, ShieldOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface HostKillSwitchProps {
  companyId: string;
  companyName: string;
  hostStatus?: HostStatus | string | null;
  hostStatusReason?: string | null;
  compact?: boolean;
  onUpdated?: (status: HostStatus, reason?: string | null) => void;
}

const STATUS_ICON: Record<HostStatus, typeof PlayCircle> = {
  active: PlayCircle,
  paused: PauseCircle,
  suspended: ShieldOff,
  removed: Trash2,
};

export function HostKillSwitch({
  companyId,
  companyName,
  hostStatus,
  hostStatusReason,
  compact = false,
  onUpdated,
}: HostKillSwitchProps) {
  const current = normalizeHostStatus(hostStatus);
  const [reason, setReason] = useState(hostStatusReason || '');
  const [saving, setSaving] = useState<HostStatus | 'message' | null>(null);

  useEffect(() => {
    setReason(hostStatusReason || '');
  }, [hostStatusReason, companyId]);

  async function applyStatus(next: HostStatus) {
    const messageToSave =
      next === 'active' ? reason.trim() || null : reason.trim() || DEFAULT_HOSTING_PAYMENT_MESSAGE;

    if (
      next === current &&
      String(messageToSave || '').trim() === String(hostStatusReason || '').trim()
    ) {
      return;
    }

    setSaving(next);
    try {
      const updated = await setCompanyHostStatus(
        companyId,
        next,
        messageToSave || undefined
      );
      if (!updated) {
        toast.error(`Could not update ${companyName}`);
        return;
      }
      if (next !== 'active' && !reason.trim()) {
        setReason(DEFAULT_HOSTING_PAYMENT_MESSAGE);
      }
      toast.success(`${companyName}: ${hostStatusLabel(next)}`);
      onUpdated?.(next, messageToSave);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Host status update failed');
    } finally {
      setSaving(null);
    }
  }

  async function saveMessageOnly() {
    setSaving('message');
    try {
      const messageToSave = reason.trim() || DEFAULT_HOSTING_PAYMENT_MESSAGE;
      const updated = await setCompanyHostStatus(companyId, current, messageToSave);
      if (!updated) {
        toast.error(`Could not save message for ${companyName}`);
        return;
      }
      if (!reason.trim()) setReason(DEFAULT_HOSTING_PAYMENT_MESSAGE);
      toast.success('Message saved — shown on POS and shop');
      onUpdated?.(current, messageToSave);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save message');
    } finally {
      setSaving(null);
    }
  }

  const badgeVariant =
    current === 'active' ? 'default' : current === 'paused' ? 'secondary' : 'destructive';

  return (
    <div className={cn('space-y-3 rounded-lg border bg-muted/30 p-3', compact && 'p-2')}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Host control
          </p>
          {!compact && (
            <p className="text-xs text-muted-foreground">
              Pause = online shop only. POS keeps selling from device storage. Suspend/Remove lock POS.
            </p>
          )}
        </div>
        <Badge variant={badgeVariant}>{hostStatusLabel(current)}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {HOST_STATUS_OPTIONS.map((option) => {
          const Icon = STATUS_ICON[option.value];
          const selected = current === option.value;
          const busy = saving === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={selected ? 'default' : 'outline'}
              disabled={Boolean(saving)}
              className="h-auto flex-col gap-1 py-2 text-xs"
              onClick={() => void applyStatus(option.value)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
              {option.label}
            </Button>
          );
        })}
      </div>

      {!compact && (
        <div className="space-y-2">
          <Label htmlFor={`host-reason-${companyId}`} className="text-xs">
            Message shown on POS / shop (type your own)
          </Label>
          <Textarea
            id={`host-reason-${companyId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder={DEFAULT_HOSTING_PAYMENT_MESSAGE}
            className="text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={Boolean(saving)}
              onClick={() => void saveMessageOnly()}
            >
              {saving === 'message' ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save message'
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={Boolean(saving)}
              onClick={() => setReason(DEFAULT_HOSTING_PAYMENT_MESSAGE)}
            >
              Use default text
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Leave blank and hit Pause — the default hosting payment text is used.
          </p>
        </div>
      )}
    </div>
  );
}
