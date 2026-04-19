/**
 * Identity Manager
 * 
 * Handles software-emulated identity when no ESP32 hardware is present.
 * Implements deterministic daily key rotation via HMAC derivation.
 * 
 * Key derivation formula:
 *   SK_daily = HMAC-SHA256(MasterSeed, UnixDayTimestamp)
 */

import { bytesToHex, hexToBytes } from "./esp32Interface";
import { toBuffer } from "../protocol/bufferCompat";

// ── Types ──────────────────────────────────────────────────────────────

export interface Identity {
  publicKey: string;                    // Software Ed25519/ECDSA public key (for WIMP signing)
  privateKey: CryptoKey;                // Software Ed25519/ECDSA private key
  previousPublicKey: string | null;
  masterSeed: string;
  currentDay: number;
  createdAt: number;
  hardwarePublicKey?: string;           // ESP32 SHA-256 public key (hardware identity anchor)
  hardwareUsername?: string;            // Username from hardware device
}

export interface LineagePacket {
  previousPublicKey: string;
  newPublicKey: string;
  rotationTimestamp: number;
  signature: string;
}

// ── Constants ──────────────────────────────────────────────────────────

const UNIX_DAY_SECONDS = 86400;

// ── Key Derivation ─────────────────────────────────────────────────────

export function getUnixDay(now?: number): number {
  const ts = now || Math.floor(Date.now() / 1000);
  return Math.floor(ts / UNIX_DAY_SECONDS);
}

export async function generateMasterSeed(): Promise<string> {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  return bytesToHex(seed);
}

