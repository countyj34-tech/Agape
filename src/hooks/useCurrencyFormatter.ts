import { useEffect, useState, useCallback } from 'react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { convertAmount } from '@/lib/currency';

export function useCurrencyFormatter() {
  const { settings } = useSupabaseAuth();
  const [rateReady, setRateReady] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    let cancelled = false;

    async function ensureRate() {
      try {
        if (settings) {
          // Use convertAmount(1) to derive the display conversion factor.
          const converted = await convertAmount(1, settings);
          if (!cancelled) {
            setRate(converted);
          }
        } else if (!cancelled) {
          setRate(1);
        }
      } finally {
        if (!cancelled) {
          setRateReady(true);
        }
      }
    }

    setRateReady(false);
    void ensureRate();

    return () => {
      cancelled = true;
    };
  }, [settings?.currency, settings?.baseCurrency]);

  const format = useCallback(
    (value: number) => {
      const symbol = settings?.currencySymbol || 'K';
      const converted = value * rate;
      return `${symbol}${converted.toFixed(2)}`;
    },
    [settings?.currencySymbol, rate]
  );

  return {
    format,
    currencySymbol: settings?.currencySymbol || 'K',
    rateReady,
  };
}
