import { useEffect, useState } from 'react';
import { bluetoothPrinterService, type BluetoothPrinterStatus } from '@/lib/bluetoothPrinterService';
import type { Sale, Settings } from '@/types/pos';

export function useBluetoothPrinter() {
  const [state, setState] = useState<BluetoothPrinterStatus>(() => bluetoothPrinterService.getState());

  useEffect(() => bluetoothPrinterService.subscribe(setState), []);

  return {
    state,
    discoverAndConnect: () => bluetoothPrinterService.discoverAndConnect(),
    discoverAndConnectSerial: () => bluetoothPrinterService.discoverAndConnectSerial(),
    discoverAndConnectBle: () => bluetoothPrinterService.discoverAndConnectBle(),
    autoReconnect: () => bluetoothPrinterService.autoReconnect(),
    ensureConnected: () => bluetoothPrinterService.ensureConnected(),
    disconnect: () => bluetoothPrinterService.disconnect(),
    printBytes: (data: Uint8Array) => bluetoothPrinterService.printBytes(data),
    printSale: (sale: Sale, settings: Settings) => bluetoothPrinterService.printSale(sale, settings),
    testPrint: (settings: Settings) => bluetoothPrinterService.testPrint(settings),
    openDrawer: (settings: Settings) => bluetoothPrinterService.openDrawer(settings),
  };
}
