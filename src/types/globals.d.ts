/**
 * Type declarations for Web Serial API and global test functions.
 * Web Serial API is not yet in TypeScript's default lib types.
 */

// ── Web Serial API Types ───────────────────────────────────────────────

interface SerialPort {
  readable: ReadableStream;
  writable: WritableStream;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}

interface SerialPortRequestOptions {
  filters?: Array<{ usbVendorId?: number; usbProductId?: number }>;
}

interface Serial {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
  onconnect: ((this: Serial, ev: Event) => any) | null;
  ondisconnect: ((this: Serial, ev: Event) => any) | null;
}

interface Navigator {
  serial: Serial;
}

// ── Global Test Functions ──────────────────────────────────────────────

interface Window {
  runProtocolTests: () => Promise<any[]>;
  runMQTTSimulation: () => Promise<any[]>;
  runAttackSimulation: () => Promise<void>;
}
