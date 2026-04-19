# Fixed: Signature Verification & Network Key Sharing

## Summary of Fixes

### 1. **Signature Verification Error - FIXED**

**Problem**: The error `Signature verification failed: Signature does not match packet content` occurred because of a mismatch between hardware and protocol signing:
- **ESP32 firmware** uses SHA-256 symmetric signing: `SIGNATURE = SHA-256(daily_key || nonce)`
- **WIMP/PICP protocol** expects Ed25519/ECDSA asymmetric signing
- The codebase was trying to verify hardware SHA-256 signatures with Ed25519/ECDSA crypto.subtle.verify(), which always failed

**Solution**: Separated hardware identity from protocol identity
- `publicKey`: Software Ed25519/ECDSA key (used in WIMP packets, can be verified)
- `hardwarePublicKey`: ESP32 SHA-256 key (used as device identity anchor, verified via challenge-response)

**Files Updated**:
- `src/hardware/identityManager.ts` - Added `hardwarePublicKey` and `hardwareUsername` fields to Identity interface
- `src/hooks/useHardwareIdentity.ts` - Now keeps hardware and protocol keys separate

### 2. **Network Key Sharing - NEW FEATURE**

**Problem**: No mechanism to share identities across devices on the network. You can discover peers on localhost via BroadcastChannel, but not over the internet.

**Solution**: Implemented MQTT-based presence broadcasting with automatic peer discovery

**New Files**:
- `src/mqtt/presenceManager.ts` - Manages MQTT presence announcements and network peer discovery

**Updated Files**:
- `src/hooks/useMQTT.ts` - Added presence management and network peer tracking
- `src/discovery/peerDiscovery.ts` - Added `updateNetworkPeers()` method to merge network peers

## How to Use Network Key Sharing

### Step 1: Initialize Hardware (Optional)
```typescript
// Connect to ESP32 device
await identityActions.connectHardware();

// OR use software-only identity
await identityActions.initSoftwareIdentity("Alice");
```

### Step 2: Connect to MQTT Broker and Announce Presence
```typescript
// In your component (like index.tsx)
useEffect(() => {
  if (identityState.connected && identityState.identity && transportMode === "mqtt") {
    // 1. Connect to MQTT broker
    mqttActions.connect(brokerUrl);
    
    // 2. Subscribe to your inbox
    transportActions.subscribe(identityState.identity.publicKey);
    
    // 3. Announce your presence (this is new!)
    const hardwarePk = identityState.identity.hardwarePublicKey;
    const hardwareUsername = identityState.identity.hardwareUsername;
    
    mqttActions.announcePresence(
      identityState.identity.publicKey,      // Protocol public key
      identityState.deviceInfo?.username || "anonymous",
      {
        hardwarePublicKey: hardwarePk,      // Optional: ESP32 key
        hardwareUsername: hardwareUsername  // Optional: Device name
      }
    );
  }
}, [identityState.connected, identityState.identity, transportMode, mqttActions, transportActions]);
```

### Step 3: Discover Network Peers Automatically
```typescript
// The MQTT presence manager automatically discovers peers
// They appear in mqttState.networkPeers

useEffect(() => {
  if (mqttState.networkPeers.length > 0) {
    // Update peer discovery with network peers
    discovery.updateNetworkPeers(
      mqttState.networkPeers.map(p => ({
        publicKey: p.publicKey,
        username: p.username
      }))
    );
  }
}, [mqttState.networkPeers]);
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ Hardware Device (ESP32/ESP8266)                          │
│ ├─ Master Seed (permanent)                              │
│ ├─ Daily Public Key: SHA-256(HMAC(seed, day))          │
│ └─ Signs with: SHA-256(daily_key || data)              │
└──────────────────┬──────────────────────────────────────┘
                   │ (Hardware Identity Anchor)
                   ▼
┌─────────────────────────────────────────────────────────┐
│ Browser (Software Identity)                              │
│ ├─ Imported Hardware Public Key (hardwarePublicKey)     │
│ ├─ Software Master Seed (browser-generated)             │
│ ├─ Ed25519/ECDSA Daily Key Pair (protocol use)         │
│ └─ Signs with: Ed25519(canonical_bytes)                │
└──────────────────┬──────────────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
    ┌────────┐ ┌────────┐ ┌──────────┐
    │ WIMP   │ │ MQTT   │ │ MQTT     │
    │ Packet │ │ Inbox  │ │ Presence │
    │ Signing│ │ (peer  │ │ (auto    │
    │        │ │ to     │ │ discovery│
    │        │ │ peer)  │ │ network) │
    └────────┘ └────────┘ └──────────┘
```

## Public Key Types

### Protocol Public Key (`publicKey`)
- **Algorithm**: Ed25519 or ECDSA
- **Use**: WIMP packet signing, presence announcements, contact lists
- **Shared**: Yes, broadcast to others
- **Change Frequency**: Daily (automatic key rotation)

### Hardware Public Key (`hardwarePublicKey`) - Optional
- **Algorithm**: SHA-256 (digest-based identity)
- **Use**: Device hardware anchor, nonce challenge verification, hardware identity linking
- **Shared**: Yes, included in presence info for context
- **Change Frequency**: Device-specific behavior
- **Only Present When**: Connected to real hardware (ESP32)

## Message Flow

