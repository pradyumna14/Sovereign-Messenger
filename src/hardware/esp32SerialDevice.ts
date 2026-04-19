/**
 * Real ESP32 Serial Device
 * 
 * Implements IHardwareDevice for a physical ESP32 connected via WebSerial.
 * Uses a text-based protocol (NOT JSON) for communication.
 * 
 * Text Protocol:
 * 
 *   Device sends on connect:
 *     USERNAME:alice\n
 *     PUBLIC_KEY:abcdef...\n
 *     FIRMWARE:1.0.0\n       (optional)
 *     READY\n
 * 
 *   Browser sends nonce challenge:
 *     NONCE:abcdef...\n
 *   Device responds:
 *     SIGNATURE:abcdef...\n
 * 
 *   Browser sends sign request:
 *     SIGN:abcdef...\n
 *   Device responds:
 *     SIGNED:abcdef...\n
 * 
 * Baud rate: 115200
 */

import type {
  IHardwareDevice,
  DeviceInfo,
  DeviceMode,
  NonceChallenge,
  SerialLogEntry,
} from "./deviceInterface";
import {
  SerialLineAccumulator,
  parseSerialLine,
  parseHandshake,
  type ParsedSerialMessage,
} from "./serialParser";
import { bytesToHex, generateNonce } from "./esp32Interface";

// ── RealESP32Device ────────────────────────────────────────────────────

export class RealESP32Device implements IHardwareDevice {
  readonly mode: DeviceMode = "hardware";

  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private writer: WritableStreamDefaultWriter<string> | null = null;
  private accumulator = new SerialLineAccumulator();
  private serialLog: SerialLogEntry[] = [];

  private _connected = false;
  private _username = "";
  private _publicKey = "";
  private _firmwareVersion?: string;

  // Pending line resolution: when we're waiting for a specific response
  private pendingResolve: ((line: ParsedSerialMessage) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null;

  // Background reader task
  private readLoopActive = false;
  private lineQueue: ParsedSerialMessage[] = [];

  get connected(): boolean {
    return this._connected;
  }

  // ── Connect ──────────────────────────────────────────────────────────

  async connect(): Promise<DeviceInfo> {
    if (this._connected) {
      return this.getDeviceInfo();
    }

    if (!("serial" in navigator)) {
      throw new Error("WebSerial API not supported in this browser");
    }

    try {
      // Request port from user gesture
      this.port = await (navigator as any).serial.requestPort();
      await this.port!.open({ baudRate: 115200 });

      // Set up text streams with proper error handling
      const textDecoder = new TextDecoderStream();
      const textEncoder = new TextEncoderStream();

      // These pipes handle the serial I/O streams
      const decoderPipe = this.port!.readable.pipeTo(textDecoder.writable);
      const encoderPipe = textEncoder.readable.pipeTo(this.port!.writable);

      // Handle pipe errors
      decoderPipe.catch((err) => {
        console.error("[ESP32] Decoder pipe error:", err);
        this.readLoopActive = false;
        this.rejectPending(`Stream error: ${err}`);
      });

      encoderPipe.catch((err) => {
        console.error("[ESP32] Encoder pipe error:", err);
      });

      this.reader = textDecoder.readable.getReader();
      this.writer = textEncoder.writable.getWriter();
      this.accumulator.reset();
      this.serialLog = [];

      // Log connection start
      this.addLog("rx", "[Connected to serial port]");

      // Start background read loop
      this.readLoopActive = true;
      // Don't await — let it run in background, but start it immediately
      const readLoopPromise = this.startReadLoop();

      // Wait for the device handshake (USERNAME, PUBLIC_KEY, READY)
      // This will timeout if device doesn't send expected messages
      const handshake = await this.waitForHandshake(10000);

      this._username = handshake.username;
      this._publicKey = handshake.publicKey;
      this._firmwareVersion = handshake.firmwareVersion;
      this._connected = true;

      this.addLog("rx", `[Handshake OK] ${this._username} / ${this._publicKey.slice(0, 16)}...`);

      return this.getDeviceInfo();
    } catch (err) {
      // Clean up on error
      this.readLoopActive = false;
      await this.disconnect();
      throw err;
    }
  }

  // ── Disconnect ───────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    this.readLoopActive = false;
    this.rejectPending("Device disconnected");

    try {
      if (this.reader) {
        this.reader.releaseLock();
        this.reader = null;
      }
      if (this.writer) {
        this.writer.releaseLock();
        this.writer = null;
      }
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
    } catch (err) {
      console.warn("[ESP32] Disconnect error:", err);
    }

    this._connected = false;
    this._username = "";
    this._publicKey = "";
    this.accumulator.reset();
  }

  // ── Device Info ──────────────────────────────────────────────────────

  getDeviceInfo(): DeviceInfo {
    this.assertConnected();
    return {
      username: this._username,
      publicKey: this._publicKey,
      connected: this._connected,
      mode: this.mode,
      firmwareVersion: this._firmwareVersion,
    };
  }

