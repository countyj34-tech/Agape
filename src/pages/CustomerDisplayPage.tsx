import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, ShoppingCart } from 'lucide-react';
import {
  CUSTOMER_DISPLAY_CHANNEL,
  CUSTOMER_DISPLAY_STORAGE_KEY,
  CUSTOMER_DISPLAY_TARGET_SCREEN_KEY,
  getCustomerDisplayScreens,
  isBroadcastChannelSupported,
  isWindowManagementSupported,
  readPersistedSnapshot,
  type CustomerDisplaySnapshot,
} from '@/lib/customerDisplay';

/**
 * Read-only customer-facing screen for the back display of a dual-screen POS.
 * Open this in a separate window — on Chrome/Edge with Window Management, it is
 * auto-placed on the second monitor. It mirrors the operator's live cart.
 */
export default function CustomerDisplayPage() {
  const [snapshot, setSnapshot] = useState<CustomerDisplaySnapshot | null>(
    () => readPersistedSnapshot()
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [needsFullscreenTap, setNeedsFullscreenTap] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fullscreenAttemptedRef = useRef(false);

  useEffect(() => {
    document.title = 'Customer Display';
  }, []);

  // Live updates from the operator window.
  useEffect(() => {
    let channel: BroadcastChannel | null = null;

    const applyMessage = (data: unknown) => {
      const msg = data as CustomerDisplaySnapshot | undefined;
      if (msg && msg.type === 'cart-snapshot') {
        setSnapshot(msg);
      }
    };

    if (isBroadcastChannelSupported()) {
      channel = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
      channel.addEventListener('message', (e) => applyMessage(e.data));
      // Ask the operator window for the current cart in case a sale is in progress.
      channel.postMessage({ type: 'request-snapshot' });
    }

    // Fallback / secondary path: localStorage mirror updated by the operator window.
    const onStorage = (e: StorageEvent) => {
      if (e.key === CUSTOMER_DISPLAY_STORAGE_KEY && e.newValue) {
        try {
          applyMessage(JSON.parse(e.newValue));
        } catch {
          /* ignore malformed payloads */
        }
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      if (channel) channel.close();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Keep newest line in view as items are scanned.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [snapshot?.items.length]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const enterFullscreenOnTargetScreen = async (): Promise<boolean> => {
    try {
      if (document.fullscreenElement) return true;

      // Prefer the Window Management screen object so fullscreen lands on the
      // correct physical monitor (Chrome/Edge).
      if (isWindowManagementSupported()) {
        const screens = await getCustomerDisplayScreens();
        let targetRaw: Screen | undefined;

        try {
          const hintRaw = localStorage.getItem(CUSTOMER_DISPLAY_TARGET_SCREEN_KEY);
          if (hintRaw) {
            const hint = JSON.parse(hintRaw) as { id?: string; left?: number; top?: number };
            const match =
              screens.find((s) => s.id === hint.id) ??
              screens.find(
                (s) =>
                  Math.round(s.left) === Math.round(hint.left ?? NaN) &&
                  Math.round(s.top) === Math.round(hint.top ?? NaN)
              );
            targetRaw = match?.raw;
          }
        } catch {
          /* ignore */
        }

        if (!targetRaw && screens.length >= 2) {
          const nonPrimary = screens.find((s) => !s.isPrimary);
          targetRaw = nonPrimary?.raw ?? screens[1]?.raw;
        }

        if (targetRaw) {
          await document.documentElement.requestFullscreen({
            screen: targetRaw,
          } as FullscreenOptions);
          return true;
        }
      }

      await document.documentElement.requestFullscreen();
      return true;
    } catch {
      return false;
    }
  };

  // After the window is placed on the second monitor, try fullscreen.
  // Browsers often block this without a gesture — show a one-tap overlay then.
  useEffect(() => {
    if (fullscreenAttemptedRef.current) return;
    fullscreenAttemptedRef.current = true;

    const timer = window.setTimeout(async () => {
      const ok = await enterFullscreenOnTargetScreen();
      if (!ok) setNeedsFullscreenTap(true);
    }, 350);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      const ok = await enterFullscreenOnTargetScreen();
      if (ok) setNeedsFullscreenTap(false);
      else setNeedsFullscreenTap(true);
    } catch {
      setNeedsFullscreenTap(true);
    }
  };

  const handleFullscreenTap = async () => {
    const ok = await enterFullscreenOnTargetScreen();
    if (ok) setNeedsFullscreenTap(false);
  };

  const storeName = snapshot?.storeName || 'Welcome';
  const hasItems = (snapshot?.items.length ?? 0) > 0;
  const isCompleted = snapshot?.status === 'completed';

  const showDiscount = (snapshot?.discountAmount ?? 0) > 0;
  const showTax = (snapshot?.taxAmount ?? 0) > 0;

  const totalLabel = useMemo(() => (isCompleted ? 'Amount Paid' : 'Total'), [isCompleted]);

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-white">
      {needsFullscreenTap && !isFullscreen && (
        <button
          type="button"
          onClick={handleFullscreenTap}
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-950/95 text-center"
        >
          <Maximize2 className="h-16 w-16 text-emerald-400" />
          <p className="text-3xl font-bold">Tap to go fullscreen</p>
          <p className="max-w-md text-lg text-white/50">
            Required once so the customer display can fill the back screen
          </p>
        </button>
      )}

      {/* Header / branding */}
      <header className="flex items-center justify-between gap-4 border-b border-white/10 bg-slate-900/80 px-8 py-5">
        <div className="flex items-center gap-4">
          {snapshot?.logoUrl ? (
            <img
              src={snapshot.logoUrl}
              alt=""
              className="h-14 w-14 rounded-2xl bg-white/5 object-contain p-1"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/20 text-2xl font-bold text-primary">
              {storeName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-2xl font-bold leading-tight">{storeName}</p>
            <p className="text-sm text-white/50">
              {hasItems
                ? `${snapshot?.itemCount} item${snapshot?.itemCount !== 1 ? 's' : ''}`
                : 'Ready to serve you'}
            </p>
          </div>
        </div>
        <button
          onClick={toggleFullscreen}
          className="rounded-xl border border-white/10 p-3 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          title={isFullscreen ? 'Exit fullscreen' : 'Go fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
        </button>
      </header>

      {/* Body */}
      {isCompleted ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
          <p className="text-4xl font-semibold text-emerald-400">Thank you!</p>
          <div>
            <p className="text-lg uppercase tracking-widest text-white/40">Total Paid</p>
            <p className="mt-2 text-7xl font-black">{snapshot?.totalText}</p>
          </div>
          {snapshot?.changeText && (
            <div className="rounded-2xl bg-white/5 px-8 py-4">
              <span className="text-lg text-white/50">Change</span>
              <span className="ml-4 text-4xl font-bold text-emerald-300">{snapshot.changeText}</span>
            </div>
          )}
          <p className="text-base text-white/40">Please collect your receipt</p>
        </div>
      ) : !hasItems ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-white/5">
            <ShoppingCart className="h-14 w-14 text-white/30" />
          </div>
          <div>
            <p className="text-5xl font-bold">Welcome</p>
            <p className="mt-3 text-xl text-white/50">Your items and total will appear here</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Column headings */}
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-6 border-b border-white/10 px-8 py-3 text-sm uppercase tracking-wider text-white/40">
            <span>Item</span>
            <span className="w-32 text-center">Qty × Price</span>
            <span className="w-40 text-right">Amount</span>
          </div>

          {/* Items */}
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-8">
            {snapshot?.items.map((item) => (
              <div
                key={item.lineId}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-6 border-b border-white/5 py-4"
              >
                <span className="truncate text-2xl font-medium">{item.name}</span>
                <span className="w-32 text-center text-lg text-white/60">
                  {item.quantity} × {item.unitPriceText}
                </span>
                <span className="w-40 text-right text-2xl font-semibold tabular-nums">
                  {item.lineTotalText}
                </span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="border-t border-white/10 bg-slate-900/80 px-8 py-6">
            <div className="ml-auto max-w-md space-y-2">
              <div className="flex items-center justify-between text-lg text-white/60">
                <span>Subtotal</span>
                <span className="tabular-nums">{snapshot?.subtotalText}</span>
              </div>
              {showDiscount && (
                <div className="flex items-center justify-between text-lg text-amber-300">
                  <span>Discount</span>
                  <span className="tabular-nums">-{snapshot?.discountText}</span>
                </div>
              )}
              {showTax && (
                <div className="flex items-center justify-between text-lg text-white/60">
                  <span>{snapshot?.taxLabel}</span>
                  <span className="tabular-nums">{snapshot?.taxText}</span>
                </div>
              )}
              <div className="mt-4 flex items-end justify-between border-t border-white/10 pt-4">
                <span className="text-2xl font-semibold uppercase tracking-wide text-white/70">
                  {totalLabel}
                </span>
                <span className="text-6xl font-black tabular-nums text-emerald-400">
                  {snapshot?.totalText}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
