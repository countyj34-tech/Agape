import { useEffect, useRef } from 'react';
import { useCart } from '@/contexts/CartContext';
import { useCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { customerDisplayService } from '@/lib/customerDisplayService';
import { computeSalesTax } from '@/lib/taxEngine';

/**
 * Bridges live cart mutations to the hardware pole / VFD display.
 * Mount once under the protected POS shell. Never throws into UI.
 * Coalesces rapid cart taps so the POS never waits on serial I/O.
 */
export function CustomerDisplayBridge() {
  const { state } = useCart();
  const { settings } = useSupabaseAuth();
  const { currencySymbol } = useCurrencyFormatter();
  const prevItemsRef = useRef<string>('');
  const prevDiscountRef = useRef<number>(0);
  const readyRef = useRef(false);
  const coalesceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    customerDisplayService.setCurrencySymbol(currencySymbol);
  }, [currencySymbol]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await customerDisplayService.initialize();
        if (!cancelled) readyRef.current = true;
      } catch (error) {
        console.warn('[CustomerDisplayBridge] init failed', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (coalesceTimerRef.current != null) {
      window.clearTimeout(coalesceTimerRef.current);
    }

    coalesceTimerRef.current = window.setTimeout(() => {
      if (!readyRef.current) return;
      if (customerDisplayService.getState().kind !== 'connected') return;

      const cfg = customerDisplayService.getSettings();
      if (!cfg.enabled) return;

      const fingerprint = state.items
        .map((i) => `${i.lineId}:${i.quantity}:${i.unitPrice ?? i.product.sellingPrice}`)
        .join('|');

      const tax = computeSalesTax({
        settings,
        subtotal: state.subtotal,
        discount: state.discount,
      });
      const total = tax.totalWithTax;

      void (async () => {
        try {
          if (state.items.length === 0) {
            if (prevItemsRef.current) {
              await customerDisplayService.displayCancelled();
            }
            prevItemsRef.current = '';
            prevDiscountRef.current = 0;
            return;
          }

          const last = state.items[state.items.length - 1];
          const unit = last.unitPrice ?? last.product.sellingPrice;

          // One screen update per coalesced cart change (fast + accurate enough for customers).
          if (fingerprint !== prevItemsRef.current || state.discount !== prevDiscountRef.current) {
            await customerDisplayService.displaySale({
              itemName: last.product.name,
              qty: last.quantity,
              lineTotal: unit * last.quantity,
              total,
            });
          }

          prevItemsRef.current = fingerprint;
          prevDiscountRef.current = state.discount;
        } catch (error) {
          console.warn('[CustomerDisplayBridge] update failed', error);
        }
      })();
    }, 80);

    return () => {
      if (coalesceTimerRef.current != null) {
        window.clearTimeout(coalesceTimerRef.current);
        coalesceTimerRef.current = null;
      }
    };
  }, [state.items, state.subtotal, state.discount, settings]);

  return null;
}
