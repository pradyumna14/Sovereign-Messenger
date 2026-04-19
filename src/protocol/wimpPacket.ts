/**
 * WIMP Packet – Wallet Identity Messaging Protocol
 * 
 * Defines the core message packet structure and serialization.
 * Every message in the system is wrapped in a WIMPPacket.
 * 
 * Fields:
 *   protocol        – Protocol version string ("WIMP/1")
 *   sender_pk       – Sender's current daily public key (hex)
 *   receiver_pk     – Receiver's current daily public key (hex)
 *   timestamp       – Unix millisecond timestamp of creation
 *   parent_hash     – SHA-256 hash of the previous message (hex), or "GENESIS"
 *   expiry          – Unix millisecond timestamp when message self-destructs
 *   ciphertext      – AES-GCM encrypted payload (base64)
 *   signature       – Ed25519/ECDSA signature over canonical packet data (hex)
 */

import { bytesToHex } from "../hardware/esp32Interface";
import { toBuffer } from "./bufferCompat";

// ── Types ──────────────────────────────────────────────────────────────

export interface WIMPPacket {
  protocol: string;
  sender_pk: string;
  receiver_pk: string;
  timestamp: number;
  parent_hash: string;
  expiry: number;
  ciphertext: string;
  signature: string;
}

export interface PacketBuildParams {
  senderPublicKey: string;
  receiverPublicKey: string;
  parentHash: string;        // "GENESIS" for first message in chain
  expiryMs: number;          // milliseconds from now until expiry
  ciphertext: string;        // base64-encoded AES-GCM ciphertext
}

// ── Constants ──────────────────────────────────────────────────────────

export const PROTOCOL_VERSION = "WIMP/1";
export const GENESIS_HASH = "GENESIS";

// ── Canonical Representation ───────────────────────────────────────────

/**
 * Produce the canonical byte representation of a packet for signing.
 * Excludes the signature field itself.
 */
export function getCanonicalBytes(packet: Omit<WIMPPacket, "signature">): Uint8Array {
  const canonical = [
    packet.protocol,
    packet.sender_pk,
    packet.receiver_pk,
    packet.timestamp.toString(),
    packet.parent_hash,
    packet.expiry.toString(),
    packet.ciphertext,
  ].join("|");

  return new TextEncoder().encode(canonical);
}

// ── Build / Serialize / Deserialize ────────────────────────────────────

/**
 * Build an unsigned WIMP packet.
 * The signature must be added separately after signing the canonical bytes.
 */
export function buildPacket(params: PacketBuildParams): Omit<WIMPPacket, "signature"> {
  const now = Date.now();
  return {
    protocol: PROTOCOL_VERSION,
    sender_pk: params.senderPublicKey,
    receiver_pk: params.receiverPublicKey,
    timestamp: now,
    parent_hash: params.parentHash,
    expiry: now + params.expiryMs,
    ciphertext: params.ciphertext,
  };
}

/**
 * Serialize a packet to a JSON string for MQTT transport.
 */
export function serializePacket(packet: WIMPPacket): string {
  return JSON.stringify(packet);
}

/**
 * Deserialize a JSON string into a WIMPPacket.
 * Performs structural validation.
 */
export function deserializePacket(raw: string): WIMPPacket {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON in WIMP packet");
  }

  // Validate required fields
  const required: (keyof WIMPPacket)[] = [
    "protocol", "sender_pk", "receiver_pk",
    "timestamp", "parent_hash", "expiry",
    "ciphertext", "signature",
  ];

  for (const field of required) {
    if (!(field in parsed)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  if (parsed.protocol !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported protocol version: ${parsed.protocol}`);
  }

  if (typeof parsed.timestamp !== "number" || typeof parsed.expiry !== "number") {
    throw new Error("Timestamp and expiry must be numbers");
  }

  return parsed as WIMPPacket;
}

/**
 * Compute SHA-256 hash of a serialized packet (for chain linking).
 */
export async function hashPacket(packet: WIMPPacket): Promise<string> {
  const data = new TextEncoder().encode(serializePacket(packet));
  const hash = await crypto.subtle.digest("SHA-256", toBuffer(data));
  return bytesToHex(new Uint8Array(hash));
}

/**
 * Check if a packet has expired.
 */
export function isExpired(packet: WIMPPacket): boolean {
  return Date.now() > packet.expiry;
}
