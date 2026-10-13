import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BluetoothPrinterService } from './bluetoothPrinterService';

describe('BluetoothPrinterService network support', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('requests an Epson USB printer and connects using a valid bulk-out endpoint', async () => {
    const requestDevice = vi.fn().mockResolvedValue({
      productName: 'EPSON TM-T7011',
      open: vi.fn().mockResolvedValue(undefined),
      selectConfiguration: vi.fn().mockResolvedValue(undefined),
      claimInterface: vi.fn().mockResolvedValue(undefined),
      releaseInterface: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      configurations: [
        {
          configurationValue: 1,
          interfaces: [
            {
              interfaceNumber: 0,
              alternates: [
                {
                  endpoints: [
                    { type: 'interrupt', direction: 'in', endpointNumber: 1 },
                    { type: 'bulk', direction: 'out', endpointNumber: 2 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      transferOut: vi.fn().mockResolvedValue(undefined),
    });

    Object.defineProperty(navigator, 'usb', {
      value: { requestDevice, getDevices: vi.fn().mockResolvedValue([]) },
      configurable: true,
    });

    const service = new BluetoothPrinterService();
    const connected = await service.discoverAndConnectUsb();

    expect(connected).toBe(true);
    expect(requestDevice).toHaveBeenCalledWith({
      filters: [{ vendorId: 0x04b8 }],
    });
    expect(service.getState()).toMatchObject({
      kind: 'connected',
      transport: 'usb',
      deviceName: 'EPSON TM-T7011',
    });

    await service.printBytes(new Uint8Array([0x1b, 0x40]));
    expect((service as any).usbDevice.transferOut).toHaveBeenCalledWith(2, expect.any(Uint8Array));
  });

  it('connects to a Wi‑Fi/LAN printer using a host and port', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
      text: async () => '',
    } as Response);

    const service = new BluetoothPrinterService();
    const connected = await service.connectNetworkPrinter('192.168.1.45', 9100);

    expect(connected).toBe(true);
    expect(service.getState()).toMatchObject({
      kind: 'connected',
      transport: 'network',
      deviceName: '192.168.1.45:9100',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/printer/connect',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });

  it('sends a print job to a configured Wi‑Fi/LAN printer even without Bluetooth or serial APIs', async () => {
    localStorage.setItem('bluetoothPrinter:networkHost', '192.168.1.45');
    localStorage.setItem('bluetoothPrinter:networkPort', '9100');

    Object.defineProperty(navigator, 'bluetooth', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'serial', { value: undefined, configurable: true });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
      text: async () => '',
    } as Response);

    const service = new BluetoothPrinterService();
    await service.printBytes(new Uint8Array([0x1b, 0x40, 0x0a]));

    expect(service.getState()).toMatchObject({
      kind: 'connected',
      transport: 'network',
      deviceName: '192.168.1.45:9100',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/printer/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });
});
