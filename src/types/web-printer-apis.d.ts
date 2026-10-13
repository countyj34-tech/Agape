/** Minimal browser printer API typings for WebUSB and Web Bluetooth support. */

type BufferSource = Uint8Array | ArrayBuffer | DataView;

declare interface USBEndpoint {
  type: 'bulk' | 'interrupt' | 'isochronous' | 'control';
  direction: 'in' | 'out';
  endpointNumber: number;
}

declare interface USBAlternateInterface {
  endpoints: USBEndpoint[];
}

declare interface USBInterface {
  interfaceNumber: number;
  alternates: USBAlternateInterface[];
}

declare interface USBConfiguration {
  configurationValue: number;
  interfaces: USBInterface[];
}

declare interface USBDevice {
  productName?: string;
  configurations: USBConfiguration[];
  configuration: USBConfiguration | null;
  open(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  close(): Promise<void>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<void>;
}

declare interface USB {
  requestDevice(options?: {
    filters?: Array<{
      vendorId?: number;
      productId?: number;
      classCode?: number;
      subclassCode?: number;
      protocolCode?: number;
    }>;
  }): Promise<USBDevice>;
  getDevices(): Promise<USBDevice[]>;
}

declare interface Navigator {
  serial?: Serial;
  usb?: USB;
  bluetooth?: Bluetooth;
}

type BluetoothServiceUUID = string;
type BluetoothCharacteristicUUID = string;

declare interface BluetoothCharacteristicProperties {
  write?: boolean;
  writeWithoutResponse?: boolean;
}

declare interface BluetoothRemoteGATTCharacteristic {
  uuid: string;
  service?: { uuid: string };
  properties: BluetoothCharacteristicProperties;
  writeValue(value: BufferSource): Promise<void>;
}

declare interface BluetoothRemoteGATTServer {
  connected: boolean;
  getPrimaryService(service: BluetoothServiceUUID): Promise<{
    getCharacteristic(characteristic: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic>;
  }>;
  getPrimaryServices(): Promise<Array<{
    getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
  }>>;
}

declare interface BluetoothDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
  };
}

declare interface Bluetooth {
  getDevices?: () => Promise<BluetoothDevice[]>;
}
