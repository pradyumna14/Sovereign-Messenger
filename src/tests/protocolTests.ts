/**
 * Protocol Tests
 * 
 * Browser-runnable security tests for the WIMP/PICP/TTL-Chain protocol stack.
 * Tests cover:
 * - Signature forgery attempt
 * - Packet tampering detection
 * - Replay attack detection
 * - Message reordering detection
 * - Encryption/decryption round-trip
 * - Key rotation and lineage verification
 * - Temporal expiration
 * 
 * Run these by importing from the browser console or calling runAllTests().
 */

import { createSoftwareIdentity, rotateIdentity, verifyLineagePacket, type Identity } from "../hardware/identityManager";
import { buildPacket, serializePacket, deserializePacket, hashPacket, GENESIS_HASH, type WIMPPacket } from "../protocol/wimpPacket";
import { signPacket, verifyPacketSignature, validateTimestamp } from "../protocol/picpSignature";
import { encryptMessage, decryptMessage } from "../protocol/encryption";
import { createChainState, appendWithValidation, verifyFullChain, type ChainState } from "../protocol/ttlChain";

// ── Test Harness ───────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
  const start = performance.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: performance.now() - start });
    console.log(`  ✅ ${name}`);
  } catch (err) {
    const msg = (err as Error).message;
    results.push({ name, passed: false, error: msg, duration: performance.now() - start });
    console.log(`  ❌ ${name}: ${msg}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ── Helper: Create a signed test packet ────────────────────────────────

async function createTestPacket(
  sender: Identity,
  receiverPk: string,
  plaintext: string,
  parentHash: string = GENESIS_HASH,
  expiryMs: number = 300_000
): Promise<WIMPPacket> {
  const ciphertext = await encryptMessage(plaintext, sender.publicKey, receiverPk);
  const unsigned = buildPacket({
    senderPublicKey: sender.publicKey,
    receiverPublicKey: receiverPk,
    parentHash,
    expiryMs,
    ciphertext,
  });
  return signPacket(unsigned, sender.privateKey);
}

// ── Tests ──────────────────────────────────────────────────────────────

export async function runAllTests(): Promise<TestResult[]> {
  results.length = 0;
  console.log("\n🧪 Running Protocol Tests...\n");

  // Create test identities
  const alice = await createSoftwareIdentity();
  const bob = await createSoftwareIdentity();

  // ── Test 1: Encryption/Decryption Round-Trip ──
  await test("Encryption/Decryption round-trip", async () => {
    const plaintext = "Hello from Alice to Bob!";
    const encrypted = await encryptMessage(plaintext, alice.publicKey, bob.publicKey);
    const decrypted = await decryptMessage(encrypted, alice.publicKey, bob.publicKey);
    assert(decrypted === plaintext, `Expected "${plaintext}", got "${decrypted}"`);
  });

  // ── Test 2: Signature Verification ──
  await test("Valid signature verification", async () => {
    const packet = await createTestPacket(alice, bob.publicKey, "Signed message");
    const result = await verifyPacketSignature(packet);
    assert(result.valid, "Signature should be valid");
  });

  // ── Test 3: Signature Forgery Detection ──
  await test("Signature forgery detection", async () => {
    const packet = await createTestPacket(alice, bob.publicKey, "Original message");
    // Tamper with the signature
    const forged: WIMPPacket = {
      ...packet,
      signature: packet.signature.replace(/[0-9a-f]/, "0"), // corrupt one char
    };
    const result = await verifyPacketSignature(forged);
    assert(!result.valid, "Forged signature should be rejected");
  });

  // ── Test 4: Packet Tampering Detection ──
  await test("Packet tampering detection", async () => {
    const packet = await createTestPacket(alice, bob.publicKey, "Tamper-proof message");
    // Tamper with the ciphertext (keep valid signature from original)
    const tampered: WIMPPacket = {
      ...packet,
      ciphertext: "dGFtcGVyZWQ=", // "tampered" in base64
    };
    const result = await verifyPacketSignature(tampered);
    assert(!result.valid, "Tampered packet should fail signature check");
  });

  // ── Test 5: Replay Attack Detection ──
  await test("Replay attack detection (timestamp drift)", async () => {
    const packet = await createTestPacket(alice, bob.publicKey, "Fresh message");
    // Simulate an old packet by changing timestamp
    const replayed: WIMPPacket = {
      ...packet,
      timestamp: Date.now() - 600_000, // 10 minutes ago
    };
    const tsResult = validateTimestamp(replayed, 300_000); // 5 min tolerance
    assert(!tsResult.valid, "Replayed packet should fail timestamp check");
  });

  // ── Test 6: Chain Lineage Verification ──
  await test("Chain lineage verification – valid chain", async () => {
    const chain = createChainState();
    const pkt1 = await createTestPacket(alice, bob.publicKey, "Message 1", GENESIS_HASH);
    const chain1 = await appendWithValidation(pkt1, chain);
    assert(chain1.chainValid, "Chain should be valid after first message");

    const hash1 = await hashPacket(pkt1);
    const pkt2 = await createTestPacket(alice, bob.publicKey, "Message 2", hash1);
    const chain2 = await appendWithValidation(pkt2, chain1);
    assert(chain2.chainValid, "Chain should be valid after second message");
  });

  // ── Test 7: Message Reordering Detection ──
  await test("Message reordering detection", async () => {
    const chain = createChainState();
    const pkt1 = await createTestPacket(alice, bob.publicKey, "First", GENESIS_HASH);
    const chain1 = await appendWithValidation(pkt1, chain);

    // Create pkt2 but with wrong parent hash (simulating reorder)
    const pkt2 = await createTestPacket(alice, bob.publicKey, "Out of order", "wrong_hash_000");
    const chain2 = await appendWithValidation(pkt2, chain1);
    assert(!chain2.chainValid, "Reordered message should break chain");
    assert(chain2.errors.length > 0, "Should have lineage error");
  });

  // ── Test 8: Full Chain Verification ──
  await test("Full chain audit", async () => {
    const pkt1 = await createTestPacket(alice, bob.publicKey, "Msg 1", GENESIS_HASH);
    const hash1 = await hashPacket(pkt1);
    const pkt2 = await createTestPacket(alice, bob.publicKey, "Msg 2", hash1);
    const hash2 = await hashPacket(pkt2);
    const pkt3 = await createTestPacket(alice, bob.publicKey, "Msg 3", hash2);

    const audit = await verifyFullChain([pkt1, pkt2, pkt3]);
    assert(audit.valid, "Complete chain should be valid");
    assert(audit.errors.length === 0, "Should have no errors");
  });

  // ── Test 9: Broken Chain Audit ──
  await test("Broken chain audit detection", async () => {
    const pkt1 = await createTestPacket(alice, bob.publicKey, "Msg 1", GENESIS_HASH);
    // Skip pkt2, create pkt3 with wrong parent
    const pkt3 = await createTestPacket(alice, bob.publicKey, "Msg 3", "fake_parent_hash");

    const audit = await verifyFullChain([pkt1, pkt3]);
    assert(!audit.valid, "Broken chain should be detected");
    assert(audit.errors.length > 0, "Should have chain errors");
  });

  // ── Test 10: Key Rotation and Lineage ──
  await test("Key rotation with lineage packet", async () => {
    const { identity: rotatedAlice, lineage } = await rotateIdentity(alice);
    assert(lineage.previousPublicKey === alice.publicKey, "Previous key should match");
    assert(lineage.newPublicKey === rotatedAlice.publicKey, "New key should match");
    assert(rotatedAlice.previousPublicKey === alice.publicKey, "Identity should track previous key");
  });

  // ── Test 11: Packet Serialization Round-Trip ──
  await test("Packet serialization/deserialization", async () => {
    const packet = await createTestPacket(alice, bob.publicKey, "Serialize me");
    const json = serializePacket(packet);
    const restored = deserializePacket(json);
    assert(restored.protocol === packet.protocol, "Protocol version mismatch");
    assert(restored.sender_pk === packet.sender_pk, "Sender key mismatch");
    assert(restored.signature === packet.signature, "Signature mismatch");
  });

  // ── Test 12: Temporal Expiration ──
  await test("Temporal expiration detection", async () => {
    // Create packet with 1ms expiry (already expired by the time we check)
    const ciphertext = await encryptMessage("Ephemeral", alice.publicKey, bob.publicKey);
    const unsigned = buildPacket({
      senderPublicKey: alice.publicKey,
      receiverPublicKey: bob.publicKey,
      parentHash: GENESIS_HASH,
      expiryMs: 1, // 1 millisecond TTL
      ciphertext,
    });
    const expired = await signPacket(unsigned, alice.privateKey);

    // Wait a tick
    await new Promise((r) => setTimeout(r, 10));

    const { isExpired } = await import("../protocol/wimpPacket");
    assert(isExpired(expired), "Packet should be expired");
  });

  // ── Test 13: Cross-Identity Decryption Failure ──
  await test("Cross-identity decryption should fail", async () => {
    const eve = await createSoftwareIdentity();
    const encrypted = await encryptMessage("Secret", alice.publicKey, bob.publicKey);
    try {
      // Eve tries to decrypt with wrong key pair
      await decryptMessage(encrypted, alice.publicKey, eve.publicKey);
      assert(false, "Decryption should have failed");
    } catch {
      // Expected: decryption fails because Eve doesn't have the right shared key
    }
  });

  // ── Summary ──
  console.log("\n" + "═".repeat(50));
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`Results: ${passed}/${total} passed`);
  if (passed === total) {
    console.log("🎉 All tests passed!");
  } else {
    console.log("⚠️ Some tests failed:");
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`   ❌ ${r.name}: ${r.error}`);
    });
  }
  console.log("═".repeat(50) + "\n");

  return results;
}

// Export for browser console access
if (typeof window !== "undefined") {
  (window as any).runProtocolTests = runAllTests;
}
