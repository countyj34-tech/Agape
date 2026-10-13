import { PauseCircle, ShieldOff, Trash2 } from 'lucide-react';
import {
  getTenantBlockedMessage,
  getTenantBlockedTitle,
  normalizeHostStatus,
  type HostStatus,
} from '@/lib/hostStatus';

interface HostBlockedScreenProps {
  hostStatus?: HostStatus | string | null;
  hostStatusReason?: string | null;
  companyName?: string | null;
}

const STATUS_ICON: Record<HostStatus, typeof PauseCircle> = {
  active: PauseCircle,
  paused: PauseCircle,
  suspended: ShieldOff,
  removed: Trash2,
};

export function HostBlockedScreen({
  hostStatus,
  hostStatusReason,
  companyName,
}: HostBlockedScreenProps) {
  const status = normalizeHostStatus(hostStatus);
  const Icon = STATUS_ICON[status];
  const title = getTenantBlockedTitle(status);
  const message =
    String(hostStatusReason || '').trim() ||
    getTenantBlockedMessage(status) ||
    'This account is not active. Contact Mthunzi support.';

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <div className="max-w-md space-y-4 rounded-2xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">
          <Icon className="h-7 w-7" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {companyName ? <p className="text-sm text-white/50">{companyName}</p> : null}
          <p className="text-sm leading-relaxed text-white/80">{message}</p>
        </div>
        <p className="text-xs text-white/40">POS is offline until hosting payment is restored.</p>
      </div>
    </div>
  );
}
