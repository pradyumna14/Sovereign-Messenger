/**
 * Hardware Device Abstraction Interface
 * 
 * Defines a unified interface for both real ESP32 hardware devices
 * (via WebSerial) and software-simulated devices. This allows the
 * rest of the application to be agnostic about the identity source.
 * 
 * Protocol modes:
 *   - "hardware" → Real ESP32 via WebSerial (text-based protocol)
 *   - "simulated" → Software-emulated identity using Web Crypto
 */

// ── Device Types ───────────────────────────────────────────────────────

export type DeviceMode = "hardware" | "simulated" | "none";

export interface DeviceInfo {
  /** Unique label for the device (e.g., "alice", "bob") */
  username: string;
  /** Hex-encoded daily public key */
  publicKey: string;
  /** Whether the device is currently connected */
  connected: boolean;
  /** Device mode */
  mode: DeviceMode;
  /** Optional firmware version for real hardware */
  firmwareVersion?: string;
}

export interface NonceChallenge {
  /** Hex-encoded nonce that was sent to the device */
  nonce: string;
  /** Hex-encoded public key returned by the device */
  publicKey: string;
  /** Hex-encoded signature of the nonce */
  signature: string;
  /** Timestamp of when the challenge was performed */
  timestamp: number;
}

export interface SerialLogEntry {
  /** Timestamp of the log entry */
  timestamp: number;
  /** Direction: "tx" for sent, "rx" for received */
  direction: "tx" | "rx";
  /** Raw text of the serial line */
  data: string;
}

// ── Device Interface ───────────────────────────────────────────────────

/**
 * IHardwareDevice
 * 
 * Unified interface for identity-providing devices.
 * Both RealESP32Device and SimulatedESP32Device implement this.
 */
export interface IHardwareDevice {
  /** The mode this device operates in */
  readonly mode: DeviceMode;

  /** Whether the device is currently connected */
  readonly connected: boolean;

  /**
   * Connect to the device.
   * For hardware: opens WebSerial port and reads initial handshake
   * For simulated: generates a software identity
   */
  connect(): Promise<DeviceInfo>;

  /**
   * Disconnect from the device.
   * For hardware: closes serial port
   * For simulated: clears identity state
   */
  disconnect(): Promise<void>;

  /**
   * Get the current device info (username + public key).
   * Throws if not connected.
   */
  getDeviceInfo(): DeviceInfo;

  /**
   * Get the current daily public key as hex string.
   * Throws if not connected.
   */
  getPublicKey(): string;

  /**
   * Get the device username / label.
   * Throws if not connected.
   */
  getUsername(): string;

  /**
   * Perform a nonce challenge to verify device identity.
   * 
   * Flow:
   * 1. Generate random 32-byte nonce
   * 2. Send nonce to device
   * 3. Device signs nonce with SK_daily
   * 4. Return challenge result for verification
   */
  performNonceChallenge(): Promise<NonceChallenge>;

  /**
   * Sign arbitrary data with the device's daily private key.
   * Used for PICP packet signatures.
   * 
   * @param data - Raw bytes to sign
   * @returns Hex-encoded signature
   */
  signData(data: Uint8Array): Promise<string>;

  /**
   * Get the serial log for debugging.
   * Hardware devices return actual serial I/O logs.
   * Simulated devices return synthetic log entries.
   */
  getSerialLog(): SerialLogEntry[];

  /**
   * Clear the serial log.
   */
  clearSerialLog(): void;

  /**
   * Get the CryptoKey private key for signing operations.
   * For simulated: returns the Web Crypto key directly.
   * For hardware: returns null (signing is done on-device).
   */
  getPrivateKey(): CryptoKey | null;
}
