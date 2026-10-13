import { Wifi, WifiLow, CloudOff } from 'lucide-react';
import { useOnlineStatus, OnlineStatus } from '@/hooks/useOnlineStatus';
import { cn } from '@/lib/utils';

const statusConfig: Record<OnlineStatus, { icon: typeof Wifi; label: string; className: string }> = {
  online: {
    icon: Wifi,
    label: 'Online',
    className: 'text-success',
  },
  offline: {
    icon: CloudOff,
    label: 'Device storage',
    className: 'text-destructive',
  },
  slow: {
    icon: WifiLow,
    label: 'Slow Connection',
    className: 'text-warning',
  },
};

interface OfflineIndicatorProps {
  showLabel?: boolean;
  className?: string;
}

export function OfflineIndicator({ showLabel = false, className }: OfflineIndicatorProps) {
  const status = useOnlineStatus();
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Icon className={cn('h-4 w-4', config.className)} />
      {(showLabel || status === 'offline') && (
        <span className={cn('text-xs font-medium', config.className)}>
          {config.label}
        </span>
      )}
    </div>
  );
}
