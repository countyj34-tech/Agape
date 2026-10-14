import React, { useEffect, useState } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { useBluetoothPrinter } from './useBluetoothPrinter';

describe('useBluetoothPrinter', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps autoReconnect stable across rerenders', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const seen: Array<(() => Promise<boolean>) | undefined> = [];

    function Probe() {
      const { autoReconnect } = useBluetoothPrinter();
      const [tick, setTick] = useState(0);

      useEffect(() => {
        if (tick === 0) {
          setTick(1);
        }
      }, [tick]);

      useEffect(() => {
        seen.push(autoReconnect);
      }, [autoReconnect]);

      return <div>{tick}</div>;
    }

    act(() => {
      root.render(<Probe />);
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