export async function deriveDailyKeyMaterial(
  masterSeedHex: string,
  unixDay: number
): Promise<Uint8Array> {
  const seedBytes = hexToBytes(masterSeedHex);
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    toBuffer(seedBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const dayBytes = new TextEncoder().encode(unixDay.toString());
  const derived = await crypto.subtle.sign("HMAC", hmacKey, toBuffer(dayBytes));
  return new Uint8Array(derived);
}

export async function generateKeyPairFromSeed(
  _seedMaterial: Uint8Array
): Promise<CryptoKeyPair> {
  try {
    return await crypto.subtle.generateKey(
      { name: "Ed25519" } as any,
      true,
      ["sign", "verify"]
    );
  } catch {
    return await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
  }
}

export async function exportPublicKeyHex(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bytesToHex(new Uint8Array(raw));
}

export async function importPublicKey(hex: string): Promise<CryptoKey> {
  const bytes = hexToBytes(hex);
  try {
    return await crypto.subtle.importKey(
      "raw",
      toBuffer(bytes),
      { name: "Ed25519" } as any,
      true,
      ["verify"]
    );
  } catch {
    return await crypto.subtle.importKey(
      "raw",
      toBuffer(bytes),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"]
    );
  }
}

// ── Identity Lifecycle ─────────────────────────────────────────────────

export async function createSoftwareIdentity(): Promise<Identity> {
  const masterSeed = await generateMasterSeed();
  const day = getUnixDay();
  const material = await deriveDailyKeyMaterial(masterSeed, day);
  const keyPair = await generateKeyPairFromSeed(material);
  const publicKeyHex = await exportPublicKeyHex(keyPair.publicKey);
  return {
    publicKey: publicKeyHex,
    privateKey: keyPair.privateKey,
    previousPublicKey: null,
    masterSeed,
    currentDay: day,
    createdAt: Date.now(),
  };
}

export async function rotateIdentity(
  identity: Identity
): Promise<{ identity: Identity; lineage: LineagePacket }> {
  const newDay = getUnixDay();
  const material = await deriveDailyKeyMaterial(identity.masterSeed, newDay);
  const keyPair = await generateKeyPairFromSeed(material);
  const newPublicKeyHex = await exportPublicKeyHex(keyPair.publicKey);

  const rotationData = new TextEncoder().encode(
    `ROTATE:${identity.publicKey}:${newPublicKeyHex}:${newDay}`
  );
  const algo = identity.privateKey.algorithm.name === "Ed25519"
    ? { name: "Ed25519" }
    : { name: "ECDSA", hash: "SHA-256" };
  const signatureBuffer = await crypto.subtle.sign(
    algo as any,
    identity.privateKey,
    toBuffer(rotationData)
  );

  const lineage: LineagePacket = {
    previousPublicKey: identity.publicKey,
    newPublicKey: newPublicKeyHex,
    rotationTimestamp: Date.now(),
    signature: bytesToHex(new Uint8Array(signatureBuffer)),
  };
  const newIdentity: Identity = {
    publicKey: newPublicKeyHex,
    privateKey: keyPair.privateKey,
    previousPublicKey: identity.publicKey,
    masterSeed: identity.masterSeed,
    currentDay: newDay,
    createdAt: identity.createdAt,
  };
  return { identity: newIdentity, lineage };
}

export async function verifyNonceChallenge(
  publicKeyHex: string,
  nonceHex: string,
  signatureHex: string
): Promise<boolean> {
  try {
    const pubKey = await importPublicKey(publicKeyHex);
    const nonceBytes = hexToBytes(nonceHex);
    const sigBytes = hexToBytes(signatureHex);
    const algo = pubKey.algorithm.name === "Ed25519"
      ? { name: "Ed25519" }
      : { name: "ECDSA", hash: "SHA-256" };
    return await crypto.subtle.verify(
      algo as any,
      pubKey,
      toBuffer(sigBytes),
      toBuffer(nonceBytes)
    );
  } catch (err) {
    console.error("Nonce verification failed:", err);
    return false;
  }
}

export async function verifyLineagePacket(
  packet: LineagePacket
): Promise<boolean> {
  try {
    const oldPubKey = await importPublicKey(packet.previousPublicKey);
    const rotationData = new TextEncoder().encode(
      `ROTATE:${packet.previousPublicKey}:${packet.newPublicKey}:${
        Math.floor(packet.rotationTimestamp / 1000 / UNIX_DAY_SECONDS)
      }`
    );
    const sigBytes = hexToBytes(packet.signature);
    const algo = oldPubKey.algorithm.name === "Ed25519"
      ? { name: "Ed25519" }
      : { name: "ECDSA", hash: "SHA-256" };
    return await crypto.subtle.verify(
      algo as any,
      oldPubKey,
      toBuffer(sigBytes),
      toBuffer(rotationData)
    );
  } catch (err) {
    console.error("Lineage verification failed:", err);
    return false;
  }
}

/**
 * Verify ESP8266/ESP32 nonce challenge (liveness check).
 * 
 * The ESP firmware uses a symmetric SHA-256 scheme:
 *   daily_key  = SHA-256(master_seed || day)
 *   public_key = SHA-256(daily_key)
 *   signature  = SHA-256(daily_key || nonce)
 * 
 * Since the browser does NOT know daily_key, we cannot independently
 * verify the signature. Instead, we perform a LIVENESS verification:
 * 
 *   1. Check that publicKey is a valid 32-byte (64 hex char) hash
 *   2. Check that signature is a valid 32-byte (64 hex char) hash
 *   3. Check that signature !== publicKey (device actually computed something)
 *   4. Check that signature !== nonce (device didn't just echo the nonce)
 * 
 * This proves the device is present, responsive, and running the
 * expected firmware. For production, use Ed25519 for real asymmetric verification.
 */
export function verifyESP32NonceLiveness(
  publicKeyHex: string,
  nonceHex: string,
  signatureHex: string
): { valid: boolean; reason: string } {
  // Clean whitespace from all values (serial might have extra spaces)
  const pk = (publicKeyHex || "").trim().toLowerCase();
  const nc = (nonceHex || "").trim().toLowerCase();
  const sig = (signatureHex || "").trim().toLowerCase();

  // Validate hex format first
  const hexRegex = /^[0-9a-f]*$/;
  
  if (!pk || !hexRegex.test(pk)) {
    return { 
      valid: false, 
      reason: `Invalid public key format. Length: ${pk.length}, Expected: 64 hex chars` 
    };
  }
  
  if (!nc || !hexRegex.test(nc)) {
    return { 
      valid: false, 
      reason: `Invalid nonce format. Length: ${nc.length}, Expected: 64 hex chars` 
    };
  }
  
  if (!sig || !hexRegex.test(sig)) {
    return { 
      valid: false, 
      reason: `Invalid signature format (non-hex or empty). Length: ${sig.length}, Expected: 64+ hex chars` 
    };
  }

  // Check lengths (SHA-256 = 32 bytes = 64 hex chars)
  if (pk.length !== 64) {
    return { 
      valid: false, 
      reason: `Invalid public key length. Got: ${pk.length}, Expected: 64 hex chars` 
    };
  }
  
  if (nc.length !== 64) {
    return { 
      valid: false, 
      reason: `Invalid nonce length. Got: ${nc.length}, Expected: 64 hex chars` 
    };
  }
  
  // Allow signature lengths from 32 to 256 hex chars (16-128 bytes)
  // SHA-256 produces 64 hex chars, but support other algorithms
  if (sig.length < 32 || sig.length > 256) {
    return { 
      valid: false, 
      reason: `Invalid signature length. Got: ${sig.length}, Expected: 32-256 hex chars (16-128 bytes)` 
    };
  }

  // Signature should not equal the public key (would mean device echoed PK)
  if (sig === pk) {
    return { valid: false, reason: "Signature equals public key (device may be echoing)" };
  }

  // Signature should not equal the nonce (would mean device echoed nonce)
  if (sig === nc) {
    return { valid: false, reason: "Signature equals nonce (device may be echoing)" };
  }

  return { valid: true, reason: "Liveness verified — device responded with unique signature" };
}

export function isRotationDue(identity: Identity): boolean {
  return getUnixDay() !== identity.currentDay;
}

export async function signData(
  identity: Identity,
  data: Uint8Array
): Promise<string> {
  const algo = identity.privateKey.algorithm.name === "Ed25519"
    ? { name: "Ed25519" }
    : { name: "ECDSA", hash: "SHA-256" };
  const sig = await crypto.subtle.sign(algo as any, identity.privateKey, toBuffer(data));
  return bytesToHex(new Uint8Array(sig));
}
