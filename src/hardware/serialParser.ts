/**
 * Serial Text Protocol Parser
 * 
 * Parses the text-based protocol used by ESP32 firmware.
 * 
 * Protocol format (text lines, newline-delimited):
 * 
 * Device → Browser (on startup / connect):
 *   USERNAME:alice
 *   PUBLIC_KEY:abcdef0123456789...
 *   FIRMWARE:1.0.0                    (optional)
 *   READY
 * 
 * Browser → Device:
 *   NONCE:abcdef0123456789...
 *   SIGN:abcdef0123456789...
 *   PING
 * 
 * Device → Browser (responses):
 *   SIGNATURE:abcdef0123456789...
 *   SIGNED:abcdef0123456789...
 *   PONG
 *   ERROR:description
 */

// ── Types ──────────────────────────────────────────────────────────────

export type SerialMessageType =
  | "USERNAME"
  | "PUBLIC_KEY"
  | "FIRMWARE"
  | "READY"
  | "NONCE"
  | "SIGN"
  | "PING"
  | "SIGNATURE"
  | "SIGNED"
  | "PONG"
  | "ERROR"
  | "INFO"
  | "PROMPT"
  | "BOOT"
  | "UNKNOWN";

export interface ParsedSerialMessage {
  type: SerialMessageType;
  value: string;
  raw: string;
}

export interface DeviceHandshake {
  username: string;
  publicKey: string;
  firmwareVersion?: string;
}

// ── Parser ─────────────────────────────────────────────────────────────

/**
 * Parse a single line of the serial text protocol.
 * Lines are formatted as "TYPE:value" or just "TYPE" for no-value commands.
 */
export function parseSerialLine(line: string): ParsedSerialMessage {
  const trimmed = line.trim();
  if (!trimmed) {
    return { type: "UNKNOWN", value: "", raw: line };
  }

  // Handle ESP boot banner lines (no colon)
  const upperTrimmed = trimmed.toUpperCase();
  if (
    upperTrimmed === "ESP8266 AUTH MODULE" ||
    upperTrimmed === "ESP_AUTH_MODULE" ||
    upperTrimmed.startsWith("ESP")
  ) {
    return { type: "BOOT", value: trimmed, raw: line };
  }

  const colonIndex = trimmed.indexOf(":");
  if (colonIndex === -1) {
    // No-value commands: READY, PING, PONG
    const cmd = upperTrimmed;
    if (cmd === "READY" || cmd === "PING" || cmd === "PONG") {
      return { type: cmd as SerialMessageType, value: "", raw: line };
    }
    // Boot messages like "Generating new device seed", "Loaded existing device seed"
    if (
      cmd.includes("SEED") ||
      cmd.includes("GENERATING") ||
      cmd.includes("LOADED") ||
      cmd.includes("ENTER USERNAME") ||
      cmd.includes("BOOTING") ||
      cmd.includes("STARTING")
    ) {
      return { type: "INFO", value: trimmed, raw: line };
    }
    return { type: "UNKNOWN", value: trimmed, raw: line };
  }

  const prefix = trimmed.substring(0, colonIndex).toUpperCase().trim();
  let value = trimmed.substring(colonIndex + 1).trim();
  
  // For hex-containing messages (SIGNATURE, SIGNED, PUBLIC_KEY, etc.),
  // clean up any remaining whitespace or control characters
  if (["SIGNATURE", "SIGNED", "PUBLIC_KEY", "NONCE", "SIGN"].includes(prefix)) {
    value = value.replace(/\s+/g, "").toLowerCase();
  }

  const knownTypes: SerialMessageType[] = [
    "USERNAME", "PUBLIC_KEY", "FIRMWARE", "NONCE",
    "SIGN", "SIGNATURE", "SIGNED", "ERROR", "INFO", "PROMPT",
  ];

  if (knownTypes.includes(prefix as SerialMessageType)) {
    return { type: prefix as SerialMessageType, value, raw: line };
  }

  return { type: "UNKNOWN", value: trimmed, raw: line };
}

/**
 * Validate that a hex string is well-formed.
 */
export function isValidHex(hex: string): boolean {
  return /^[0-9a-fA-F]*$/.test(hex) && hex.length % 2 === 0 && hex.length > 0;
}

/**
 * Parse a complete device handshake from accumulated lines.
 * Expects at least USERNAME and PUBLIC_KEY lines, plus READY.
 * Returns null if the handshake is incomplete.
 */
/**
 * Parse a complete device handshake from accumulated lines.
 * Requires USERNAME and PUBLIC_KEY lines.
 * READY is optional — the user's original ESP firmware doesn't send it.
 * If READY is not received, we accept the handshake once we have
 * both USERNAME and PUBLIC_KEY (after a brief settling period).
 */
export function parseHandshake(
  lines: ParsedSerialMessage[],
  requireReady = false
): DeviceHandshake | null {
  let username: string | null = null;
  let publicKey: string | null = null;
  let firmwareVersion: string | undefined;
  let ready = false;

  for (const msg of lines) {
    switch (msg.type) {
      case "USERNAME":
        const rawUsername = msg.value.trim();
        if (rawUsername.length > 0 && rawUsername.length <= 50) {
          username = rawUsername;
        }
        break;

      case "PUBLIC_KEY":
        const rawKey = msg.value.trim();
        // Validate it's valid hex and reasonable length (32-128 bytes = 64-256 hex chars)
        if (isValidHex(rawKey) && rawKey.length >= 64 && rawKey.length <= 256) {
          publicKey = rawKey;
        }
        break;

      case "FIRMWARE":
        firmwareVersion = msg.value.trim();
        break;

      case "READY":
        ready = true;
        break;
    }
  }

  // Must have at least USERNAME and PUBLIC_KEY
  if (!username || !publicKey) {
    return null;
  }

  // If READY is required and not received, wait
  if (requireReady && !ready) {
    return null;
  }

  return { username, publicKey, firmwareVersion };
}

// ── Line Accumulator ───────────────────────────────────────────────────

/**
 * SerialLineAccumulator
 * 
 * Buffers incoming serial data and emits complete newline-delimited lines.
 * Handles partial reads from the serial stream.
 */
export class SerialLineAccumulator {
  private buffer = "";

  /**
   * Feed raw data from the serial stream.
   * Returns an array of complete lines (without newlines).
   */
  feed(data: string): string[] {
    this.buffer += data;
    const lines: string[] = [];
    let nlIndex: number;

    while ((nlIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.substring(0, nlIndex).replace(/\r$/, "");
      this.buffer = this.buffer.substring(nlIndex + 1);
      if (line.length > 0) {
        lines.push(line);
      }
    }

    return lines;
  }

  /** Clear the internal buffer */
  reset(): void {
    this.buffer = "";
  }

  /** Get the current partial buffer contents (for debugging) */
  getPartial(): string {
    return this.buffer;
  }
}
