import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { requestPersistentStorage } from '@/lib/storageGuard';
import { toast } from 'sonner';

// Minimal local typing for the beforeinstallprompt event (not in standard TS lib yet).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent || '');
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as any;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    nav.standalone === true
  );
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(() => isStandalone());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onBeforeInstallPrompt = (e: Event) => {
      const ev = e as BeforeInstallPromptEvent;
      ev.preventDefault();
      setDeferredPrompt(ev);
    };

    const onAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
      void requestPersistentStorage().then((result) => {
        if (result.persisted) {
          toast.success('Installed — sales & stock now save on this device.');
        } else {
          toast.message('Installed — using device storage. Enable Data Guard in Admin if prompted.');
        }
      });
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      void requestPersistentStorage();
    }
  }, []);

  const showIosTip = isIOS() && !installed;
  const showInstallPanel = !isIOS() && !installed;
  const canPromptInstall = Boolean(deferredPrompt);

  if (!showIosTip && !showInstallPanel) return null;

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      window.alert(
        'Installation is not available through the on-screen prompt in this browser. Use your browser menu and choose "Install app" or "Install [App Name]" instead.'
      );
      return;
    }

    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } finally {
      setDeferredPrompt(null);
    }
  };

  return (
    <div className="mx-3 mt-2 flex items-center justify-between gap-3 rounded-md border bg-card/60 px-3 py-2 text-xs shadow-sm backdrop-blur">
      {showIosTip && (
        <div className="min-w-0">
          <div className="truncate text-[11px] text-muted-foreground">
            Install to this device: Safari <span className="font-semibold">Share</span> →{' '}
            <span className="font-semibold">Add to Home Screen</span> — sales save offline.
          </div>
        </div>
      )}

      {showInstallPanel && (
        <div className="min-w-0">
          <div className="truncate text-[11px] text-muted-foreground">
            Install on this device — POS keeps working from local storage if hosting is unpaid.
            {!deferredPrompt ? (
              <span className="hidden sm:inline"> (Browser menu → Install)</span>
            ) : null}
          </div>
        </div>
      )}

      {showInstallPanel && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 px-2 text-[11px]"
          onClick={handleInstallClick}
        >
          {canPromptInstall ? 'Install' : 'Use browser menu'}
        </Button>
      )}
    </div>
  );
}
