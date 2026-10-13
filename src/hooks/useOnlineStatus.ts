import { useState, useEffect } from 'react';

export type OnlineStatus = 'online' | 'offline' | 'slow';

/**
 * Lightweight online status for POS chrome.
 * Uses navigator events only — no periodic network pings that stall busy terminals.
 */
export function useOnlineStatus(): OnlineStatus {
  const [status, setStatus] = useState<OnlineStatus>(
    navigator.onLine ? 'online' : 'offline'
  );

  useEffect(() => {
    const handleOnline = () => setStatus('online');
    const handleOffline = () => setStatus('offline');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return status;
}
