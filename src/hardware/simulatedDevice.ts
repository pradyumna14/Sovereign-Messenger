/**
 * Simulated ESP32 Device
 * 
 * Implements IHardwareDevice using software-generated identity.
 * Wraps the existing identityManager module to provide the same
 * interface as RealESP32Device, enabling seamless switching between
 * hardware and simulated modes.
 * 
 * The simulator generates deterministic daily keys just like
 * a real ESP32 would, so the rest of the protocol stack is
 * exercised identically.
 */

import type {
  IHardwareDevice,
  DeviceInfo,
  DeviceMode,
  NonceChallenge,
  SerialLogEntry,
} from "./deviceInterface";
import {
  createSoftwareIdentity,
  signData as identitySignData,
  exportPublicKeyHex,
  type Identity,
} from "./identityManager";
import { bytesToHex, generateNonce } from "./esp32Interface";
import { toBuffer } from "../protocol/bufferCompat";

// ── Simulated Device Names ─────────────────────────────────────────────

const SIMULATED_NAMES = [
  "alice", "bob", "charlie", "diana",
  "echo", "foxtrot", "golf", "hotel",
];

let nameCounter = 0;

function nextSimulatedName(): string {
  const base = SIMULATED_NAMES[nameCounter % SIMULATED_NAMES.length];
  nameCounter++;
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}

// ── SimulatedESP32Device ───────────────────────────────────────────────

export class SimulatedESP32Device implements IHardwareDevice {
  readonly mode: DeviceMode = "simulated";

  private identity: Identity | null = null;
  private _connected = false;
  private _username = "";
  private serialLog: SerialLogEntry[] = [];

  /** Allow specifying a username for multi-user testing */
  constructor(private preferredName?: string) {}

  get connected(): boolean {
    return this._connected;
  }

  // ── Connect ──────────────────────────────────────────────────────────

  async connect(): Promise<DeviceInfo> {
    if (this._connected && this.identity) {
      return this.getDeviceInfo();
    }

    this._username = this.preferredName || nextSimulatedName();

    // Simulate handshake log
    this.addLog("rx", `USERNAME:${this._username}`);

    const identity = await createSoftwareIdentity();
    this.identity = identity;

    this.addLog("rx", `PUBLIC_KEY:${identity.publicKey}`);
    this.addLog("rx", `FIRMWARE:SIM-1.0.0`);
    this.addLog("rx", "READY");

    this._connected = true;

    return this.getDeviceInfo();
  }

  // ── Disconnect ───────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    this.identity = null;
    this._connected = false;
    this._username = "";
    this.addLog("tx", "[Disconnected]");
  }

  // ── Device Info ──────────────────────────────────────────────────────

  getDeviceInfo(): DeviceInfo {
    this.assertConnected();
    return {
      username: this._username,
      publicKey: this.identity!.publicKey,
      connected: this._connected,
      mode: this.mode,
      firmwareVersion: "SIM-1.0.0",
    };
  }

  getPublicKey(): string {
    this.assertConnected();
    return this.identity!.publicKey;
  }

  getUsername(): string {
    this.assertConnected();
    return this._username;
  }

  // ── Nonce Challenge ──────────────────────────────────────────────────

  async performNonceChallenge(): Promise<NonceChallenge> {
    this.assertConnected();

    const nonce = await generateNonce();
    this.addLog("tx", `NONCE:${nonce}`);

    // Simulate device signing the nonce
    const nonceBytes = hexToBytes(nonce);
    const algo = this.identity!.privateKey.algorithm.name === "Ed25519"
      ? { name: "Ed25519" }
      : { name: "ECDSA", hash: "SHA-256" };
    const sigBuf = await crypto.subtle.sign(
      algo as any,
      this.identity!.privateKey,
      toBuffer(nonceBytes)
    );
    const signature = bytesToHex(new Uint8Array(sigBuf));

    this.addLog("rx", `SIGNATURE:${signature}`);

    return {
      nonce,
      publicKey: this.identity!.publicKey,
      signature,
      timestamp: Date.now(),
    };
  }

  // ── Sign Data ────────────────────────────────────────────────────────

  async signData(data: Uint8Array): Promise<string> {
    this.assertConnected();

    const hex = bytesToHex(data);
    this.addLog("tx", `SIGN:${hex.slice(0, 32)}...`);

    const signature = await identitySignData(this.identity!, data);

    this.addLog("rx", `SIGNED:${signature.slice(0, 32)}...`);
    return signature;
  }

  // ── Serial Log ───────────────────────────────────────────────────────

  getSerialLog(): SerialLogEntry[] {
    return [...this.serialLog];
  }

  clearSerialLog(): void {
    this.serialLog = [];
  }

  // ── Private Key ──────────────────────────────────────────────────────

  getPrivateKey(): CryptoKey | null {
    return this.identity?.privateKey || null;
  }

  // ── Identity Access (for compatibility with existing hooks) ──────────

  getIdentity(): Identity | null {
    return this.identity;
  }

  // ── Internal Helpers ─────────────────────────────────────────────────

  private assertConnected(): void {
    if (!this._connected || !this.identity) {
      throw new Error("Simulated device not connected");
    }
  }

  private addLog(direction: "tx" | "rx", data: string): void {
    this.serialLog.push({ timestamp: Date.now(), direction, data });
    if (this.serialLog.length > 500) {
      this.serialLog = this.serialLog.slice(-400);
    }
  }
}

// ── Hex helper (avoid circular import) ─────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
