import { buildEscPosReceipt, buildEscPosTestPrint } from '@/lib/escpos';
import type { Sale, Settings } from '@/types/pos';

export type BluetoothPrinterStatus =
  | { kind: 'unsupported' }
  | { kind: 'disconnected' }
  | { kind: 'connecting'; deviceName?: string }
  | { kind: 'connected'; deviceName: string; transport?: 'serial' | 'usb' | 'ble' | 'network' }
  | { kind: 'error'; error: string };

const LS_DEVICE_ID = 'bluetoothPrinter:lastDeviceId';
const LS_SERVICE_UUID = 'bluetoothPrinter:lastServiceUuid';
const LS_CHAR_UUID = 'bluetoothPrinter:lastCharacteristicUuid';
const LS_TRANSPORT = 'bluetoothPrinter:transport';
const LS_BAUD = 'bluetoothPrinter:baudRate';
const LS_SERIAL_VID = 'bluetoothPrinter:serialVendorId';
const LS_SERIAL_PID = 'bluetoothPrinter:serialProductId';
const LS_NETWORK_HOST = 'bluetoothPrinter:networkHost';
const LS_NETWORK_PORT = 'bluetoothPrinter:networkPort';

/** RPP02N and similar Classic Bluetooth printers speak ESC/POS over a virtual COM port. */
const DEFAULT_SERIAL_BAUD = 9600;
const DEFAULT_NETWORK_PORT = 9100;
const USB_PRINTER_VENDOR_IDS = [0x04b8];

function getUsbPrinterFilters(): Array<{ vendorId?: number; classCode?: number }> {
  return USB_PRINTER_VENDOR_IDS.map((vendorId) => ({ vendorId }));
}

function findUsbBulkOutEndpoint(device: USBDevice): { interfaceNumber: number; endpointNumber: number } | null {
  const configs = device.configurations ?? [];
  for (const config of configs) {
    for (const iface of config.interfaces ?? []) {
      for (const alt of iface.alternates ?? []) {
        for (const endpoint of alt.endpoints ?? []) {
          if (endpoint.type === 'bulk' && endpoint.direction === 'out') {
            return {
              interfaceNumber: iface.interfaceNumber,
              endpointNumber: endpoint.endpointNumber,
            };
          }
        }
      }
    }
  }

  const fallbackEndpoint = device.configurations?.[0]?.interfaces?.[0]?.alternates?.[0]?.endpoints?.find(
    (endpoint) => endpoint.type === 'bulk' || endpoint.direction === 'out'
  );

  if (fallbackEndpoint) {
    return {
      interfaceNumber: device.configurations?.[0]?.interfaces?.[0]?.interfaceNumber ?? 0,
      endpointNumber: fallbackEndpoint.endpointNumber,
    };
  }

  return null;
}

// Common BLE UART-ish services used by many low-cost ESC/POS printers.
const CANDIDATE_SERVICE_UUIDS: BluetoothServiceUUID[] = [
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
];

const CANDIDATE_CHARACTERISTIC_UUIDS: BluetoothCharacteristicUUID[] = [
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '0000ff01-0000-1000-8000-00805f9b34fb',
  '0000ff02-0000-1000-8000-00805f9b34fb',
  '0000fff1-0000-1000-8000-00805f9b34fb',
];

type Listener = (state: BluetoothPrinterStatus) => void;
type PrinterTransport = 'serial' | 'usb' | 'ble' | 'network';

function normalizeNetworkHost(input: string): string {
  const value = String(input || '').trim();
  if (!value) return '';
  return value
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as Navigator & { bluetooth?: unknown }).bluetooth;
}

function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as Navigator & { serial?: Serial }).serial;
}

function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as Navigator & { usb?: USB }).usb;
}

function hasConfiguredNetworkPrinter(): boolean {
  if (typeof localStorage === 'undefined') return false;
  const host = normalizeNetworkHost(localStorage.getItem(LS_NETWORK_HOST) || '');
  const port = Number(localStorage.getItem(LS_NETWORK_PORT));
  return !!host && Number.isInteger(port) && port >= 1 && port <= 65535;
}

