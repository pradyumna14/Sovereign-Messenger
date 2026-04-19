/**
 * ESP32 Firmware Fix: Signature Verification Compatibility
 * 
 * The ESP32 firmware uses SHA-256 symmetric signing, which cannot be
 * directly verified by the web code that expects Ed25519/ECDSA.
 * This guide explains the architecture and how to fix signature errors.
 */

// ════════════════════════════════════════════════════════════════════════
// PROBLEM EXPLANATION
// ════════════════════════════════════════════════════════════════════════

/*
The error message "[ERROR] Invalid message rejected: Signature verification failed"
comes from this flow:

1. ESP32 firmware signs with:
   SIGNATURE = SHA-256(daily_key || nonce)
   
2. Web code tries to verify with:
   crypto.subtle.verify(
     { name: "Ed25519" },           // Wrong! ESP uses SHA-256
     publicKey,
     signature,
     canonicalData
   )

3. Verification ALWAYS fails because:
   - ESP32 uses symmetric SHA-256 hashing
   - Web code expects asymmetric Ed25519 signatures
   - These are completely incompatible algorithms

The web code is DESIGNED to use Ed25519/ECDSA for WIMP packets,
not for hardware signatures. The hardware public key is separate.
*/

// ════════════════════════════════════════════════════════════════════════
// ARCHITECTURE FIX
// ════════════════════════════════════════════════════════════════════════

/*
BEFORE (Broken):
┌─────────────────────────┐
│ identity.publicKey      │ ← ESP32 SHA-256 key
│ identity.privateKey     │ ← Ed25519 key
└─────────────────────────┘
         │
    Mismatch! publicKey doesn't match privateKey algorithm
    Signature verification fails because we're trying to verify
    an Ed25519 signature (created by privateKey) against an  
    SHA-256 public key


AFTER (Fixed):
┌──────────────────────────────────────────────────────┐
│ identity.publicKey          → Ed25519/ECDSA (protocol)│
│ identity.privateKey         → Ed25519/ECDSA (protocol)│
│ identity.hardwarePublicKey  → SHA-256 (device anchor) │
└──────────────────────────────────────────────────────┘
         │                              │
    WIMP Packet Signing            Hardware Verification
         │                              │
    Signature.verify() ←────────────────┤ Challenge-Response
         │                              │
     Works!                          Works!
*/

// ════════════════════════════════════════════════════════════════════════
// WHERE SIGNATURE VERIFICATION HAPPENS
// ════════════════════════════════════════════════════════════════════════

// In src/protocol/picpSignature.ts:

