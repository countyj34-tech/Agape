import { useEffect, useRef } from 'react';

export type HardwareScannerOptions = {
  minLength?: number;
  maxInterKeyDelayMs?: number;
  maxAverageKeyDelayMs?: number;
  numericOnly?: boolean;
};

export function useHardwareScanner(
  onScan: (barcode: string) => void | Promise<void>,
  opts?: HardwareScannerOptions
) {
  const optionsRef = useRef<Required<HardwareScannerOptions>>({
    minLength: opts?.minLength ?? 6,
    maxInterKeyDelayMs: opts?.maxInterKeyDelayMs ?? 80,
    maxAverageKeyDelayMs: opts?.maxAverageKeyDelayMs ?? 50,
    numericOnly: opts?.numericOnly ?? true,
  });

  useEffect(() => {
    optionsRef.current = {
      minLength: opts?.minLength ?? 6,
      maxInterKeyDelayMs: opts?.maxInterKeyDelayMs ?? 80,
      maxAverageKeyDelayMs: opts?.maxAverageKeyDelayMs ?? 50,
      numericOnly: opts?.numericOnly ?? true,
    };
  }, [opts?.maxAverageKeyDelayMs, opts?.maxInterKeyDelayMs, opts?.minLength, opts?.numericOnly]);

  const bufferRef = useRef('');
  const startedAtRef = useRef<number | null>(null);
  const lastKeyAtRef = useRef<number | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore modifier combos
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const now = performance.now();
      const key = e.key;

      const isEnter = key === 'Enter' || key === 'NumpadEnter';
      const isTab = key === 'Tab';

      if (isEnter || isTab) {
        const code = bufferRef.current;
        const startedAt = startedAtRef.current;
        const lastAt = lastKeyAtRef.current;

        bufferRef.current = '';
        startedAtRef.current = null;
        lastKeyAtRef.current = null;

        if (!code || startedAt == null || lastAt == null) return;

        const elapsed = Math.max(1, lastAt - startedAt);
        const avg = elapsed / Math.max(1, code.length);
        const { minLength, maxAverageKeyDelayMs, numericOnly } = optionsRef.current;

        if (code.length < minLength) return;
        if (avg > maxAverageKeyDelayMs) return;

        const normalized = code.trim();
        if (!normalized) return;

        if (numericOnly && !/^[0-9]+$/.test(normalized)) return;
        if (!numericOnly && !/^[0-9A-Za-z]+$/.test(normalized)) return;

        // Looks like a scanner burst: consume event.
        e.preventDefault();
        e.stopPropagation();

        void onScan(normalized);
        return;
      }

      // Printable characters only.
      if (key.length !== 1) return;

      const { maxInterKeyDelayMs } = optionsRef.current;

      const lastAt = lastKeyAtRef.current;
      if (lastAt != null && now - lastAt > maxInterKeyDelayMs) {
        bufferRef.current = '';
        startedAtRef.current = null;
      }

      if (!startedAtRef.current) startedAtRef.current = now;
      lastKeyAtRef.current = now;

      bufferRef.current += key;
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onScan]);
}
