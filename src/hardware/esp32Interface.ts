/**
 * ESP32 Hardware Interface via WebSerial API
 * 
 * Communicates with an ESP32 device over serial to perform:
 * - Nonce challenge/response for identity verification
 * - Daily public key retrieval
 * - Identity key rotation commands
 * 
 * Protocol: JSON lines over serial at 115200 baud
 * 
 * When no physical ESP32 is available, the system falls back to
 * a software-emulated identity (see identityManager.ts).
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface ESP32Response {
  type: string;
  payload: Record<string, string>;
}

export interface ChallengeResult {
  publicKey: string;   // hex-encoded Ed25519 public key
  signature: string;   // hex-encoded signature over nonce
  nonce: string;       // the original nonce echoed back
}

export interface ESP32Connection {
  port: SerialPort;
  reader: ReadableStreamDefaultReader<string>;
  writer: WritableStreamDefaultWriter<string>;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Convert Uint8Array to hex string */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Convert hex string to Uint8Array */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/** Generate cryptographic random nonce (32 bytes, hex-encoded) */
export async function generateNonce(): Promise<string> {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

// ── Serial Helpers ─────────────────────────────────────────────────────

/** Read a full JSON line from the serial reader */
async function readLine(
  reader: ReadableStreamDefaultReader<string>,
  timeoutMs = 5000
): Promise<string> {
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) throw new Error("Serial stream closed");
    buffer += value;
    const nlIndex = buffer.indexOf("\n");
    if (nlIndex !== -1) {
      return buffer.substring(0, nlIndex).trim();
    }
  }
  throw new Error("Serial read timeout");
}

/** Send a JSON command to ESP32 */
async function sendCommand(
  writer: WritableStreamDefaultWriter<string>,
  cmd: Record<string, unknown>
): Promise<void> {
  const line = JSON.stringify(cmd) + "\n";
  await writer.write(line);
}

// ── Core Interface ─────────────────────────────────────────────────────

/**
 * Request WebSerial access and open a connection to the ESP32.
 * Must be called from a user gesture (button click).
 */
export async function connectESP32(): Promise<ESP32Connection> {
  if (!("serial" in navigator)) {
    throw new Error("WebSerial API not supported in this browser");
  }

  const port = await (navigator as any).serial.requestPort();
  await port.open({ baudRate: 115200 });

  const textDecoder = new TextDecoderStream();
  const textEncoder = new TextEncoderStream();

  port.readable.pipeTo(textDecoder.writable);
  textEncoder.readable.pipeTo(port.writable);

  const reader = textDecoder.readable.getReader();
  const writer = textEncoder.writable.getWriter();

  return { port, reader, writer };
}

/**
 * Perform nonce challenge with the ESP32.
 * 
 * Flow:
 * 1. Browser generates random 32-byte nonce
 * 2. Send CHALLENGE command with nonce to ESP32
 * 3. ESP32 signs nonce with SK_daily
 * 4. ESP32 returns PK_daily + signature
 * 5. Browser receives and returns result for verification
 */
export async function performNonceChallenge(
  conn: ESP32Connection
): Promise<ChallengeResult> {
  const nonce = await generateNonce();

  await sendCommand(conn.writer, {
    cmd: "CHALLENGE",
    nonce,
  });

  const response = await readLine(conn.reader, 10000);
  const parsed: ESP32Response = JSON.parse(response);

  if (parsed.type !== "CHALLENGE_RESPONSE") {
    throw new Error(`Unexpected response type: ${parsed.type}`);
  }

  return {
    publicKey: parsed.payload.publicKey,
    signature: parsed.payload.signature,
    nonce,
  };
}

/**
 * Request the current daily public key from ESP32.
 */
export async function getDailyPublicKey(
  conn: ESP32Connection
): Promise<string> {
  await sendCommand(conn.writer, { cmd: "GET_DAILY_PK" });
  const response = await readLine(conn.reader);
  const parsed: ESP32Response = JSON.parse(response);

  if (parsed.type !== "DAILY_PK") {
    throw new Error(`Unexpected response: ${parsed.type}`);
  }
  return parsed.payload.publicKey;
}

/**
 * Get the contact index stored on the ESP32.
 * Returns an array of known peer public key hashes.
 */
export async function getContactIndex(
  conn: ESP32Connection
): Promise<string[]> {
  await sendCommand(conn.writer, { cmd: "GET_CONTACTS" });
  const response = await readLine(conn.reader);
  const parsed: ESP32Response = JSON.parse(response);

  if (parsed.type !== "CONTACT_INDEX") {
    throw new Error(`Unexpected response: ${parsed.type}`);
  }
  return JSON.parse(parsed.payload.contacts);
}

/**
 * Command ESP32 to rotate its daily identity key.
 * Returns the new public key.
 */
export async function rotateIdentityKey(
  conn: ESP32Connection
): Promise<string> {
  await sendCommand(conn.writer, { cmd: "ROTATE_KEY" });
  const response = await readLine(conn.reader, 15000);
  const parsed: ESP32Response = JSON.parse(response);

  if (parsed.type !== "KEY_ROTATED") {
    throw new Error(`Unexpected response: ${parsed.type}`);
  }
  return parsed.payload.newPublicKey;
}

/**
 * Disconnect from the ESP32.
 */
export async function disconnectESP32(
  conn: ESP32Connection
): Promise<void> {
  conn.reader.releaseLock();
  conn.writer.releaseLock();
  await conn.port.close();
}
