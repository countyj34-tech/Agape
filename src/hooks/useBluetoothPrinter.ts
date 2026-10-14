import { useCallback, useEffect, useState } from 'react';
import { bluetoothPrinterService, type BluetoothPrinterStatus } from '@/lib/bluetoothPrinterService';
import type { Sale, Settings } from '@/types/pos';

export function useBluetoothPrinter() {
  const [state, setState] = useState<BluetoothPrinterStatus>(() => bluetoothPrinterService.getState());

  useEffect(() => bluetoothPrinterService.subscribe(setState), []);

  const discoverAndConnect = useCallback(() => bluetoothPrinterService.discoverAndConnect(), []);
  const discoverAndConnectSerial = useCallback(() => bluetoothPrinterService.discoverAndConnectSerial(), []);
  const discoverAndConnectUsb = useCallback(() => bluetoothPrinterService.discoverAndConnectUsb(), []);
  const discoverAndConnectBle = useCallback(() => bluetoothPrinterService.discoverAndConnectBle(), []);
  const connectNativePrinter = useCallback(
    (portPath: string, baudRate?: number) => bluetoothPrinterService.connectNativePrinter(portPath, baudRate),
    []
  );
  const autoReconnect = useCallback(() => bluetoothPrinterService.autoReconnect(), []);
  const ensureConnected = useCallback(() => bluetoothPrinterService.ensureConnected(), []);
  const disconnect = useCallback(() => bluetoothPrinterService.disconnect(), []);
  const printBytes = useCallback((data: Uint8Array) => bluetoothPrinterService.printBytes(data), []);
  const printSale = useCallback((sale: Sale, settings: Settings) => bluetoothPrinterService.printSale(sale, settings), []);
  const testPrint = useCallback((settings: Settings) => bluetoothPrinterService.testPrint(settings), []);
  const openDrawer = useCallback((settings: Settings) => bluetoothPrinterService.openDrawer(settings), []);

  return {
    state,
    discoverAndConnect,
    discoverAndConnectSerial,
    discoverAndConnectUsb,
    discoverAndConnectBle,
    connectNativePrinter,
    autoReconnect,
    ensureConnected,
    disconnect,
    printBytes,
    printSale,
    testPrint,
    openDrawer,
  };
}