  getPublicKey(): string {
    this.assertConnected();
    return this._publicKey;
  }

  getUsername(): string {
    this.assertConnected();
    return this._username;
  }

  // ── Nonce Challenge ──────────────────────────────────────────────────

  async performNonceChallenge(): Promise<NonceChallenge> {
    this.assertConnected();

    const nonce = await generateNonce();
    await this.sendLine(`NONCE:${nonce}`);

    const response = await this.waitForResponse("SIGNATURE", 10000);
    const signature = response.value.trim();
    
    // Log the signature length for debugging
    this.addLog("rx", `[Response] Type: SIGNATURE, Length: ${signature.length} chars (${(signature.length/2).toFixed(0)} bytes)`);

    return {
      nonce,
      publicKey: this._publicKey,
      signature,
      timestamp: Date.now(),
    };
  }

  // ── Sign Data ────────────────────────────────────────────────────────

  async signData(data: Uint8Array): Promise<string> {
    this.assertConnected();

    const hex = bytesToHex(data);
    await this.sendLine(`SIGN:${hex}`);

    const response = await this.waitForResponse("SIGNED", 10000);
    return response.value;
  }

  // ── Serial Log ───────────────────────────────────────────────────────

  getSerialLog(): SerialLogEntry[] {
    return [...this.serialLog];
  }

  clearSerialLog(): void {
    this.serialLog = [];
  }

  // ── Private Key (not available for hardware) ─────────────────────────

  getPrivateKey(): CryptoKey | null {
    return null; // Hardware devices sign on-device
  }

  // ── Internal Helpers ─────────────────────────────────────────────────

  private assertConnected(): void {
    if (!this._connected) {
      throw new Error("ESP32 device not connected");
    }
  }

  private addLog(direction: "tx" | "rx", data: string): void {
    this.serialLog.push({ timestamp: Date.now(), direction, data });
    // Cap log at 500 entries
    if (this.serialLog.length > 500) {
      this.serialLog = this.serialLog.slice(-400);
    }
  }

  private async sendLine(line: string): Promise<void> {
    if (!this.writer) throw new Error("Serial writer not available");
    this.addLog("tx", line);
    await this.writer.write(line + "\n");
  }

  /**
   * Background read loop: continuously reads from serial and either
   * resolves pending promises or queues parsed messages.
   * 
   * This runs asynchronously and handles incoming serial data.
   */
  private async startReadLoop(): Promise<void> {
    try {
      while (this.readLoopActive && this.reader) {
        try {
          const { value, done } = await this.reader.read();
          if (done) {
            this.addLog("rx", "[Serial stream ended]");
            this.readLoopActive = false;
            break;
          }
          
          if (value) {
            // Feed raw data to accumulator, which emits complete lines
            const lines = this.accumulator.feed(value);
            
            for (const rawLine of lines) {
              this.addLog("rx", rawLine);
              const parsed = parseSerialLine(rawLine);

              if (parsed.type === "ERROR") {
                console.error("[ESP32] Device error:", parsed.value);
              }

              // If someone is waiting for a response, resolve them
              if (this.pendingResolve) {
                const resolve = this.pendingResolve;
                this.pendingResolve = null;
                this.pendingReject = null;
                if (this.pendingTimeout) {
                  clearTimeout(this.pendingTimeout);
                  this.pendingTimeout = null;
                }
                resolve(parsed);
              } else {
                // Queue it for later consumption
                this.lineQueue.push(parsed);
              }
            }
          }
        } catch (err) {
          // Read error — log but try to continue
          if (this.readLoopActive) {
            console.error("[ESP32] Read error:", err);
            // Don't exit loop immediately — wait a bit and retry
            await new Promise((r) => setTimeout(r, 100));
          }
        }
      }
    } catch (err) {
      console.error("[ESP32] Fatal read loop error:", err);
      this.readLoopActive = false;
      this.rejectPending(`Read loop error: ${err}`);
    }
  }

  /**
   * Wait for a specific response type from the device.
   */
  private waitForResponse(
    expectedType: string,
    timeoutMs: number
  ): Promise<ParsedSerialMessage> {
    // Check queue first
    const queueIdx = this.lineQueue.findIndex(
      (m) => m.type === expectedType || m.type === "ERROR"
    );
    if (queueIdx !== -1) {
      const msg = this.lineQueue.splice(queueIdx, 1)[0];
      if (msg.type === "ERROR") {
        return Promise.reject(new Error(`Device error: ${msg.value}`));
      }
      return Promise.resolve(msg);
    }

    return new Promise<ParsedSerialMessage>((resolve, reject) => {
      this.pendingResolve = (msg: ParsedSerialMessage) => {
        if (msg.type === "ERROR") {
          reject(new Error(`Device error: ${msg.value}`));
        } else if (msg.type === expectedType) {
          resolve(msg);
        } else {
          // Unexpected type — queue it and keep waiting
          this.lineQueue.push(msg);
          this.pendingResolve = resolve as any;
          this.pendingReject = reject;
        }
      };
      this.pendingReject = reject;
      this.pendingTimeout = setTimeout(() => {
        this.pendingResolve = null;
        this.pendingReject = null;
        this.pendingTimeout = null;
        reject(new Error(`Timeout waiting for ${expectedType} (${timeoutMs}ms)`));
      }, timeoutMs);
    });
  }

