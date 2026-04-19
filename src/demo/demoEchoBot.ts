/**
 * Demo Echo Bot
 * 
 * A simulated second peer ("bob") for demo mode. Holds a REAL cryptographic
 * identity so that messages encrypted alice→bob can be properly verified,
 * and responses bob→alice can be properly decrypted by alice.
 * 
 * Usage in demo mode:
 *   1. Initialize the bot — creates a real key pair for bob
 *   2. Use bob's publicKey as the demo contact's key
 *   3. When alice sends a message, call createEchoResponse()
 *   4. Publish the response to alice's inbox via the local bus
 *   5. Alice receives a properly encrypted+signed message she can decrypt
 */

import {
  createSoftwareIdentity,
  type Identity,
} from "../hardware/identityManager";
import { encryptMessage } from "../protocol/encryption";
import {
  buildPacket,
  serializePacket,
  GENESIS_HASH,
  hashPacket,
} from "../protocol/wimpPacket";
import { signPacket } from "../protocol/picpSignature";

// ── Echo Responses ─────────────────────────────────────────────────────

const ECHO_RESPONSES = [
  "Message received and verified! 🔐",
  "Roger that — chain link validated ⛓",
  "Copy. Signature authenticated ✓",
  "Acknowledged. Decryption successful 🔓",
  "Received! Packet integrity confirmed 📦",
  "Got it — all protocol layers verified ✅",
  "Message decrypted. TTL timer started ⏱",
  "Confirmed — WIMP/1 packet accepted 📡",
];

function pickResponse(): string {
  return ECHO_RESPONSES[Math.floor(Math.random() * ECHO_RESPONSES.length)];
}

// ── DemoEchoBot ────────────────────────────────────────────────────────

export class DemoEchoBot {
  private identity: Identity | null = null;
  private lastHash = GENESIS_HASH;
  private _ready = false;

  get ready(): boolean {
    return this._ready;
  }

  get publicKey(): string {
    return this.identity?.publicKey || "";
  }

  /**
   * Initialize the bot with a real cryptographic identity.
   * Returns bob's public key to use as the demo contact.
   */
  async initialize(): Promise<string> {
    this.identity = await createSoftwareIdentity();
    this.lastHash = GENESIS_HASH;
    this._ready = true;
    console.log("[DemoBot] Bob initialized:", this.identity.publicKey.slice(0, 20) + "...");
    return this.identity.publicKey;
  }

  /**
   * Create a properly signed + encrypted echo response from bob → alice.
   * 
   * @param alicePublicKey - Alice's public key (the receiver of the response)
   * @param expiryMs - How long the response should live
   * @returns Serialized WIMP packet ready for transport, or null on failure
   */
  async createEchoResponse(
    alicePublicKey: string,
    expiryMs: number = 300_000
  ): Promise<string | null> {
    if (!this.identity) {
      console.error("[DemoBot] Not initialized");
      return null;
    }

    try {
      const responseText = pickResponse();

      // 1. Encrypt: bob → alice (using real keys so alice can decrypt)
      const ciphertext = await encryptMessage(
        responseText,
        this.identity.publicKey,
        alicePublicKey
      );

      // 2. Build unsigned packet
      const unsigned = buildPacket({
        senderPublicKey: this.identity.publicKey,
        receiverPublicKey: alicePublicKey,
        parentHash: this.lastHash,
        expiryMs,
        ciphertext,
      });

      // 3. Sign with bob's private key
      const signed = await signPacket(unsigned, this.identity.privateKey);

      // 4. Update chain
      this.lastHash = await hashPacket(signed);

      // 5. Serialize for transport
      return serializePacket(signed);
    } catch (err) {
      console.error("[DemoBot] Echo response failed:", err);
      return null;
    }
  }

  /**
   * Destroy the bot's identity (cleanup).
   */
  destroy(): void {
    this.identity = null;
    this._ready = false;
    this.lastHash = GENESIS_HASH;
  }
}
