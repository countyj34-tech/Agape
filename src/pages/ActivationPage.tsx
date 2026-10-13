import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getMthunziDeviceId, verifyLicenseKey } from '@/lib/deviceId';
import { MTZ_SUPPORT } from '@/lib/systemInfo';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { saveSettings } from '@/lib/db';
import { getActivationKeyStorageName } from '@/components/admin/ActivationGate';
import { toast } from 'sonner';
import { InstallPrompt } from '@/components/InstallPrompt';

export default function ActivationPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { settings, refreshSettings } = useSupabaseAuth();
  const deviceId = useMemo(() => getMthunziDeviceId(), []);
  const [verifying, setVerifying] = useState(false);
  const [manualKey, setManualKey] = useState('');
  const [error, setError] = useState('');
  const [isSecureContext, setIsSecureContext] = useState(true);

  const number = (MTZ_SUPPORT.whatsappNumber || '260769299297').replace(/\D/g, '');
  const message = `Device ${deviceId} requested activation for Mthunzi-POS.`;
  const waUrl = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;

  const persistActivationLocally = async (trimmedKey: string) => {
    localStorage.setItem(getActivationKeyStorageName(), trimmedKey);
    localStorage.setItem('mthunzi_activation_status', 'true');

    if (settings) {
      saveSettings({
        ...settings,
        activationLockEnabled: true,
        isActivated: true,
        activationKey: trimmedKey,
        updatedAt: new Date(),
      })
        .then(() => refreshSettings())
        .catch((err) => console.error('Failed to save activation settings:', err));
    }
  };

  const extractActivationKey = (input: string): string => {
    const raw = String(input || '').trim();
    if (!raw) return '';

    // If user pasted a full activation link, extract `key`.
    // Supports both history links: /activate?key=... and hash links: /#/activate?key=...
    try {
      const url = new URL(raw, window.location.origin);
      const direct = (url.searchParams.get('key') || '').trim();
      if (direct) return direct;

      const hash = url.hash || '';
      if (hash.startsWith('#/activate')) {
        const qIndex = hash.indexOf('?');
        if (qIndex >= 0) {
          const sp = new URLSearchParams(hash.slice(qIndex + 1));
          const k = (sp.get('key') || '').trim();
          if (k) return k;
        }
      }
    } catch {
      // not a URL; fall through
    }

    // If user pasted a WhatsApp message containing key=...
    const keyIndex = raw.toLowerCase().lastIndexOf('key=');
    if (keyIndex >= 0) {
      const after = raw.slice(keyIndex + 4);
      const token = after.split(/[\s&?#]/g)[0] || '';
      if (token.trim()) return token.trim();
    }

    // If user pasted something like "Activation Key: <key>".
    const cleaned = raw
      .replace(/^\s*(activation\s*key|license\s*key|license|activation|key|code)\s*[:\-–—]\s*/i, '')
      .trim();
    return cleaned;
  };

  const activateWithKey = async (key: string, next: string) => {
    const trimmed = extractActivationKey(key);
    if (!trimmed) {
      setError('Please enter the activation key.');
      return;
    }
    setError('');
    setVerifying(true);
    try {
      await persistActivationLocally(trimmed);

      // Open the app immediately once the key is captured locally.
      // If the key later fails verification, we clear the local marker and send the user back.
      navigate(next, { replace: true });

      const ok = await verifyLicenseKey(deviceId, trimmed);
      if (!ok) {
        localStorage.removeItem(getActivationKeyStorageName());
        localStorage.removeItem('mthunzi_activation_status');

        if (settings) {
          saveSettings({
            ...settings,
            activationLockEnabled: true,
            isActivated: false,
            activationKey: '',
            updatedAt: new Date(),
          }).catch((err) => console.error('Failed to revert activation settings:', err));
        }

        setError('Invalid activation key.');
        toast.error('Invalid activation key.');
        navigate(`/activate?next=${encodeURIComponent(next)}`, { replace: true });
        return;
      }
    } catch (error) {
      console.error('Activation error:', error);
      localStorage.removeItem(getActivationKeyStorageName());
      localStorage.removeItem('mthunzi_activation_status');
      
      // Check if it's a Web Crypto API security issue
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('crypto') || errorMsg.includes('Secure context') || errorMsg.includes('secure')) {
        const secureFix = !isSecureContext 
          ? 'Use http://localhost:8080 instead of the network IP, or enable HTTPS.'
          : 'Try accessing from localhost or using HTTPS.';
        setError(`Security Error: Web Crypto API unavailable. ${secureFix}`);
        toast.error(`🔒 Security issue: ${secureFix}`);
      } else {
        setError(`Error: ${errorMsg}`);
        toast.error(`Activation failed: ${errorMsg}`);
      }

      navigate(`/activate?next=${encodeURIComponent(next)}`, { replace: true });
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const key = (params.get('key') || '').trim();
    const next = (params.get('next') || '/').trim() || '/';
    
    // Check if we're in a secure context
    const isSecure = window.isSecureContext === true;
    if (!cancelled) {
      setIsSecureContext(isSecure);
      if (!isSecure) {
        console.warn('Not in secure context - Web Crypto API may fail');
      }
    }
    
    if (!key) return;

    (async () => {
      if (!cancelled) {
        await activateWithKey(key, next);
      }
    })().catch(() => {
      // errors are surfaced via UI state in activateWithKey
    });

    return () => {
      cancelled = true;
    };
  }, [deviceId, navigate, params, refreshSettings, settings]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 to-zinc-900 p-4 text-white">
      <div className="mx-auto flex max-w-lg flex-col gap-4 pt-16">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Mthunzi Secured</h1>
          <p className="mt-2 text-sm text-white/70">This device requires activation.</p>
        </div>

        <InstallPrompt />

        {!isSecureContext && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-300">
            <p className="font-medium">⚠️ Security context warning</p>
            <p className="mt-1 text-xs text-yellow-300/80">
              You are accessing the app via HTTP on a network IP. Web Crypto API requires HTTPS or localhost.
            </p>
            <p className="mt-2 text-xs text-yellow-200">
              <strong>Solutions:</strong>
              <br />
              1. Access via <code className="bg-black/30 px-1">http://localhost:8080</code> on this machine
              <br />
              2. Use HTTPS instead of HTTP (requires SSL certificate)
              <br />
              3. Open DevTools (F12) and check the Console for detailed errors
            </p>
          </div>
        )}

        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="text-sm font-medium text-white/80">Device ID</div>
          <div className="mt-2 rounded-md bg-black/30 p-3 font-mono text-sm">{deviceId}</div>
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              className="w-full border-white/15 bg-transparent text-white hover:bg-white/10"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(deviceId);
                  toast.success('Device ID copied');
                } catch {
                  toast.error('Copy failed. Please select and copy manually.');
                }
              }}
            >
              Copy Device ID
            </Button>
          </div>
        </div>

        <Button
          className="h-12 w-full text-base"
          onClick={() => window.open(waUrl, '_blank', 'noopener,noreferrer')}
          disabled={verifying}
        >
          Request Activation Key via WhatsApp
        </Button>

        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="text-sm font-medium text-white/80">Enter activation key</div>
          <div className="mt-3 flex flex-col gap-3">
            <Input
              value={manualKey}
              onChange={(e) => setManualKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !verifying) {
                  const next = (params.get('next') || '/').trim() || '/';
                  void activateWithKey(manualKey, next);
                }
              }}
              placeholder="Paste activation key (or activation link)"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={verifying}
            />
            {error ? <div className="text-sm text-red-300">{error}</div> : null}
            <Button
              variant="secondary"
              className="h-11 w-full"
              onClick={() => {
                const next = (params.get('next') || '/').trim() || '/';
                void activateWithKey(manualKey, next);
              }}
              disabled={verifying}
            >
              {verifying ? 'Verifying…' : 'Activate'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
