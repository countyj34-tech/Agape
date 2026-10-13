import { useCallback, useEffect, useState } from 'react';

/**
 * Generic localStorage-backed form state hook.
 * - Restores previous draft (if any) on mount.
 * - Persists on every change.
 * - Provides a clear() helper to reset and drop the draft.
 */
export function usePersistentForm<T>(
  storageKey: string,
  createInitial: () => T
): [T, (updater: T | ((prev: T) => T)) => void, () => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return createInitial();
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return createInitial();
      const parsed = JSON.parse(raw) as T;
      return { ...createInitial(), ...parsed };
    } catch {
      return createInitial();
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // ignore quota / serialization errors
    }
  }, [storageKey, value]);

  const update = useCallback(
    (updater: T | ((prev: T) => T)) => {
      setValue((prev) => (typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater));
    },
    []
  );

  const clear = useCallback(() => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // ignore
    }
    setValue(createInitial());
  }, [createInitial, storageKey]);

  return [value, update, clear];
}