function isAnyPrinterApiSupported(): boolean {
  return isWebBluetoothSupported() || isWebSerialSupported() || isWebUsbSupported() || hasConfiguredNetworkPrinter();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serialPortLabel(port: SerialPort, fallback = 'Serial Printer'): string {
  const info = port.getInfo?.() || {};
  if (info.usbVendorId != null && info.usbProductId != null) {
    const vid = info.usbVendorId.toString(16).padStart(4, '0');
    const pid = info.usbProductId.toString(16).padStart(4, '0');
    return `COM / USB (${vid}:${pid})`;
  }
  return fallback;
}

export class BluetoothPrinterService {
  private state: BluetoothPrinterStatus = isAnyPrinterApiSupported()
    ? { kind: 'disconnected' }
    : { kind: 'unsupported' };

  private listeners = new Set<Listener>();
  private transport: PrinterTransport | null = null;

  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;

  private serialPort: SerialPort | null = null;
  private serialWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;

  private usbDevice: USBDevice | null = null;
  private usbEndpointNumber: number | null = null;

  private networkHost: string | null = null;
  private networkPort: number | null = null;

  constructor() {
    const savedHost = localStorage.getItem(LS_NETWORK_HOST);
    const savedPort = Number(localStorage.getItem(LS_NETWORK_PORT));
    if (savedHost) this.networkHost = normalizeNetworkHost(savedHost);
    if (Number.isFinite(savedPort) && savedPort > 0) this.networkPort = savedPort;
  }

  getState(): BluetoothPrinterStatus {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private setState(next: BluetoothPrinterStatus) {
    this.state = next;
    for (const l of this.listeners) l(next);
  }

  /** Prefer the most reliable browser-supported printer path available: serial, USB, LAN, then BLE. */
  async discoverAndConnect(): Promise<boolean> {
    if (isWebSerialSupported()) {
      return this.discoverAndConnectSerial();
    }
    if (isWebUsbSupported()) {
      return this.discoverAndConnectUsb();
    }
    if (this.networkHost && this.networkPort) {
      return this.autoReconnectNetwork();
    }
    return this.discoverAndConnectBle();
  }

  async discoverAndConnectUsb(): Promise<boolean> {
    if (!isWebUsbSupported()) {
      this.setState({ kind: 'unsupported' });
      throw new Error('USB printing requires Chrome or Edge with WebUSB enabled.');
    }

    try {
      this.setState({ kind: 'connecting', deviceName: 'USB printer' });
      const device = await (navigator as Navigator & { usb: USB }).usb.requestDevice({
        filters: getUsbPrinterFilters(),
      });
      await this.connectUsbDevice(device);
      return true;
    } catch (e) {
      if ((e as Error)?.name === 'NotFoundError') {
        this.setState({ kind: 'disconnected' });
        return false;
      }
      const msg = (e as Error)?.message || 'USB printer connection failed';
      this.setState({ kind: 'error', error: msg });
      throw e;
    }
  }

  async discoverAndConnectNetwork(host?: string, port?: number): Promise<boolean> {
    const hostValue = normalizeNetworkHost(host ?? this.networkHost ?? '');
    const portValue = Number(port ?? this.networkPort ?? DEFAULT_NETWORK_PORT);

    if (!hostValue) {
      const inputHost =
        typeof window !== 'undefined' && typeof window.prompt === 'function'
          ? window.prompt('Enter the printer IP or hostname (for example 192.168.1.50):', this.networkHost || '')
          : null;
      if (!inputHost) {
        this.setState({ kind: 'disconnected' });
        return false;
      }
      return this.connectNetworkPrinter(inputHost, portValue || DEFAULT_NETWORK_PORT);
    }

    if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535) {
      throw new Error('Printer port must be between 1 and 65535.');
    }

    return this.connectNetworkPrinter(hostValue, portValue);
  }

  /**
   * Connect via Web Serial (Windows Bluetooth COM / USB).
   * Use this for RPP02N — Windows "Driver is unavailable" is normal; you do not need a Windows printer driver.
   * @returns false if the user cancelled the port picker
   */
  async discoverAndConnectSerial(): Promise<boolean> {
    if (!isWebSerialSupported()) {
      this.setState({ kind: 'unsupported' });
      throw new Error('Serial printing needs Chrome or Edge.');
    }

    try {
      this.setState({ kind: 'connecting', deviceName: 'Serial / COM printer' });
      const port = await navigator.serial.requestPort();
      await this.connectSerialPort(port);
      return true;
    } catch (e) {
      if ((e as Error)?.name === 'NotFoundError') {
        this.setState({ kind: 'disconnected' });
        return false;
      }
      const msg = (e as Error)?.message || 'Serial printer connection failed';
      this.setState({ kind: 'error', error: msg });
      throw e;
    }
  }

  /** Connect via Web Bluetooth (BLE UART printers only). @returns false if cancelled */
  async discoverAndConnectBle(): Promise<boolean> {
    if (!isWebBluetoothSupported()) {
      this.setState({ kind: 'unsupported' });
      throw new Error('Web Bluetooth is not supported in this browser. Use Chrome/Edge.');
    }

    try {
      this.setState({ kind: 'connecting' });

      const bluetooth = (navigator as any).bluetooth as {
        requestDevice: (options: any) => Promise<BluetoothDevice>;
      };
      const device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: CANDIDATE_SERVICE_UUIDS,
      });

      await this.connectBleDevice(device);
      return true;
    } catch (e) {
      if ((e as Error)?.name === 'NotFoundError') {
        this.setState({ kind: 'disconnected' });
        return false;
      }
      const msg = (e as Error)?.message || 'Bluetooth connection failed';
      this.setState({ kind: 'error', error: msg });
      throw e;
    }
  }

  async autoReconnect(): Promise<boolean> {
    const preferred = (localStorage.getItem(LS_TRANSPORT) as PrinterTransport | null) || null;

    if (preferred === 'serial' || (!preferred && isWebSerialSupported())) {
      const ok = await this.autoReconnectSerial();
      if (ok) return true;
      if (preferred === 'serial') return false;
    }

    if (preferred === 'usb' || (!preferred && isWebUsbSupported())) {
      const ok = await this.autoReconnectUsb();
      if (ok) return true;
      if (preferred === 'usb') return false;
    }

    if (preferred === 'network' || (!preferred && this.networkHost && this.networkPort)) {
      const ok = await this.autoReconnectNetwork();
      if (ok) return true;
      if (preferred === 'network') return false;
    }

    if (isWebBluetoothSupported()) {
      return this.autoReconnectBle();
    }

    return false;
  }

  /** Ensure the printer is ready before an automatic sale print. */
  async ensureConnected(): Promise<boolean> {
    if (!isAnyPrinterApiSupported() && !(this.networkHost && this.networkPort)) return false;
    if (this.isReady()) return true;
    return this.autoReconnect();
  }

  async disconnect(): Promise<void> {
    await this.closeSerialQuietly();
    await this.closeUsbQuietly();
    await this.closeNetworkQuietly();
    await this.disconnectBleQuietly();
    this.transport = null;
    if (isAnyPrinterApiSupported()) this.setState({ kind: 'disconnected' });
  }

  async printBytes(data: Uint8Array): Promise<void> {
    if (!isAnyPrinterApiSupported() && !(this.networkHost && this.networkPort)) {
      throw new Error('Printer APIs are not supported in this browser. Use Chrome/Edge.');
    }

    if (!this.isReady()) {
      await this.ensureConnected();
    }

    if (!this.isReady()) {
      throw new Error(
        'Printer not connected. Open Admin → Settings → Hardware and use “Connect Cable / USB”, “Connect Wi‑Fi / LAN”, or “Connect Serial / COM (RPP02N)”.'
      );
    }

    if (this.transport === 'serial' && this.serialWriter) {
      await this.writeSerial(data);
      return;
    }

    if (this.transport === 'usb' && this.usbDevice && this.usbEndpointNumber != null) {
      await this.writeUsb(data);
      return;
    }

    if (this.transport === 'network' && this.networkHost && this.networkPort) {
      await this.writeNetwork(data);
      return;
    }

    await this.writeBle(data);
  }

  async printSale(sale: Sale, settings: Settings): Promise<void> {
    const bytes = buildEscPosReceipt({ sale, settings });
    await this.printBytes(bytes);
  }

  async testPrint(settings: Settings): Promise<void> {
    const bytes = buildEscPosTestPrint(settings);
    await this.printBytes(bytes);
  }

  async openDrawer(settings: Settings): Promise<void> {
    try {
      const { buildEscPosDrawerPulse } = await import('@/lib/escpos');
      const bytes = buildEscPosDrawerPulse();
      await this.printBytes(bytes);
    } catch (e) {
      const msg = (e as Error)?.message || 'Failed to open cash drawer';
      this.setState({ kind: 'error', error: msg });
      throw e;
    }
  }

  private isReady(): boolean {
    if (this.transport === 'serial') {
      return !!this.serialWriter && !!this.serialPort;
    }
    if (this.transport === 'usb') {
      return !!this.usbDevice && this.usbEndpointNumber != null;
    }
    if (this.transport === 'ble') {
      return !!this.characteristic && !!this.server?.connected;
    }
    if (this.transport === 'network') {
      return !!this.networkHost && !!this.networkPort;
    }
    return false;
  }

  private async connectUsbDevice(device: USBDevice): Promise<void> {
    await this.closeSerialQuietly();
    await this.disconnectBleQuietly();
    await this.closeNetworkQuietly();

    this.usbDevice = device;
    this.setState({ kind: 'connecting', deviceName: device.productName || 'USB printer' });

    if (device.open) await device.open();
    if (device.configuration === null) {
      const config = device.configurations?.[0];
      if (config && device.selectConfiguration) {
        await device.selectConfiguration(config.configurationValue);
      }
    }

    const endpointMatch = findUsbBulkOutEndpoint(device);
    const targetInterface = endpointMatch?.interfaceNumber ?? 0;
    this.usbEndpointNumber = endpointMatch?.endpointNumber ?? 2;

    if (device.claimInterface && typeof targetInterface === 'number') {
      try {
        await device.claimInterface(targetInterface);
      } catch {
        // Some Epson devices already expose the interface or require a different interface selection.
      }
    }

    this.transport = 'usb';
    localStorage.setItem(LS_TRANSPORT, 'usb');
    this.setState({
      kind: 'connected',
      deviceName: device.productName || 'USB printer',
      transport: 'usb',
    });
  }

  async connectNetworkPrinter(host: string, port: number): Promise<boolean> {
    const normalizedHost = normalizeNetworkHost(host);
    if (!normalizedHost) {
      throw new Error('Printer IP address or host is required.');
    }

    const portValue = Number(port);
    if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535) {
      throw new Error('Printer port must be between 1 and 65535.');
    }

    await this.closeSerialQuietly();
    await this.disconnectBleQuietly();

    this.setState({ kind: 'connecting', deviceName: `${normalizedHost}:${portValue}` });

    const response = await fetch('/api/printer/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: normalizedHost, port: portValue }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      this.setState({ kind: 'error', error: errorText || 'Failed to connect to LAN printer' });
      throw new Error(errorText || 'Failed to connect to LAN printer');
    }

    this.networkHost = normalizedHost;
    this.networkPort = portValue;
    localStorage.setItem(LS_NETWORK_HOST, normalizedHost);
    localStorage.setItem(LS_NETWORK_PORT, String(portValue));
    localStorage.setItem(LS_TRANSPORT, 'network');

    this.transport = 'network';
    this.setState({
      kind: 'connected',
      deviceName: `${normalizedHost}:${portValue}`,
      transport: 'network',
    });
    return true;
  }

  private async autoReconnectUsb(): Promise<boolean> {
    if (!isWebUsbSupported()) return false;

    try {
      this.setState({ kind: 'connecting', deviceName: 'USB printer' });
      const usb = (navigator as Navigator & { usb: USB }).usb;
      const devices = await usb.getDevices();
      if (!devices.length) return false;
      await this.connectUsbDevice(devices[0]);
      return true;
    } catch {
      this.setState({ kind: 'disconnected' });
      return false;
    }
  }

  private async autoReconnectNetwork(): Promise<boolean> {
    const host = this.networkHost || normalizeNetworkHost(localStorage.getItem(LS_NETWORK_HOST) || '');
    const port = this.networkPort ?? Number(localStorage.getItem(LS_NETWORK_PORT));

    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return false;
    }

    try {
      this.setState({ kind: 'connecting', deviceName: `${host}:${port}` });
      await this.connectNetworkPrinter(host, port);
      return true;
    } catch {
      this.setState({ kind: 'disconnected' });
      return false;
    }
  }

  private async autoReconnectSerial(): Promise<boolean> {
    if (!isWebSerialSupported()) return false;

    if (this.serialWriter && this.serialPort) {
      this.transport = 'serial';
      this.setState({
        kind: 'connected',
        deviceName: serialPortLabel(this.serialPort),
        transport: 'serial',
      });
      return true;
    }

    try {
      this.setState({ kind: 'connecting', deviceName: 'Serial / COM printer' });
      const ports = await navigator.serial.getPorts();
      if (!ports.length) {
        this.setState({ kind: 'disconnected' });
        return false;
      }

      const vid = Number(localStorage.getItem(LS_SERIAL_VID) || '');
      const pid = Number(localStorage.getItem(LS_SERIAL_PID) || '');
      const matched =
        Number.isFinite(vid) && Number.isFinite(pid)
          ? ports.find((p) => {
              const info = p.getInfo?.() || {};
              return info.usbVendorId === vid && info.usbProductId === pid;
            })
          : undefined;

      await this.connectSerialPort(matched || ports[ports.length - 1]);
      return true;
    } catch (e) {
      console.warn('Serial printer reconnect failed', e);
      this.setState({ kind: 'disconnected' });
      return false;
    }
  }

  private async autoReconnectBle(): Promise<boolean> {
    if (!isWebBluetoothSupported()) return false;

    if (this.device) {
      try {
        this.setState({ kind: 'connecting', deviceName: this.device.name || 'Bluetooth Printer' });
        await this.connectBleDevice(this.device);
        return true;
      } catch (e) {
        console.warn('Same-session printer reconnect failed', e);
      }
    }

    const lastId = localStorage.getItem(LS_DEVICE_ID);
    if (!lastId) return false;

    const getDevices = (navigator.bluetooth as Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> })
      .getDevices;
    if (!getDevices) return false;

    try {
      this.setState({ kind: 'connecting' });
      const devices = await getDevices();
      const device = devices.find((d) => d.id === lastId);
      if (!device) {
        this.setState({ kind: 'disconnected' });
        return false;
      }
      await this.connectBleDevice(device);
      return true;
    } catch (e) {
      const msg = (e as Error)?.message || 'Auto-reconnect failed';
      this.setState({ kind: 'error', error: msg });
      return false;
    }
  }

  private async connectSerialPort(port: SerialPort): Promise<void> {
    await this.disconnectBleQuietly();
    await this.closeSerialQuietly();

    const baud = Number(localStorage.getItem(LS_BAUD)) || DEFAULT_SERIAL_BAUD;
    this.setState({ kind: 'connecting', deviceName: serialPortLabel(port) });

    try {
      await port.open({
        baudRate: baud,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
      });
    } catch (e) {
      // Port may already be open from a previous session in this document.
      const msg = String((e as Error)?.message || e);
      if (!/already open/i.test(msg)) throw e;
    }

    this.serialPort = port;
    this.serialWriter = port.writable?.getWriter() ?? null;
    if (!this.serialWriter) {
      throw new Error('Serial port has no writable stream.');
    }

    port.removeEventListener('disconnect', this.handleSerialDisconnect);
    port.addEventListener('disconnect', this.handleSerialDisconnect);

    const info = port.getInfo?.() || {};
    if (info.usbVendorId != null) localStorage.setItem(LS_SERIAL_VID, String(info.usbVendorId));
    if (info.usbProductId != null) localStorage.setItem(LS_SERIAL_PID, String(info.usbProductId));
    localStorage.setItem(LS_TRANSPORT, 'serial');

    this.transport = 'serial';
    this.setState({
      kind: 'connected',
      deviceName: serialPortLabel(port, 'RPP02N / Serial Printer'),
      transport: 'serial',
    });
  }

  private handleSerialDisconnect = () => {
    void this.closeSerialQuietly();
    this.transport = null;
    if (isAnyPrinterApiSupported()) this.setState({ kind: 'disconnected' });
  };

  private async writeSerial(data: Uint8Array): Promise<void> {
    const writer = this.serialWriter;
    if (!writer) throw new Error('Serial printer not connected.');

    const chunkSize = 512;
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const chunk = data.slice(offset, Math.min(data.length, offset + chunkSize));
      await writer.write(chunk);
      await delay(20);
    }
  }

  private async writeUsb(data: Uint8Array): Promise<void> {
    if (!this.usbDevice || this.usbEndpointNumber == null) {
      throw new Error('USB printer is not connected.');
    }
    const payload = new Uint8Array(data);
    await this.usbDevice.transferOut(this.usbEndpointNumber, payload);
  }

  private async writeNetwork(data: Uint8Array): Promise<void> {
    if (!this.networkHost || !this.networkPort) {
      throw new Error('Network printer is not configured.');
    }

    const response = await fetch('/api/printer/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: this.networkHost,
        port: this.networkPort,
        data: Array.from(data),
      }),
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(message || 'Failed to send print job to the network printer.');
    }
  }

  private async writeBle(data: Uint8Array): Promise<void> {
    const c = this.characteristic;
    if (!c || !this.server?.connected) {
      throw new Error('Printer not connected. Open Admin > Settings to connect a printer once.');
    }

    const chunkSize = 180;
    const supportsWriteWithoutResponse = (c.properties as BluetoothCharacteristicProperties & {
      writeWithoutResponse?: boolean;
    }).writeWithoutResponse;

    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const chunk = data.slice(offset, Math.min(data.length, offset + chunkSize));
      const payload = new Uint8Array(chunk);
      if (supportsWriteWithoutResponse && (c as BluetoothRemoteGATTCharacteristic & {
        writeValueWithoutResponse?: (v: BufferSource) => Promise<void>;
      }).writeValueWithoutResponse) {
        await (
          c as BluetoothRemoteGATTCharacteristic & {
            writeValueWithoutResponse: (v: BufferSource) => Promise<void>;
          }
        ).writeValueWithoutResponse(payload);
      } else {
        await c.writeValue(payload);
      }
      await delay(10);
    }
  }

  private async connectBleDevice(device: BluetoothDevice): Promise<void> {
    await this.closeSerialQuietly();

    this.device = device;

    device.removeEventListener('gattserverdisconnected', this.handleBleDisconnected as EventListener);
    device.addEventListener('gattserverdisconnected', this.handleBleDisconnected as EventListener);

    const name = device.name || 'Bluetooth Printer';
    this.setState({ kind: 'connecting', deviceName: name });

    const server = await device.gatt?.connect();
    if (!server) throw new Error('Could not connect to printer (no GATT server).');

    this.server = server;

    const characteristic = await this.findWritableCharacteristic(server);
    if (!characteristic) {
      throw new Error(
        'This printer is not BLE. For RPP02N use “Connect Serial / COM” instead (Windows Bluetooth COM port).'
      );
    }

    this.characteristic = characteristic;
    this.transport = 'ble';

    localStorage.setItem(LS_DEVICE_ID, device.id);
    localStorage.setItem(LS_TRANSPORT, 'ble');
    const svcUuid = (characteristic.service?.uuid ?? '') as string;
    if (svcUuid) localStorage.setItem(LS_SERVICE_UUID, svcUuid);
    localStorage.setItem(LS_CHAR_UUID, String(characteristic.uuid));

    this.setState({ kind: 'connected', deviceName: name, transport: 'ble' });
  }

  private handleBleDisconnected = () => {
    this.server = null;
    this.characteristic = null;
    if (this.transport === 'ble') this.transport = null;
    if (isAnyPrinterApiSupported()) this.setState({ kind: 'disconnected' });
  };

  private async closeSerialQuietly(): Promise<void> {
    try {
      this.serialPort?.removeEventListener('disconnect', this.handleSerialDisconnect);
    } catch {
      /* ignore */
    }
    try {
      await this.serialWriter?.releaseLock();
    } catch {
      /* ignore */
    }
    this.serialWriter = null;
    try {
      await this.serialPort?.close();
    } catch {
      /* ignore */
    }
    this.serialPort = null;
  }

  private async closeUsbQuietly(): Promise<void> {
    try {
      if (this.usbDevice && this.usbDevice.releaseInterface && this.usbDevice.configuration) {
        const interfaces = this.usbDevice.configuration.interfaces;
        for (const iface of interfaces) {
          try {
            await this.usbDevice.releaseInterface(iface.interfaceNumber);
          } catch {
            // ignore
          }
        }
      }
      if (this.usbDevice && this.usbDevice.close) {
        await this.usbDevice.close();
      }
    } catch {
      // ignore
    }
    this.usbDevice = null;
    this.usbEndpointNumber = null;
  }

  private async closeNetworkQuietly(): Promise<void> {
    if (!this.networkHost || !this.networkPort) return;

    try {
      await fetch('/api/printer/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: this.networkHost, port: this.networkPort }),
      });
    } catch {
      /* ignore */
    }
  }

  private async disconnectBleQuietly(): Promise<void> {
    try {
      if (this.device?.gatt?.connected) {
        this.device.gatt.disconnect();
      }
    } catch {
      /* ignore */
    }
    this.device = null;
    this.server = null;
    this.characteristic = null;
  }

  private async findWritableCharacteristic(
    server: BluetoothRemoteGATTServer
  ): Promise<BluetoothRemoteGATTCharacteristic | null> {
    const preferredServiceUuid = localStorage.getItem(LS_SERVICE_UUID) || '';
    const preferredCharUuid = localStorage.getItem(LS_CHAR_UUID) || '';

    if (preferredServiceUuid && preferredCharUuid) {
      try {
        const service = await server.getPrimaryService(preferredServiceUuid);
        const ch = await service.getCharacteristic(preferredCharUuid);
        if (ch.properties.write || ch.properties.writeWithoutResponse) return ch;
      } catch {
        // ignore
      }
    }

    for (const s of CANDIDATE_SERVICE_UUIDS) {
      try {
        const service = await server.getPrimaryService(s);
        for (const c of CANDIDATE_CHARACTERISTIC_UUIDS) {
          try {
            const ch = await service.getCharacteristic(c);
            if (ch.properties.write || ch.properties.writeWithoutResponse) return ch;
          } catch {
            // continue
          }
        }
      } catch {
        // continue
      }
    }

    try {
      const services = await server.getPrimaryServices();
      for (const svc of services) {
        try {
          const chars = await svc.getCharacteristics();
          for (const ch of chars) {
            if (ch.properties.write || ch.properties.writeWithoutResponse) return ch;
          }
        } catch {
          // continue
        }
      }
    } catch {
      // Some browsers block listing services without optionalServices.
    }

    return null;
  }
}

export const bluetoothPrinterService = new BluetoothPrinterService();
