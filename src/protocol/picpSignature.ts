/**
 * PICP – Proof of Identity Communication Protocol
 * 
 * Handles cryptographic signature creation and verification for WIMP packets.
 * Implements the identity verification layer of the protocol stack.
 * 
 * Every outgoing packet is signed with the sender's daily private key.
 * Every incoming packet's signature is verified before decryption.
 */

import { bytesToHex, hexToBytes } from "../hardware/esp32Interface";
import { importPublicKey, type Identity } from "../hardware/identityManager";
import { type WIMPPacket, getCanonicalBytes } from "./wimpPacket";
import { toBuffer } from "./bufferCompat";

// ── Types ──────────────────────────────────────────────────────────────

export interface VerificationResult {
  valid: boolean;
  reason?: string;
  senderKey: string;
  timestamp: number;
}

// ── Signing ────────────────────────────────────────────────────────────

/**
 * Sign a WIMP packet with the sender's private key.
 * Returns the complete packet with signature attached.
 */
export async function signPacket(
  packet: Omit<WIMPPacket, "signature">,
  privateKey: CryptoKey
): Promise<WIMPPacket> {
  const canonical = getCanonicalBytes(packet);

  const algo = privateKey.algorithm.name === "Ed25519"
    ? { name: "Ed25519" }
    : { name: "ECDSA", hash: "SHA-256" };

  const signatureBuffer = await crypto.subtle.sign(
    algo as any,
    privateKey,
    toBuffer(canonical)
  );

  return {
    ...packet,
    signature: bytesToHex(new Uint8Array(signatureBuffer)),
  };
}

// ── Verification ───────────────────────────────────────────────────────

/**
 * Verify the signature on a WIMP packet.
 * 
 * Steps:
 * 1. Extract sender_pk from the packet
 * 2. Import the public key
 * 3. Reconstruct the canonical byte representation
 * 4. Verify the Ed25519/ECDSA signature
 * 5. Return verification result
 */
export async function verifyPacketSignature(
  packet: WIMPPacket
): Promise<VerificationResult> {
  try {
    // Import sender's public key
    const senderPubKey = await importPublicKey(packet.sender_pk);

    // Reconstruct canonical data (everything except signature)
    const { signature, ...rest } = packet;
    const canonical = getCanonicalBytes(rest);

    // Decode signature
    const sigBytes = hexToBytes(signature);

    // Determine algorithm
    const algo = senderPubKey.algorithm.name === "Ed25519"
      ? { name: "Ed25519" }
      : { name: "ECDSA", hash: "SHA-256" };

    // Verify
    const valid = await crypto.subtle.verify(
      algo as any,
      senderPubKey,
      toBuffer(sigBytes),
      toBuffer(canonical)
    );

    return {
      valid,
      reason: valid ? undefined : "Signature does not match packet content",
      senderKey: packet.sender_pk,
      timestamp: packet.timestamp,
    };
  } catch (err) {
    return {
      valid: false,
      reason: `Verification error: ${(err as Error).message}`,
      senderKey: packet.sender_pk,
      timestamp: packet.timestamp,
    };
  }
}

/**
 * Verify that a packet was signed by a specific known public key.
 * Used when we have a trusted contact list.
 */
export async function verifyPacketFromKnownSender(
  packet: WIMPPacket,
  expectedSenderPk: string
): Promise<VerificationResult> {
  if (packet.sender_pk !== expectedSenderPk) {
    return {
      valid: false,
      reason: `Sender key mismatch: expected ${expectedSenderPk.slice(0, 16)}...`,
      senderKey: packet.sender_pk,
      timestamp: packet.timestamp,
    };
  }
  return verifyPacketSignature(packet);
}

/**
 * Reject a packet if its timestamp is too far in the future or past.
 * Helps prevent replay attacks.
 */
export function validateTimestamp(
  packet: WIMPPacket,
  maxDriftMs: number = 300_000 // 5 minutes
): { valid: boolean; reason?: string } {
  const now = Date.now();
  const drift = Math.abs(now - packet.timestamp);

  if (drift > maxDriftMs) {
    return {
      valid: false,
      reason: `Timestamp drift ${drift}ms exceeds max ${maxDriftMs}ms`,
    };
  }
  return { valid: true };
}