  /**
   * Wait for the device handshake sequence.
   * Works with both the original ESP firmware (no READY) and the
   * enhanced version (with READY). Tolerates boot messages like
   * "ESP8266 AUTH MODULE", "Loaded existing device seed", etc.
   * 
   * Strategy:
   * 1. First wait up to `timeoutMs` collecting lines
   * 2. Try to parse USERNAME + PUBLIC_KEY (+ optional READY/FIRMWARE)
   * 3. If we get USERNAME + PUBLIC_KEY but no READY, wait 2 more seconds
   *    in case READY arrives late, then accept without READY
   */
  private async waitForHandshake(timeoutMs: number): Promise<{
    username: string;
    publicKey: string;
    firmwareVersion?: string;
  }> {
    const deadline = Date.now() + timeoutMs;
    const handshakeLines: ParsedSerialMessage[] = [];

    // First drain anything already in the queue
    while (this.lineQueue.length > 0) {
      handshakeLines.push(this.lineQueue.shift()!);
      // Try with READY first (enhanced firmware)
      const result = parseHandshake(handshakeLines, true);
      if (result) {
        this.addLog("rx", "[Handshake OK]");
        return result;
      }
    }

    // Then wait for new lines
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      // Wait for any line type
      try {
        const msg = await new Promise<ParsedSerialMessage | null>((resolve) => {
          // Check queue first
          if (this.lineQueue.length > 0) {
            resolve(this.lineQueue.shift()!);
            return;
          }
          // Set up pending resolve with longer timeout to wait for actual device response
          const timeout = setTimeout(() => {
            this.pendingResolve = null;
            resolve(null);
          }, Math.min(remaining, 1500)); // Increased timeout to allow device response

          this.pendingResolve = (m: ParsedSerialMessage) => {
            clearTimeout(timeout);
            resolve(m);
          };
        });

        if (msg) {
          handshakeLines.push(msg);

          // Try with READY required first (enhanced firmware sends READY)
          const resultWithReady = parseHandshake(handshakeLines, true);
          if (resultWithReady) {
            this.addLog("rx", "[Handshake OK with READY]");
            return resultWithReady;
          }

          // Try without READY (original firmware)
          const resultNoReady = parseHandshake(handshakeLines, false);
          if (resultNoReady) {
            // We have USERNAME + PUBLIC_KEY but no READY.
            // Wait 2 more seconds in case READY arrives.
            this.addLog("rx", "[Got USERNAME+PUBLIC_KEY, waiting for READY...]");
            const readyDeadline = Date.now() + 2000;
            while (Date.now() < readyDeadline) {
              // Drain queue
              while (this.lineQueue.length > 0) {
                const extra = this.lineQueue.shift()!;
                handshakeLines.push(extra);
                const final = parseHandshake(handshakeLines, true);
                if (final) {
                  this.addLog("rx", "[Handshake OK, got READY]");
                  return final;
                }
              }
              await new Promise((r) => setTimeout(r, 100));
            }
            // Accept without READY
            this.addLog("rx", "[Handshake OK without READY]");
            return resultNoReady;
          }
        }
      } catch (err) {
        // Continue waiting
        console.error("[ESP32] Error during handshake:", err);
      }

      // Also drain any queued messages
      while (this.lineQueue.length > 0) {
        handshakeLines.push(this.lineQueue.shift()!);
        const result = parseHandshake(handshakeLines, true);
        if (result) {
          this.addLog("rx", "[Handshake OK from queue]");
          return result;
        }
      }
    }

    // Last attempt without READY requirement
    const lastAttempt = parseHandshake(handshakeLines, false);
    if (lastAttempt) {
      this.addLog("rx", "[Handshake OK on final attempt]");
      return lastAttempt;
    }

    // Timeout — provide detailed diagnostic info
    const receivedTypes = handshakeLines
      .map((l) => `${l.type}:${l.value.slice(0, 20)}`)
      .join(", ");
    
    const diagnostic =
      handshakeLines.length === 0
        ? "❌ NO DATA RECEIVED. Check: (1) Device is powered on, (2) USB cable is connected, (3) Correct COM port selected, (4) USB driver installed (CH340/CP2102), (5) Firmware uploaded to ESP32"
        : `Received ${handshakeLines.length} unexpected message(s): [${receivedTypes}]. Device may not be running the Sovereign Messenger firmware.`;

    const errorMsg = `Handshake timeout: device did not send USERNAME + PUBLIC_KEY.\n${diagnostic}`;
    this.addLog("rx", `[HANDSHAKE FAILED] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  private rejectPending(reason: string): void {
    if (this.pendingReject) {
      this.pendingReject(new Error(reason));
      this.pendingResolve = null;
      this.pendingReject = null;
    }
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
  }
}
