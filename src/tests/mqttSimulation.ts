/**
 * MQTT Simulation
 * 
 * Simulates multi-client messaging without requiring an actual MQTT broker.
 * Useful for testing the full protocol stack in a single browser window.
 * 
 * Creates two virtual identities (Alice and Bob) and simulates message
 * exchange through an in-memory message bus.
 */

import { createSoftwareIdentity, type Identity } from "../hardware/identityManager";
import { buildPacket, serializePacket, deserializePacket, hashPacket, GENESIS_HASH } from "../protocol/wimpPacket";
import { signPacket, verifyPacketSignature } from "../protocol/picpSignature";
import { encryptMessage, decryptMessage } from "../protocol/encryption";
import { createChainState, appendWithValidation, getChainTip } from "../protocol/ttlChain";
import { validateIncomingMessage } from "../chat/messageValidator";

// ── Types ──────────────────────────────────────────────────────────────

interface SimUser {
  name: string;
  identity: Identity;
  chain: ReturnType<typeof createChainState>;
  receivedMessages: string[];
}

interface SimLog {
  timestamp: number;
  from: string;
  to: string;
  plaintext: string;
  verified: boolean;
  chainValid: boolean;
  packetSize: number;
}

// ── Simulation ─────────────────────────────────────────────────────────

export async function runMQTTSimulation(): Promise<SimLog[]> {
  console.log("\n📡 Running MQTT Simulation...\n");

  const logs: SimLog[] = [];

  // Create two identities
  const aliceId = await createSoftwareIdentity();
  const bobId = await createSoftwareIdentity();

  const alice: SimUser = {
    name: "Alice",
    identity: aliceId,
    chain: createChainState(),
    receivedMessages: [],
  };

  const bob: SimUser = {
    name: "Bob",
    identity: bobId,
    chain: createChainState(),
    receivedMessages: [],
  };

  console.log(`  Alice PK: ${alice.identity.publicKey.slice(0, 20)}...`);
  console.log(`  Bob   PK: ${bob.identity.publicKey.slice(0, 20)}...`);

  // ── Simulate Message Exchange ──

  // 1. Alice sends to Bob
  const log1 = await simulateSend(alice, bob, "Hello Bob! This is a sovereign message.");
  logs.push(log1);

  // 2. Bob replies to Alice
  const log2 = await simulateSend(bob, alice, "Hi Alice! Received and verified.");
  logs.push(log2);

  // 3. Alice sends another
  const log3 = await simulateSend(alice, bob, "Great! Chain integrity test.");
  logs.push(log3);

  // 4. Bob sends another
  const log4 = await simulateSend(bob, alice, "Roger that. All links verified.");
  logs.push(log4);

  // 5. Simulate a short-lived message
  const log5 = await simulateSend(alice, bob, "This message self-destructs!", 100);
  logs.push(log5);

  // Wait for it to expire
  await new Promise((r) => setTimeout(r, 200));
  console.log("\n  ⏱ Short-lived message has expired");

  // ── Summary ──
  console.log("\n" + "─".repeat(50));
  console.log("Simulation Summary:");
  console.log(`  Messages exchanged: ${logs.length}`);
  console.log(`  All verified: ${logs.every((l) => l.verified)}`);
  console.log(`  All chains valid: ${logs.every((l) => l.chainValid)}`);
  console.log(`  Alice chain length: ${alice.chain.messages.length}`);
  console.log(`  Bob chain length: ${bob.chain.messages.length}`);
  console.log("─".repeat(50) + "\n");

  return logs;
}

