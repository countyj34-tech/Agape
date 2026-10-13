import { useEffect, useState } from 'react';
import {
  customerDisplayService,
  type CustomerDisplayStatus,
  type DetectedSerialPort,
} from '@/lib/customerDisplayService';
import type { CustomerDisplaySettings } from '@/types/pos';
import { getCustomerDisplaySettings, saveCustomerDisplaySettings } from '@/lib/db';

export function useCustomerDisplayHardware() {
  const [state, setState] = useState<CustomerDisplayStatus>(() => customerDisplayService.getState());
  const [settings, setSettings] = useState<CustomerDisplaySettings>(() =>
    customerDisplayService.getSettings()
  );
  const [ports, setPorts] = useState<DetectedSerialPort[]>([]);

  useEffect(() => customerDisplayService.subscribe(setState), []);

  useEffect(() => {
    void (async () => {
      await customerDisplayService.initialize();
      setSettings(await getCustomerDisplaySettings());
      setPorts(await customerDisplayService.detectPorts());
    })();
  }, []);

  const refreshPorts = async () => {
    const next = await customerDisplayService.detectPorts();
    setPorts(next);
    return next;
  };

  const saveSettings = async (patch: Partial<CustomerDisplaySettings>) => {
    const next = await saveCustomerDisplaySettings(patch);
    setSettings(next);
    await customerDisplayService.reloadSettings();
    return next;
  };

  return {
    state,
    settings,
    ports,
    isSupported: customerDisplayService.isSupported(),
    refreshPorts,
    saveSettings,
    requestPort: () => customerDisplayService.requestPort(),
    connect: (port?: SerialPort) => customerDisplayService.connect(port),
    disconnect: () => customerDisplayService.disconnect(),
    reconnect: () => customerDisplayService.reconnect(),
    test: () => customerDisplayService.test(),
    displayWelcome: () => customerDisplayService.displayWelcome(),
  };
}
