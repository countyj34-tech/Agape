import { useEffect, useRef } from 'react';
import {
  CUSTOMER_DISPLAY_CHANNEL,
  isBroadcastChannelSupported,
  persistSnapshot,
  type CustomerDisplaySnapshot,
} from '@/lib/customerDisplay';

/**
 * Publishes the current cart to the customer-facing display window.
 *
 * Pass a memoized snapshot that only changes when its content changes (so we
 * don't rebroadcast on every render). The hook also answers `request-snapshot`
 * messages, so a display window opened after the sale started immediately
 * receives the latest state.
 */
export function useCustomerDisplayPublisher(snapshot: CustomerDisplaySnapshot | null): void {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const latestRef = useRef<CustomerDisplaySnapshot | null>(null);
  const persistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isBroadcastChannelSupported()) return;

    const channel = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
    channelRef.current = channel;

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'request-snapshot' && latestRef.current) {
        channel.postMessage(latestRef.current);
      }
    };

    channel.addEventListener('message', onMessage);
    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    latestRef.current = snapshot;
    // Instant channel update for second screen; debounce localStorage write.
    channelRef.current?.postMessage(snapshot);
    if (persistTimerRef.current != null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      persistSnapshot(snapshot);
      persistTimerRef.current = null;
    }, 200);
    return () => {
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [snapshot]);
}
