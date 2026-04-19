/**
 * TTL-Chain – Time Locked Lineage Chain
 * 
 * Implements hash-linked message verification to prevent tampering
 * or reordering of messages within a conversation.
 * 
 * Each packet includes a parent_hash that references the SHA-256 hash
 * of the previous message in the chain. This creates an immutable
 * linked list of messages.
 * 
 * Validation rule:
 *   packet.parent_hash === SHA-256(serialize(previous_packet))
 * 
 * If there is a mismatch, a lineage error is flagged.
 */

import { bytesToHex } from "../hardware/esp32Interface";
import {
  type WIMPPacket,
  serializePacket,
  GENESIS_HASH,
  hashPacket,
} from "./wimpPacket";

// ── Types ──────────────────────────────────────────────────────────────

export interface ChainState {
  messages: WIMPPacket[];
  lastHash: string;          // hash of the last valid message, or GENESIS
  chainValid: boolean;
  errors: ChainError[];
}

export interface ChainError {
  type: "LINEAGE_BROKEN" | "HASH_MISMATCH" | "OUT_OF_ORDER";
  packetTimestamp: number;
  expectedHash: string;
  actualHash: string;
  message: string;
}

export interface ChainValidation {
  valid: boolean;
  error?: ChainError;
}

// ── Chain Operations ───────────────────────────────────────────────────

/**
 * Create a new empty chain state.
 */
export function createChainState(): ChainState {
  return {
    messages: [],
    lastHash: GENESIS_HASH,
    chainValid: true,
    errors: [],
  };
}

/**
 * Validate that a new packet correctly links to the chain.
 * 
 * Rule: packet.parent_hash must equal the hash of the last message,
 * or GENESIS if this is the first message.
 */
export async function validateChainLink(
  packet: WIMPPacket,
  chain: ChainState
): Promise<ChainValidation> {
  const expectedParentHash = chain.lastHash;

  if (packet.parent_hash !== expectedParentHash) {
    return {
      valid: false,
      error: {
        type: "LINEAGE_BROKEN",
        packetTimestamp: packet.timestamp,
        expectedHash: expectedParentHash,
        actualHash: packet.parent_hash,
        message: `Chain broken: expected parent ${expectedParentHash.slice(0, 16)}... got ${packet.parent_hash.slice(0, 16)}...`,
      },
    };
  }

  return { valid: true };
}

/**
 * Append a validated packet to the chain.
 * Computes the hash of the new packet and updates lastHash.
 */
export async function appendToChain(
  packet: WIMPPacket,
  chain: ChainState
): Promise<ChainState> {
  const packetHash = await hashPacket(packet);

  return {
    messages: [...chain.messages, packet],
    lastHash: packetHash,
    chainValid: chain.chainValid,
    errors: [...chain.errors],
  };
}

/**
 * Append a packet to the chain with validation.
 * If validation fails, the error is recorded but the packet is still stored
 * (marked as invalid) so the user can see it flagged.
 */
export async function appendWithValidation(
  packet: WIMPPacket,
  chain: ChainState
): Promise<ChainState> {
  const validation = await validateChainLink(packet, chain);
  const packetHash = await hashPacket(packet);

  if (!validation.valid && validation.error) {
    return {
      messages: [...chain.messages, packet],
      lastHash: packetHash, // advance hash anyway to stay in sync
      chainValid: false,
      errors: [...chain.errors, validation.error],
    };
  }

  return {
    messages: [...chain.messages, packet],
    lastHash: packetHash,
    chainValid: chain.chainValid,
    errors: [...chain.errors],
  };
}

/**
 * Verify the entire chain from genesis.
 * Useful for auditing a conversation's integrity.
 */
export async function verifyFullChain(
  messages: WIMPPacket[]
): Promise<{ valid: boolean; errors: ChainError[] }> {
  const errors: ChainError[] = [];
  let expectedHash = GENESIS_HASH;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.parent_hash !== expectedHash) {
      errors.push({
        type: "LINEAGE_BROKEN",
        packetTimestamp: msg.timestamp,
        expectedHash,
        actualHash: msg.parent_hash,
        message: `Message ${i}: chain link broken`,
      });
    }

    expectedHash = await hashPacket(msg);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Remove expired messages from the chain.
 * Returns the pruned chain and the hashes of removed messages.
 */
export async function pruneExpired(
  chain: ChainState
): Promise<{ chain: ChainState; prunedCount: number }> {
  const now = Date.now();
  const active = chain.messages.filter((m) => m.expiry > now);
  const prunedCount = chain.messages.length - active.length;

  // Recompute the last hash from remaining messages
  let lastHash = GENESIS_HASH;
  for (const msg of active) {
    lastHash = await hashPacket(msg);
  }

  return {
    chain: {
      messages: active,
      lastHash,
      chainValid: chain.chainValid,
      errors: chain.errors,
    },
    prunedCount,
  };
}

/**
 * Get the current hash tip of the chain.
 * Used when building the next outgoing packet.
 */
export function getChainTip(chain: ChainState): string {
  return chain.lastHash;
}
