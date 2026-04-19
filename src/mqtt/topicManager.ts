/**
 * MQTT Topic Manager
 * 
 * Manages topic derivation and routing for the WIMP protocol.
 * 
 * Topic format: /wimp/v1/inbox/<hash(public_key)>
 * 
 * The topic is derived by hashing the receiver's public key with SHA-256
 * and taking the first 8 hex characters. This provides:
 * - Privacy: broker cannot see raw public keys
 * - Deterministic routing: sender and receiver compute the same topic
 */

import { bytesToHex } from "../hardware/esp32Interface";
import { toBuffer } from "../protocol/bufferCompat";

// ── Constants ──────────────────────────────────────────────────────────

const TOPIC_PREFIX = "/wimp/v1/inbox/";
const HASH_TRUNCATION_LENGTH = 8; // chars of hex hash used in topic

// ── Topic Derivation ───────────────────────────────────────────────────

/**
 * Hash a public key to produce the inbox topic identifier.
 * Uses first 8 hex chars of SHA-256(public_key_hex).
 */
export async function hashPublicKeyForTopic(publicKeyHex: string): Promise<string> {
  const data = new TextEncoder().encode(publicKeyHex);
  const hash = await crypto.subtle.digest("SHA-256", toBuffer(data));
  return bytesToHex(new Uint8Array(hash)).slice(0, HASH_TRUNCATION_LENGTH);
}

/**
 * Compute the full MQTT inbox topic for a given public key.
 * Synchronous version using pre-computed hash.
 */
export function getInboxTopicFromHash(hash: string): string {
  return `${TOPIC_PREFIX}${hash}`;
}

/**
 * Compute inbox topic for a public key (async – performs hashing).
 */
export async function getInboxTopicAsync(publicKeyHex: string): Promise<string> {
  const hash = await hashPublicKeyForTopic(publicKeyHex);
  return getInboxTopicFromHash(hash);
}

/**
 * Synchronous fallback using simple hash for immediate topic generation.
 * Uses a quick non-crypto hash for synchronous contexts.
 */
export function getInboxTopic(publicKeyHex: string): string {
  // Simple deterministic hash for synchronous use
  let hash = 0;
  for (let i = 0; i < publicKeyHex.length; i++) {
    const chr = publicKeyHex.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  const hexHash = Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8);
  return `${TOPIC_PREFIX}${hexHash}`;
}

/**
 * Parse a topic string to extract the inbox hash.
 */
export function parseInboxTopic(topic: string): string | null {
  if (!topic.startsWith(TOPIC_PREFIX)) return null;
  return topic.slice(TOPIC_PREFIX.length);
}

/**
 * Check if a topic is a valid WIMP inbox topic.
 */
export function isInboxTopic(topic: string): boolean {
  return topic.startsWith(TOPIC_PREFIX) && topic.length > TOPIC_PREFIX.length;
}

/**
 * Generate a wildcard subscription for all WIMP inboxes (for debugging).
 */
export function getWildcardTopic(): string {
  return `${TOPIC_PREFIX}+`;
}
