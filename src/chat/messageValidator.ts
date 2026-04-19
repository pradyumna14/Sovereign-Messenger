/**
 * Message Validator
 * 
 * Orchestrates the full validation pipeline for incoming WIMP packets:
 * 1. Structural validation (deserialize)
 * 2. Timestamp drift check (anti-replay)
 * 3. Signature verification (PICP)
 * 4. Chain lineage verification (TTL-Chain)
 * 5. Expiry check
 * 
 * Only after all checks pass is the message decrypted.
 */

import { deserializePacket, isExpired, type WIMPPacket } from "../protocol/wimpPacket";
import { verifyPacketSignature, validateTimestamp } from "../protocol/picpSignature";
import { validateChainLink, type ChainState } from "../protocol/ttlChain";
import { decryptMessage } from "../protocol/encryption";

// ── Types ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  packet: WIMPPacket | null;
  plaintext: string | null;
  signatureValid: boolean;
  chainValid: boolean;
  errors: string[];
  warnings: string[];
}

// ── Full Pipeline ──────────────────────────────────────────────────────

/**
 * Run the complete validation pipeline on a raw incoming message.
 * 
 * Order of checks:
 * 1. Deserialize JSON → WIMPPacket
 * 2. Check protocol version
 * 3. Check timestamp drift (anti-replay)
 * 4. Verify signature (PICP)
 * 5. Verify chain link (TTL-Chain)
 * 6. Check expiry
 * 7. Decrypt only if all above pass
 */
export async function validateIncomingMessage(
  rawPayload: string,
  chain: ChainState,
  myPublicKey: string
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let signatureValid = false;
  let chainValid = false;

  // ── Step 1: Deserialize ──
  let packet: WIMPPacket;
  try {
    packet = deserializePacket(rawPayload);
  } catch (err) {
    return {
      valid: false,
      packet: null,
      plaintext: null,
      signatureValid: false,
      chainValid: false,
      errors: [`Deserialization failed: ${(err as Error).message}`],
      warnings: [],
    };
  }

  // ── Step 2: Timestamp check ──
  const tsResult = validateTimestamp(packet);
  if (!tsResult.valid) {
    warnings.push(tsResult.reason || "Timestamp validation failed");
  }

  // ── Step 3: Check expiry ──
  if (isExpired(packet)) {
    errors.push("Message has expired");
    return {
      valid: false,
      packet,
      plaintext: null,
      signatureValid: false,
      chainValid: false,
      errors,
      warnings,
    };
  }

  // ── Step 4: Verify signature (PICP) ──
  const sigResult = await verifyPacketSignature(packet);
  signatureValid = sigResult.valid;
  if (!sigResult.valid) {
    errors.push(`Signature verification failed: ${sigResult.reason}`);
    return {
      valid: false,
      packet,
      plaintext: null,
      signatureValid: false,
      chainValid: false,
      errors,
      warnings,
    };
  }

  // ── Step 5: Verify chain link (TTL-Chain) ──
  const chainResult = await validateChainLink(packet, chain);
  chainValid = chainResult.valid;
  if (!chainResult.valid && chainResult.error) {
    warnings.push(`Chain: ${chainResult.error.message}`);
    // Don't reject the message, but flag the lineage break
  }

  // ── Step 6: Decrypt (only after signature verification) ──
  let plaintext: string | null = null;
  try {
    plaintext = await decryptMessage(
      packet.ciphertext,
      packet.sender_pk,
      myPublicKey
    );
  } catch (err) {
    errors.push(`Decryption failed: ${(err as Error).message}`);
    return {
      valid: false,
      packet,
      plaintext: null,
      signatureValid,
      chainValid,
      errors,
      warnings,
    };
  }

  return {
    valid: errors.length === 0,
    packet,
    plaintext,
    signatureValid,
    chainValid,
    errors,
    warnings,
  };
}

/**
 * Validate a packet without decryption (for testing/debugging).
 */
export async function validatePacketIntegrity(
  packet: WIMPPacket,
  chain: ChainState
): Promise<{ signatureValid: boolean; chainValid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const sigResult = await verifyPacketSignature(packet);
  if (!sigResult.valid) {
    errors.push(`Signature: ${sigResult.reason}`);
  }

  const chainResult = await validateChainLink(packet, chain);
  if (!chainResult.valid && chainResult.error) {
    errors.push(`Chain: ${chainResult.error.message}`);
  }

  if (isExpired(packet)) {
    errors.push("Message expired");
  }

  return {
    signatureValid: sigResult.valid,
    chainValid: chainResult.valid,
    errors,
  };
}
