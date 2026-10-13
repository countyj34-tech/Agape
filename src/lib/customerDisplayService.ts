/**
 * Hardware customer pole / VFD display service (Web Serial).
 *
 * Browser POS terminals use Chrome/Edge Web Serial for USB Virtual COM and
 * USB-serial adapters. All I/O is queued asynchronously so the UI never blocks.
 * Failures are logged and never thrown into the sales path.
 */

import type { CustomerDisplaySettings } from '@/types/pos';
import {
  defaultCustomerDisplaySettings,
  getCustomerDisplaySettings,
  saveCustomerDisplaySettings,
} from '@/lib/db';

export type CustomerDisplayStatus =
  | { kind: 'unsupported' }
  | { kind: 'disabled' }
  | { kind: 'disconnected' }
  | { kind: 'connecting' }
  | { kind: 'connected'; portLabel: string }
  | { kind: 'error'; error: string };

export type DetectedSerialPort = {
  id: string;
  label: string;
  vendorId?: number;
  productId?: number;
  port: SerialPort;
};

type Listener = (state: CustomerDisplayStatus) => void;

const RECONNECT_MS = 5000;
const WELCOME_DELAY_MS = 5000;

function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as Navigator & { serial?: Serial }).serial;
}

function padLine(text: string, width: number): string {
  const clean = String(text || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .slice(0, width);
  return clean + ' '.repeat(Math.max(0, width - clean.length));
}

function money(symbol: string, amount: number): string {
  return `${symbol}${Number(amount || 0).toFixed(2)}`;
}

function portLabel(port: SerialPort, fallback = ''): string {
  const info = port.getInfo?.() || {};
  if (info.usbVendorId != null && info.usbProductId != null) {
    const vid = info.usbVendorId.toString(16).padStart(4, '0');
    const pid = info.usbProductId.toString(16).padStart(4, '0');
    return `USB Serial (${vid}:${pid})`;
  }
  return fallback || 'Serial Port';
}

function portId(port: SerialPort): string {
  const info = port.getInfo?.() || {};
  if (info.usbVendorId != null && info.usbProductId != null) {
    return `${info.usbVendorId}:${info.usbProductId}`;
  }
  return 'serial:unknown';
}

export class CustomerDisplayService {
  private state: CustomerDisplayStatus = isWebSerialSupported()
    ? { kind: 'disconnected' }
    : { kind: 'unsupported' };
  private listeners = new Set<Listener>();
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private settings: CustomerDisplaySettings = defaultCustomerDisplaySettings();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private welcomeTimer: ReturnType<typeof setTimeout> | null = null;
  private currencySymbol = 'K';
  private initialized = false;

  getState(): CustomerDisplayStatus {
    return this.state;
  }

  getSettings(): CustomerDisplaySettings {
    return this.settings;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private setState(next: CustomerDisplayStatus) {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  private logError(context: string, error: unknown) {
    console.warn(`[CustomerDisplay] ${context}:`, error);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      this.settings = await getCustomerDisplaySettings();
      if (!isWebSerialSupported()) {
        this.setState({ kind: 'unsupported' });
        return;
      }
      if (!this.settings.enabled) {
        this.setState({ kind: 'disabled' });
        return;
      }
      if (this.settings.autoReconnect) {
        await this.reconnect();
      } else {
        this.setState({ kind: 'disconnected' });
      }
    } catch (error) {
      this.logError('initialize', error);
      this.setState({
        kind: 'error',
        error: (error as Error)?.message || 'Failed to initialize customer display',
      });
    }
  }

  async reloadSettings(): Promise<CustomerDisplaySettings> {
    this.settings = await getCustomerDisplaySettings();
    return this.settings;
  }

  setCurrencySymbol(symbol: string) {
    this.currencySymbol = symbol || 'K';
  }

  isSupported(): boolean {
    return isWebSerialSupported();
  }

  async detectPorts(): Promise<DetectedSerialPort[]> {
    if (!isWebSerialSupported()) return [];
    try {
      const ports = await navigator.serial.getPorts();
      return ports.map((port) => ({
        id: portId(port),
        label: portLabel(port),
        vendorId: port.getInfo?.().usbVendorId,
        productId: port.getInfo?.().usbProductId,
        port,
      }));
    } catch (error) {
      this.logError('detectPorts', error);
      return [];
    }
  }

  /** Must be called from a user gesture. */
  async requestPort(): Promise<DetectedSerialPort | null> {
    if (!isWebSerialSupported()) {
      this.setState({ kind: 'unsupported' });
      return null;
    }
    try {
      const port = await navigator.serial.requestPort();
      const detected: DetectedSerialPort = {
        id: portId(port),
        label: portLabel(port),
        vendorId: port.getInfo?.().usbVendorId,
        productId: port.getInfo?.().usbProductId,
        port,
      };
      this.settings = await saveCustomerDisplaySettings({
        comPort: detected.label,
        portVendorId: detected.vendorId ?? null,
        portProductId: detected.productId ?? null,
      });
      return detected;
    } catch (error) {
      // User cancelled the picker — not an error.
      if ((error as Error)?.name === 'NotFoundError') return null;
      this.logError('requestPort', error);
      throw error;
    }
  }

  async connect(selectedPort?: SerialPort): Promise<void> {
    if (!isWebSerialSupported()) {
      this.setState({ kind: 'unsupported' });
      return;
    }
    this.clearReconnectTimer();
    this.setState({ kind: 'connecting' });

    try {
      this.settings = await getCustomerDisplaySettings();
      let port = selectedPort || null;

      if (!port) {
        const ports = await this.detectPorts();
        port =
          ports.find(
            (p) =>
              this.settings.portVendorId != null &&
              this.settings.portProductId != null &&
              p.vendorId === this.settings.portVendorId &&
              p.productId === this.settings.portProductId
          )?.port ||
          ports[0]?.port ||
          null;
      }

      if (!port) {
        this.setState({ kind: 'disconnected' });
        throw new Error('No serial port selected. Click Connect to choose a COM / USB port.');
      }

      await this.openPort(port);
      const label = portLabel(port, this.settings.comPort);
      this.settings = await saveCustomerDisplaySettings({
        comPort: label,
        portVendorId: port.getInfo?.().usbVendorId ?? this.settings.portVendorId ?? null,
        portProductId: port.getInfo?.().usbProductId ?? this.settings.portProductId ?? null,
        lastConnected: new Date(),
        enabled: true,
      });
      this.setState({ kind: 'connected', portLabel: label });
      await this.applyBrightness();
      await this.displayWelcome();
    } catch (error) {
      this.logError('connect', error);
      this.setState({
        kind: 'error',
        error: (error as Error)?.message || 'Failed to connect customer display',
      });
      this.scheduleReconnect();
      throw error;
    }
  }

  private async openPort(port: SerialPort): Promise<void> {
    await this.closePortQuietly();
    const parity =
      this.settings.parity === 'even'
        ? 'even'
        : this.settings.parity === 'odd'
          ? 'odd'
          : 'none';

    await port.open({
      baudRate: this.settings.baudRate || 9600,
      dataBits: this.settings.dataBits || 8,
      stopBits: this.settings.stopBits || 1,
      parity,
      flowControl: 'none',
    });

    this.port = port;
    this.writer = port.writable?.getWriter() ?? null;
    port.addEventListener('disconnect', this.handleDisconnect);
  }

  private handleDisconnect = () => {
    this.writer = null;
    this.port = null;
    this.setState({ kind: 'disconnected' });
    this.scheduleReconnect();
  };

  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.clearWelcomeTimer();
    await this.closePortQuietly();
    this.setState(this.settings.enabled ? { kind: 'disconnected' } : { kind: 'disabled' });
  }

  private async closePortQuietly() {
    try {
      this.port?.removeEventListener('disconnect', this.handleDisconnect);
    } catch {
      /* ignore */
    }
    try {
      this.writer?.releaseLock();
    } catch {
      /* ignore */
    }
    this.writer = null;
    try {
      await this.port?.close();
    } catch {
      /* ignore */
    }
    this.port = null;
  }

  async reconnect(): Promise<boolean> {
    if (!this.settings.enabled) {
      this.setState({ kind: 'disabled' });
      return false;
    }
    try {
      await this.connect();
      return this.state.kind === 'connected';
    } catch {
      return false;
    }
  }

  private scheduleReconnect() {
    if (!this.settings.enabled || !this.settings.autoReconnect) return;
    if (!isWebSerialSupported()) return;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      void this.reconnect();
    }, RECONNECT_MS);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearWelcomeTimer() {
    if (this.welcomeTimer) {
      clearTimeout(this.welcomeTimer);
      this.welcomeTimer = null;
    }
  }

  private scheduleWelcome() {
    this.clearWelcomeTimer();
    this.welcomeTimer = setTimeout(() => {
      void this.displayWelcome();
    }, WELCOME_DELAY_MS);
  }

  /** Queue bytes without blocking callers. */
  send(data: string | Uint8Array): Promise<void> {
    this.writeChain = this.writeChain
      .then(async () => {
        if (!this.writer || this.state.kind !== 'connected') return;
        const bytes =
          typeof data === 'string'
            ? new TextEncoder().encode(
                this.settings.encoding === 'utf8'
                  ? data
                  : data.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
              )
            : data;
        await this.writer.write(bytes);
      })
      .catch((error) => {
        this.logError('send', error);
        this.setState({
          kind: 'error',
          error: (error as Error)?.message || 'Customer display write failed',
        });
        this.scheduleReconnect();
      });
    return this.writeChain;
  }

  async clear(): Promise<void> {
    // Form-feed clears most VFD / pole displays; ESC @ resets ESC/POS-style units.
    await this.send(new Uint8Array([0x0c, 0x1b, 0x40]));
  }

  async reset(): Promise<void> {
    await this.clear();
  }

  private async applyBrightness(): Promise<void> {
    // Best-effort brightness for common ESC/POS customer displays (0–4 scale).
    const level = Math.max(0, Math.min(4, Math.round((this.settings.brightness / 100) * 4)));
    await this.send(new Uint8Array([0x1b, 0x58, level]));
  }

  private async writeScreen(line1: string, line2 = ''): Promise<void> {
    this.clearWelcomeTimer();
    const width = Math.max(8, Number(this.settings.lineWidth) || 20);
    await this.clear();
    await this.send(`${padLine(line1, width)}\r\n${padLine(line2, width)}\r\n`);
  }

  async displayMessage(message: string): Promise<void> {
    const parts = String(message || '')
      .split(/\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    await this.writeScreen(parts[0] || '', parts[1] || '');
  }

  async displayWelcome(): Promise<void> {
    const name = (this.settings.shopName || 'MTHUNZI POS').toUpperCase();
    await this.writeScreen('WELCOME TO', name);
  }

  async displayItem(itemName: string, qty: number, unitPrice: number): Promise<void> {
    const symbol = this.currencySymbol;
    await this.writeScreen(
      `${String(itemName || 'Item').slice(0, 14)} x${qty}`,
      `TOTAL ${money(symbol, unitPrice * qty)}`
    );
  }

  async displaySale(args: {
    itemName?: string;
    qty?: number;
    lineTotal?: number;
    total: number;
    removed?: boolean;
  }): Promise<void> {
    const symbol = this.currencySymbol;
    if (args.removed) {
      await this.writeScreen('Item Removed', `TOTAL ${money(symbol, args.total)}`);
      return;
    }
    const name = String(args.itemName || 'Item');
    const qty = Number(args.qty || 1);
    await this.writeScreen(
      `${name.slice(0, 14)} x${qty}`,
      `TOTAL ${money(symbol, args.total)}`
    );
  }

  async displaySubtotal(amount: number): Promise<void> {
    await this.writeScreen('SUBTOTAL', money(this.currencySymbol, amount));
  }

  async displayDiscount(amount: number): Promise<void> {
    await this.writeScreen('DISCOUNT', `-${money(this.currencySymbol, amount)}`);
  }

  async displayTax(amount: number, label = 'VAT'): Promise<void> {
    await this.writeScreen(label.toUpperCase(), money(this.currencySymbol, amount));
  }

  async displayTotal(amount: number): Promise<void> {
    await this.writeScreen('TOTAL', money(this.currencySymbol, amount));
  }

  async displayPayment(total: number, paid: number): Promise<void> {
    const symbol = this.currencySymbol;
    await this.writeScreen(`TOTAL ${money(symbol, total)}`, `PAID ${money(symbol, paid)}`);
  }

  async displayChange(amount: number): Promise<void> {
    await this.writeScreen(`CHANGE ${money(this.currencySymbol, amount)}`, 'THANK YOU');
    this.scheduleWelcome();
  }

  async displayCompleted(total?: number): Promise<void> {
    if (total != null) {
      await this.writeScreen('THANK YOU', money(this.currencySymbol, total));
    } else {
      await this.writeScreen('THANK YOU', 'COME AGAIN');
    }
    this.scheduleWelcome();
  }

  async displayCancelled(): Promise<void> {
    await this.writeScreen('SALE', 'CANCELLED');
    this.scheduleWelcome();
  }

  async displayError(message = 'DISPLAY ERROR'): Promise<void> {
    await this.writeScreen('ERROR', message);
  }

  async test(): Promise<void> {
    const name = (this.settings.shopName || 'MTHUNZI POS').toUpperCase();
    const custom = (this.settings.testMessage || 'Customer Display\nWorking Successfully').split(
      /\r?\n/
    );
    await this.writeScreen(name, custom[0] || 'Customer Display');
    if (custom[1]) {
      await new Promise((r) => setTimeout(r, 900));
      await this.writeScreen(custom[0] || 'Customer Display', custom[1]);
    }
  }
}

export const customerDisplayService = new CustomerDisplayService();