### Localhost (BroadcastChannel)
```
Device A                           Device B (Same Browser Origin)
  │                                   │
  ├─ Announce presence via BC ────────┼─ Receive via BC
  │  (protocol key + username)         │
  │                                   │
  └─← Discover peer ───────────────────┘
     (Add to peers automatically)
```

### Network (MQTT)
```
Device A (Alice)                    MQTT Broker              Device B (Bob)
  │                                    │                         │
  ├─ Connect to broker ────────────>,  │                         │
  │                                    │  ,──── Connect <────────┤
  │                                    │                         │
  ├─ Announce presence ────────────>,  ├─ Broadcast ────────────>│
  │ {                                  │ (to /wimp/v1/presence)  │
  │   "publicKey": "abc...",          │                         ├─ Parse & store
  │   "hardwarePublicKey": "def...",  │                         │   in networkPeers
  │   "username": "Alice",            │                    <────┤
  │   "timestamp": 1234567890         │                         │
  │ }                                 │ ,─────── Announce <─────┤
  │                                   │ (Bob's presence)         │
  └─ Receive Bob's presence <────────`,                         │
     Parse & store in networkPeers    │                         │
```

### Sending Messages Over Network
```
Alice                               MQTT Broker              Bob
  │                                   │                        │
  ├─ (From mqttState.networkPeers)   │                        │
  │  Finds Bob's publicKey: "xyz..."  │                        │
  │                                   │                        │
  ├─ Get topic for Bob:               │                        │
  │  topic = /wimp/v1/inbox/<hash>   │                        │
  │                                   │                        │
  ├─ Build & sign WIMP packet:        │                        │
  │  {                                │                        │
  │    sender_pk: alice_protocol_key  │                        │
  │    receiver_pk: bob_protocol_key  │                        │
  │    ciphertext: "...",             │                        │
  │    signature: "..."   (Ed25519)   │                        │
  │  }                                │                        │
  │                                   │                        │
  ├─ Publish to topic  ───────────>,  ├─ Route to Bob ────────>│
  │                                   │                        ├─ Verify signature
  │                                   │                        │  (works with
  │                                   │                        │   protocol key)
  │                                   │                        │
  │                                   │                        ├─ Decrypt & read
  │                                   │                        │
```

## Configuration

### MQTT Broker Options
- **Local (Development)**:
  ```typescript
  brokerUrl = "ws://localhost:9001"
  ```

- **HiveMQ Public Test Broker**:
  ```typescript
  brokerUrl = "wss://broker.hivemq.com:8884/mqtt"
  ```

- **Self-Hosted**:
  ```typescript
  brokerUrl = "wss://your-broker.example.com:8883"
  ```

### Presence Topic
- **Topic**: `/wimp/v1/presence`
- **QoS**: 1 (at-least-once delivery)
- **Retention**: Not recommended (transient presence)

## Security Notes

1. **No Private Keys Shared**: Only public keys are broadcast
2. **Broker Trust**: The MQTT broker is treated as untrusted; all security happens client-side
3. **Signature Verification**: Messages signed with protocol private keys, verified with protocol public keys
4. **Hardware Anchor**: Hardware public key provides proof-of-device but is optional
5. **Identity Rotation**: Protocol keys rotate daily; hardware keys are stable anchors

## Testing Network Key Sharing

### Test 1: Single Browser, Multi-Tab
1. Open app in Tab A
2. Connect to MQTT broker
3. Create software identity "Alice"
4. Open same URL in Tab B
5. Create software identity "Bob"
6. Both should see each other in discovered peers (via BroadcastChannel)

### Test 2: Multiple Devices Network
1. Device A: Connect to MQTT broker at `wss://broker.hivemq.com:8884/mqtt`
2. Create identity "Alice", send presence
3. Device B: Connect to same MQTT broker
4. Create identity "Bob", send presence
5. Device A: Should see Bob in `mqttState.networkPeers`
6. Device B: Should see Alice in `mqttState.networkPeers`
7. Both can message each other

### Test 3: With Hardware
1. Connect ESP32 via WebSerial
2. Browser creates protocol identity
3. Announce presence with both:
   - `publicKey` = Ed25519 protocol key
   - `hardwarePublicKey` = ESP32 SHA-256 key
4. Remote peer receives both and can cross-reference

## Troubleshooting

### Signature Verification Still Fails
- Ensure `publicKey` in WIMP packet is the **protocol key** (Ed25519/ECDSA), not hardware key
- Check that `signPacket()` is using `identity.privateKey` (software key)
- Verify `verifyPacketSignature()` is checking against the correct public key

### No Peers Discovered Over Network
- Check MQTT connection status: `mqttState.connected === true`
- Verify presence is announced: `mqttActions.announcePresence()` was called
- Check MQTT broker logs for messages on `/wimp/v1/presence`
- Try public HiveMQ broker first: `wss://broker.hivemq.com:8884/mqtt`

### Hardware Public Key Not Showing
- Only appears when connected to real ESP32
- Set via `identityActions.connectHardware()`
- Check `identityState.identity.hardwarePublicKey`

## Next Steps

1. **Add presence metadata**: Include device type, online status, etc.
2. **Implement presence expiration**: Clean up stale peers more aggressively
3. **Add trust verification**: Cross-validate hardware key with protocol key
4. **Implement key rotation signaling**: Announce when protocol key rotates
5. **Add peer reputation**: Track message success/failure per peer