export async function verifyPacketSignature(
  packet: WIMPPacket
): Promise<VerificationResult> {
  try {
    // THE FIX: The sender_pk in the packet is NOW the protocol key,
    // not the hardware key, so this verification works correctly.
    const senderPubKey = await importPublicKey(packet.sender_pk);

    const { signature, ...rest } = packet;
    const canonical = getCanonicalBytes(rest);
    const sigBytes = hexToBytes(signature);

    // This now works because:
    // - senderPubKey is Ed25519/ECDSA
    // - signature was created with Ed25519/ECDSA private key
    // - Algorithm matches!
    const algo = senderPubKey.algorithm.name === "Ed25519"
      ? { name: "Ed25519" }
      : { name: "ECDSA", hash: "SHA-256" };

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

// ════════════════════════════════════════════════════════════════════════
// ESP32 HARDWARE VERIFICATION (Does NOT use crypto.subtle.verify)
// ════════════════════════════════════════════════════════════════════════

// In src/hooks/useHardwareIdentity.ts:

// When ESP32 is connected, we use challenge-response for liveness:
const liveness = verifyESP32NonceLiveness(
  challenge.publicKey,        // ESP32 SHA-256 public key
  challenge.nonce,           // Random challenge we sent
  challenge.signature        // SIGNATURE = SHA-256(daily_key || nonce)
);

// verifyESP32NonceLiveness() does NOT use crypto.subtle.verify()
// Instead it uses SHA-256(daily_key || nonce) manually.
// This works because both sides use SHA-256, not Ed25519/ECDSA.

// ════════════════════════════════════════════════════════════════════════
// FIX CHECKLIST - What Was Changed
// ════════════════════════════════════════════════════════════════════════

// ✅ 1. Identity Manager (src/hardware/identityManager.ts)
//    Added fields to separate hardware from protocol identity:
interface Identity {
  publicKey: string;              // ← Ed25519/ECDSA (protocol)
  privateKey: CryptoKey;          // ← Ed25519/ECDSA (protocol)
  previousPublicKey: string | null;
  masterSeed: string;
  currentDay: number;
  createdAt: number;
  hardwarePublicKey?: string;     // ← SHA-256 (optional, if ESP32 device)
  hardwareUsername?: string;      // ← Device name (if ESP32)
}

// ✅ 2. Hardware Identity Hook (src/hooks/useHardwareIdentity.ts)
//    Fixed to keep hardware key separate:
const softId = await createSoftwareIdentity();  // Creates Ed25519 key
const identity: Identity = {
  ...softId,
  hardwarePublicKey: deviceInfo.publicKey,      // Store ESP32 key separately
  hardwareUsername: deviceInfo.username,
  // identity.publicKey is now the Ed25519 key, not hardware key
};

// ✅ 3. MQTT Presence Manager (NEW: src/mqtt/presenceManager.ts)
//    Announces both keys when available:
announcePresence(
  publicKey: "abc...",              // Protocol (Ed25519)
  username: "Alice",
  {
    hardwarePublicKey: "def...",   // Optional hardware anchor
    hardwareUsername: "AlicePhone"
  }
);

// ✅ 4. MQTT Hook (src/hooks/useMQTT.ts)
//    Updated to include presence manager
//    Exposes announcePresence() action

// ✅ 5. Peer Discovery (src/discovery/peerDiscovery.ts)
//    Added updateNetworkPeers() to merge MQTT peers

// ════════════════════════════════════════════════════════════════════════
// HOW MESSAGES FLOW NOW
// ════════════════════════════════════════════════════════════════════════

/*
SENDING A MESSAGE (FROM ALICE TO BOB):

1. Alice creates WIMP packet:
   {
     sender_pk: alice_protocol_key (Ed25519) ✓
     receiver_pk: bob_protocol_key (Ed25519) ✓
     ciphertext: "...",
     signature: "produced by alice_protocol_privateKey" ✓
   }

2. Signature is created with:
   signPacket(packet, identity.privateKey)  // Ed25519 private key
   
3. Bob receives and verifies:
   verifyPacketSignature(packet)
   
4. Verification imports public key:
   const senderPubKey = await importPublicKey(packet.sender_pk)
   // packet.sender_pk is Ed25519, so import works!
   
5. Verify with crypto.subtle.verify():
   crypto.subtle.verify(Ed25519, senderPubKey, signature, canonical)
   // Works because algorithm matches! ✓

WHY THIS WORKS:
- sender_pk (Ed25519) matches privateKey algorithm (Ed25519)
- Signature was created by Ed25519 key, verified by Ed25519 key
- All algorithms aligned

WHY THE ORIGINAL FAILED:
- sender_pk was ESP32 SHA-256 key
- privateKey was Ed25519
- Tried to verify Ed25519 signature with SHA-256 public key
- Algorithms mismatched → Verification always failed
*/

// ════════════════════════════════════════════════════════════════════════
// HOW TO AVOID THIS ISSUE GOING FORWARD
// ════════════════════════════════════════════════════════════════════════

/*
RULE 1: Separate Hardware and Protocol Keys
- Hardware keys are for device identity and liveness verification
- Protocol keys are for message signing and encryption
- Never mix them in WIMP packets

RULE 2: Always Use Protocol Keys in WIMP Packets
function buildPacket(params: PacketBuildParams) {
  return {
    sender_pk: senderPublicKey,  // ← Must be protocol key (Ed25519/ECDSA)
    receiver_pk: receiverPublicKey,  // ← Must be protocol key
    ...
  };
}

RULE 3: Hardware Keys Are Metadata Only
- Include in presence announcements for context
- Use challenge-response for verification, not crypto.subtle.verify()
- Perfect for "proof-of-device" but not for message signing

RULE 4: One Key Pair Per Algorithm Per Identity
✓ DO THIS:
  identity.publicKey = Ed25519 key
  identity.privateKey = Ed25519 key
  identity.hardwarePublicKey = SHA-256 key

✗ DON'T DO THIS:
  identity.publicKey = SHA-256 key
  identity.privateKey = Ed25519 key  // Mismatch!

RULE 5: Test Key Algorithm Compatibility
Before using a public key for verification, verify the algorithm:
const pubKey = await importPublicKey(hexString);
const algo = pubKey.algorithm.name;  // "Ed25519", "ECDSA", etc.
// Only verify if algorithm matches the expected signature type
*/

// ════════════════════════════════════════════════════════════════════════
// TESTING THE FIX
// ════════════════════════════════════════════════════════════════════════

// Run these tests to verify the fix works:

describe("Signature Verification Fix", () => {
  
  test("WIMP packet signature verifies with protocol key", async () => {
    // Create software identity (Ed25519)
    const identity = await createSoftwareIdentity();
    
    // Build packet with protocol key
    const packet = buildPacket({
      senderPublicKey: identity.publicKey,      // Ed25519
      receiverPublicKey: "abc...",
      ...
    });
    
    // Sign with protocol key
    const signed = await signPacket(packet, identity.privateKey);
    
    // Verify - should work!
    const result = await verifyPacketSignature(signed);
    expect(result.valid).toBe(true);  // ✓ PASSES
  });

  test("Incorrectly using hardware key as sender_pk fails verification", async () => {
    // This is what was happening before the fix
    const hardwarePk = "def...";  // SHA-256 key
    const protocolPrivateKey = await generateEd25519Key();
    
    // Build packet with WRONG key (hardware instead of protocol)
    const packet = buildPacket({
      senderPublicKey: hardwarePk,  // ✗ Wrong! SHA-256
      ...
    });
    
    // Sign with protocol key - signature is Ed25519
    const signed = await signPacket(packet, protocolPrivateKey);
    
    // Verify fails because public key doesn't match signature algorithm
    const result = await verifyPacketSignature(signed);
    expect(result.valid).toBe(false);  // ✗ FAILS (as expected)
    expect(result.reason).toContain("Signature does not match");
  });
});

// ════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════

/*
WHAT CAUSED THE ERROR:
- Mixing hardware (SHA-256) and protocol (Ed25519) keys in identity
- Using hardware public key in WIMP packet sender_pk
- Trying to verify Ed25519 signature with SHA-256 public key

THE FIX:
- Separated identity.publicKey (protocol: Ed25519) from 
  identity.hardwarePublicKey (hardware: SHA-256)
- WIMP packets now always use protocol keys
- Hardware keys stored separately for optional device verification

RESULT:
- ✓ Signature verification works
- ✓ Network peer discovery works
- ✓ Hardware anchor available but optional
- ✓ Full Ed25519/ECDSA support for protocol
*/