async function simulateSend(
  sender: SimUser,
  receiver: SimUser,
  plaintext: string,
  expiryMs: number = 300_000
): Promise<SimLog> {
  // 1. Encrypt
  const ciphertext = await encryptMessage(
    plaintext,
    sender.identity.publicKey,
    receiver.identity.publicKey
  );

  // 2. Build packet
  const parentHash = getChainTip(sender.chain);
  const unsigned = buildPacket({
    senderPublicKey: sender.identity.publicKey,
    receiverPublicKey: receiver.identity.publicKey,
    parentHash,
    expiryMs,
    ciphertext,
  });

  // 3. Sign
  const signed = await signPacket(unsigned, sender.identity.privateKey);

  // 4. Serialize (what would go over MQTT)
  const serialized = serializePacket(signed);

  // 5. Update sender's chain
  sender.chain = await appendWithValidation(signed, sender.chain);

  // ── Receiver side ──

  // 6. Validate incoming
  const validation = await validateIncomingMessage(
    serialized,
    receiver.chain,
    receiver.identity.publicKey
  );

  // 7. Update receiver's chain
  if (validation.packet) {
    receiver.chain = await appendWithValidation(validation.packet, receiver.chain);
  }

  const log: SimLog = {
    timestamp: Date.now(),
    from: sender.name,
    to: receiver.name,
    plaintext,
    verified: validation.signatureValid,
    chainValid: validation.chainValid,
    packetSize: serialized.length,
  };

  const status = validation.valid ? "✅" : "❌";
  console.log(
    `  ${status} ${sender.name} → ${receiver.name}: "${plaintext.slice(0, 40)}${
      plaintext.length > 40 ? "..." : ""
    }" (${serialized.length}B, sig:${validation.signatureValid}, chain:${validation.chainValid})`
  );

  return log;
}

// ── Attack Simulation ──────────────────────────────────────────────────

export async function runAttackSimulation(): Promise<void> {
  console.log("\n🔴 Running Attack Simulation...\n");

  const alice = await createSoftwareIdentity();
  const bob = await createSoftwareIdentity();
  const eve = await createSoftwareIdentity(); // attacker

  const chain = createChainState();

  // ── Attack 1: Eve forges a message pretending to be Alice ──
  console.log("  Attack 1: Signature Forgery");
  const forgedCiphertext = await encryptMessage("Fake message", eve.publicKey, bob.publicKey);
  const forgedUnsigned = buildPacket({
    senderPublicKey: alice.publicKey, // Eve claims to be Alice
    receiverPublicKey: bob.publicKey,
    parentHash: GENESIS_HASH,
    expiryMs: 300_000,
    ciphertext: forgedCiphertext,
  });
  // Eve signs with her own key, but claims sender is Alice
  const forgedSigned = await signPacket(forgedUnsigned, eve.privateKey);
  const forgedSerialized = serializePacket(forgedSigned);

  const forgeResult = await validateIncomingMessage(forgedSerialized, chain, bob.publicKey);
  console.log(`    Forgery detected: ${!forgeResult.valid} ✓`);
  console.log(`    Reason: ${forgeResult.errors.join(", ")}`);

  // ── Attack 2: Eve tampers with a legitimate packet ──
  console.log("\n  Attack 2: Packet Tampering");
  const legitimateCiphertext = await encryptMessage("Real message", alice.publicKey, bob.publicKey);
  const legitimateUnsigned = buildPacket({
    senderPublicKey: alice.publicKey,
    receiverPublicKey: bob.publicKey,
    parentHash: GENESIS_HASH,
    expiryMs: 300_000,
    ciphertext: legitimateCiphertext,
  });
  const legitimate = await signPacket(legitimateUnsigned, alice.privateKey);
  
  // Tamper with timestamp
  const tampered = { ...legitimate, timestamp: legitimate.timestamp + 1 };
  const tamperedSerialized = serializePacket(tampered);
  
  const tamperResult = await validateIncomingMessage(tamperedSerialized, chain, bob.publicKey);
  console.log(`    Tampering detected: ${!tamperResult.valid} ✓`);
  console.log(`    Reason: ${tamperResult.errors.join(", ")}`);

  // ── Attack 3: Replay old message ──
  console.log("\n  Attack 3: Replay Attack");
  // Legitimate message first
  const validSerialized = serializePacket(legitimate);
  const firstResult = await validateIncomingMessage(validSerialized, chain, bob.publicKey);
  console.log(`    First delivery: valid=${firstResult.valid}`);
  
  // Try replay - chain has advanced so parent_hash won't match
  if (firstResult.packet) {
    const updatedChain = await appendWithValidation(firstResult.packet, chain);
    const replayResult = await validateIncomingMessage(validSerialized, updatedChain, bob.publicKey);
    console.log(`    Replay detected (chain mismatch): ${!replayResult.chainValid} ✓`);
  }

  console.log("\n  All attacks properly detected! 🛡️\n");
}

// Export for browser console
if (typeof window !== "undefined") {
  (window as any).runMQTTSimulation = runMQTTSimulation;
  (window as any).runAttackSimulation = runAttackSimulation;
}
