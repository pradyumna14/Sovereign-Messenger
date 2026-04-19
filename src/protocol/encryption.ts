/**
 * Encryption Layer
 * 
 * End-to-end encryption using AES-256-GCM with ephemeral session keys.
 * 
 * Flow:
 * 1. Generate an ephemeral AES-256-GCM key for each message
 * 2. Encrypt plaintext with AES-GCM (produces ciphertext + IV + auth tag)
 * 3. Wrap the ephemeral key with a shared secret derived via ECDH
 * 4. Pack everything into a single base64 payload
 * 
 * For this prototype (where both parties use signing keys, not DH keys),
 * we use a simplified model:
 * - Each message gets a random AES-256-GCM key
 * - The key is encrypted with a password derived from both public keys
 *   (simulating a shared secret)
 * - In production, use X25519 ECDH for proper key agreement
 * 
 * Decryption ONLY occurs in memory – no plaintext touches disk.
 */

import { bytesToHex, hexToBytes } from "../hardware/esp32Interface";
import { toBuffer, aesGcmParams } from "./bufferCompat";

// ── Types ──────────────────────────────────────────────────────────────

export interface EncryptedPayload {
  iv: string;           // hex-encoded 12-byte IV
  ciphertext: string;   // base64-encoded encrypted data
  ephemeralKey: string;  // hex-encoded wrapped ephemeral key
  authTag: string;       // included in ciphertext for GCM mode
}

export interface SessionKeyBundle {
  key: CryptoKey;
  rawKeyHex: string;
}

// ── Key Generation ─────────────────────────────────────────────────────

/**
 * Generate a random AES-256-GCM ephemeral session key.
 */
export async function generateSessionKey(): Promise<SessionKeyBundle> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  const rawKey = await crypto.subtle.exportKey("raw", key);
  return {
    key,
    rawKeyHex: bytesToHex(new Uint8Array(rawKey)),
  };
}

/**
 * Import an AES-256-GCM key from hex-encoded raw bytes.
 */
export async function importSessionKey(hex: string): Promise<CryptoKey> {
  const keyBytes = hexToBytes(hex);
  return crypto.subtle.importKey(
    "raw",
    toBuffer(keyBytes),
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

/**
 * Derive a key-wrapping key from sender and receiver public keys.
 * This simulates a shared secret for key encapsulation.
 * 
 * In production, replace with proper X25519 ECDH key agreement.
 */
export async function deriveSharedWrappingKey(
  senderPkHex: string,
  receiverPkHex: string
): Promise<CryptoKey> {
  // Create deterministic input: sorted concatenation of both keys
  const keys = [senderPkHex, receiverPkHex].sort();
  const sharedInput = new TextEncoder().encode(keys.join(":"));

  // Derive via SHA-256
  const hash = await crypto.subtle.digest("SHA-256", toBuffer(sharedInput));

  return crypto.subtle.importKey(
    "raw",
    hash,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ── Encryption ─────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext message for a specific receiver.
 * 
 * Steps:
 * 1. Generate ephemeral AES-256-GCM session key
 * 2. Encrypt plaintext with session key
 * 3. Wrap session key with shared wrapping key
 * 4. Return base64-encoded payload
 */
export async function encryptMessage(
  plaintext: string,
  senderPkHex: string,
  receiverPkHex: string
): Promise<string> {
  // 1. Generate ephemeral session key
  const sessionBundle = await generateSessionKey();

  // 2. Encrypt plaintext with session key
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    aesGcmParams(iv),
    sessionBundle.key,
    toBuffer(plaintextBytes)
  );

  // 3. Wrap the session key with shared wrapping key
  const wrappingKey = await deriveSharedWrappingKey(senderPkHex, receiverPkHex);
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedKey = await crypto.subtle.encrypt(
    aesGcmParams(wrapIv),
    wrappingKey,
    toBuffer(hexToBytes(sessionBundle.rawKeyHex))
  );

  // 4. Pack everything into a single payload
  const payload: EncryptedPayload = {
    iv: bytesToHex(iv),
    ciphertext: bufferToBase64(ciphertext),
    ephemeralKey: bytesToHex(wrapIv) + ":" + bufferToBase64(wrappedKey),
    authTag: "", // GCM includes auth tag in ciphertext
  };

  return btoa(JSON.stringify(payload));
}

/**
 * Decrypt a message. MUST only be called after signature verification.
 * Decrypted plaintext exists ONLY in memory.
 */
export async function decryptMessage(
  encodedPayload: string,
  senderPkHex: string,
  receiverPkHex: string
): Promise<string> {
  // Parse payload
  const payloadJson = atob(encodedPayload);
  const payload: EncryptedPayload = JSON.parse(payloadJson);

  // 1. Derive shared wrapping key
  const wrappingKey = await deriveSharedWrappingKey(senderPkHex, receiverPkHex);

  // 2. Unwrap the ephemeral session key
  const [wrapIvHex, wrappedKeyB64] = payload.ephemeralKey.split(":");
  const wrapIv = hexToBytes(wrapIvHex);
  const wrappedKeyBytes = base64ToBuffer(wrappedKeyB64);

  const sessionKeyRaw = await crypto.subtle.decrypt(
    aesGcmParams(wrapIv),
    wrappingKey,
    wrappedKeyBytes
  );

  // 3. Import the unwrapped session key
  const sessionKey = await crypto.subtle.importKey(
    "raw",
    sessionKeyRaw,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  // 4. Decrypt the ciphertext
  const iv = hexToBytes(payload.iv);
  const ciphertextBytes = base64ToBuffer(payload.ciphertext);

  const plaintextBuffer = await crypto.subtle.decrypt(
    aesGcmParams(iv),
    sessionKey,
    ciphertextBytes
  );

  return new TextDecoder().decode(plaintextBuffer);
}

// ── Session Key Destruction ────────────────────────────────────────────

/**
 * Securely destroy a session key bundle.
 * Overwrites the raw key bytes in memory.
 */
export function destroySessionKey(bundle: SessionKeyBundle): void {
  // Overwrite the hex string (best effort in JS)
  const len = bundle.rawKeyHex.length;
  (bundle as any).rawKeyHex = "0".repeat(len);
  (bundle as any).key = null;
}

// ── Base64 Helpers ─────────────────────────────────────────────────────

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
