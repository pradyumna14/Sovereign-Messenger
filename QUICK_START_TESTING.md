# Quick Start: Testing Your Fixes

## Prerequisites
- Node.js 16+
- Running MQTT broker (optional, can use HiveMQ public broker)
- ESP32/ESP8266 device (optional, can use software mode)

## Part 1: Verify Signature Verification Fix

### Test 1.1: Software-Only Mode (No Hardware)
```bash
# 1. Start the app
npm run dev

# 2. Open http://localhost:3000 in browser
# 3. Click "Demo" button
# 4. Should show "Connected" without errors
# 5. Check console for any signature errors
#    [GOOD] No "Signature verification failed" errors
#    [BAD] See "Signature does not match" errors
```

### Test 1.2: With Real ESP32
```bash
# 1. Upload the updated firmware.ino to ESP32
# 2. Start the app and navigate to http://localhost:3000
# 3. Click "Hardware"
# 4. Select the serial port (your ESP32)
# 5. ESP32 should handshake and display identity
# 6. Verify no signature errors in console
```

## Part 2: Test Network Key Sharing

### Test 2.1: HiveMQ Broker (Public, Free)
```bash
npm run dev

# Open http://localhost:3000 in two DIFFERENT BROWSERS (or incognito windows)

# Browser 1 (Alice):
# 1. Create software identity: Click "Software" button
# 2. Set transport to MQTT
# 3. Use broker: wss://broker.hivemq.com:8884/mqtt
# 4. Click "Connect MQTT"
# 5. Should show "Connected to broker"
# 6. Check console for "[MQTT] Connected to broker"
# 7. Check for "[Presence] Subscribed to /wimp/v1/presence"
# 8. Check for "[Presence] Published presence announcement"

# Browser 2 (Bob):
# 1. Create different software identity: Click "Software" button
# 2. Set transport to MQTT
# 3. Use same broker: wss://broker.hivemq.com:8884/mqtt
# 4. Click "Connect MQTT"
# 5. Should show "Connected to broker"

# After ~5 seconds:
# Alice should see Bob in "Network Peers" section
# Bob should see Alice in "Network Peers" section
# ✓ SUCCESS: Network peer discovery working!
```

### Test 2.2: Local MQTT Broker (Docker)
```bash
# Start Mosquitto with WebSocket support
docker run -d --name mosquitto -p 9001:9001 -p 1883:1883 \
  eclipse-mosquitto:latest

# Config required (Mosquitto doesn't have WS by default)
# Create mosquitto.conf:
listener 9001
protocol websockets

listener 1883
protocol mqtt

# Then in the app:
# Use broker: ws://localhost:9001

# Rest of the test is the same as 2.1
```

## Part 3: Exchange Messages Over Network

### Test 3.1: Send Message Between Network Peers
```bash
# Continue from Test 2.1 setup with Alice and Bob

# Alice's browser:
# 1. Look at "Network Peers" section
# 2. You should see "Bob" with his public key
# 3. Click "Add Contact" for Bob
# 4. Select Bob from contacts list
# 5. Type a message in the message box
# 6. Click "Send"
# 7. Alice's interface should show the message

# Bob's browser:
# 1. Check the console for incoming message
# 2. Should see "[Transport] Incoming on /wimp/v1/inbox/..."
# 3. Message appears in Bob's chat window from Alice
# ✓ SUCCESS: Network messaging working!

# Reply from Bob to Alice:
# 1. Bob types response and clicks "Send"
# 2. Alice receives message from Bob
# ✓ BIDIRECTIONAL SUCCESS!
```

## Part 4: Verify Hardware Integration (Optional)

### Test 4.1: Hardware + Network
```bash
# 1. Connect ESP32 via USB
# 2. App: Click "Hardware" button
# 3. Select serial port
# 4. Wait for "Connected" status
# 5. Both these should be visible:
#    - hardwarePublicKey (ESP32 SHA-256)
#    - publicKey (Ed25519/ECDSA for protocol)
#
# 6. Switch transport to MQTT
# 7. Connect to MQTT broker
# 8. Announce presence should include:
#    {
#      "publicKey": "abc...",           ← protocol Ed25519
#      "hardwarePublicKey": "def...",   ← hardware SHA-256
#      "hardwareUsername": "MyESP32",
#      "username": "MySoftwareID"
#    }
#
# 9. Other devices should see both keys in network peers
#    ✓ SUCCESS: Hardware anchor visible in network!
```

## Troubleshooting

### Issue: "Signature verification failed"
**Still seeing this error?**
```bash
# 1. Check that identity.publicKey is Ed25519
#    Log in console: console.log(identityState.identity)
#    Look for: algorithm.name === "Ed25519" or "ECDSA"
#
# 2. Check that WIMP packets use protocol key, not hardware key
#    In src/demo/demoEchoBot.ts line 101:
#    Should be: senderPublicKey: this.identity.publicKey
#    NOT: senderPublicKey: this.identity.hardwarePublicKey
#
# 3. Verify signPacket uses correct private key
#    Should be: identity.privateKey (Ed25519)
#    NOT: Any SHA-256 key
```

### Issue: No Network Peers Discovered
**Steps to debug:**

```bash
# 1. Open Developer Console (F12)
# 2. Check these logs:
#    [MQTT] Connected to broker: ✓ Should show
#    [Presence] Subscribed to /wimp/v1/presence: ✓ Should show
#    [Presence] Published: ✓ Should show every 10 seconds
#
# 3. If "[Presence] Published" doesn't appear:
#    - announcePresence() wasn't called
#    - Check index.tsx - did you add the useEffect from INTEGRATION_EXAMPLE.md?
#
# 4. Check MQTT connection:
#    - mqttState.connected should be true
#    - In index.tsx: console.log({ mqttState })
#
# 5. Try different MQTT broker:
#    - Current: wss://broker.hivemq.com:8884/mqtt
#    - Test with HiveMQ first (most reliable)
```

### Issue: Messages Not Deliverable
```bash
# 1. Verify both peers see each other:
#    Alice: mqttState.networkPeers should contain Bob
#    Bob: mqttState.networkPeers should contain Alice
#
# 2. Check subscription to peer inbox:
#    When you select a contact, we call:
#    transportActions.subscribe(contactPublicKey)
#    This should add contact's inbox to subscribedTopics
#
# 3. Check topic format:
#    Topics should be: /wimp/v1/inbox/<hash8chars>
#    Not: /wimp/v1/inbox/<full_public_key>
#
# 4. Verify message encryption:
#    Message sent should include ciphertext (encrypted)
#    Not raw plaintext
```

### Issue: Multiple Sessions Not Discovering Each Other
```bash
# Are you testing with:
# - Two different browsers? (Chrome + Firefox) → Works ✓
# - Two incognito windows? (Chrome + Chrome Incognito) → Works ✓
# - Two tabs in same window? → Try BroadcastChannel, may not work in all setups
#
# If using same browser/tab combo:
# 1. Clear localStorage: DevTools → Application → Clear storage
# 2. Try Private/Incognito windows instead
# 3. Try different browsers (Chrome & Firefox)
```

## Performance Monitoring

### Check Identity Key Types
```javascript
// In browser console:
identityState.identity.publicKey
// Should be: "abc123def456..." (hex string, ~64 chars for Ed25519)
// Algorithm: Ed25519 or ECDSA-P256

identityState.identity.hardwarePublicKey
// Should be: "def456abc123..." (if hardware connected)
// Or: undefined (if software-only)

identityState.identity.privateKey
// Should be: CryptoKey object with algorithm.name = "Ed25519"
```

### Monitor Presence Announcements
```javascript
// In browser console:
// Should repeat every 10 seconds:
console.log("Presence timers: ", {
  announceTimer: "running" | "null",
  cleanupTimer: "running" | "null"
});
```

### Check MQTT Traffic
```bash
# If using local Mosquitto, monitor topic:
mosquitto_sub -h localhost -p 1883 -t "/wimp/v1/presence"

# Should see JSON presence messages every 10 seconds:
{"publicKey":"abc...","username":"Alice","timestamp":1234567890,"version":"1.0"}
```

## Success Checklist

- [ ] Software identity created without errors
- [ ] Signature verification passes (or no errors in console)
- [ ] MQTT connects to broker
- [ ] Presence announced to `/wimp/v1/presence` topic
- [ ] Network peers discovered on other device
- [ ] Messages sent and received between peers
- [ ] Hardware integrated (if using ESP32)
- [ ] Hardware public key visible in presence (if using ESP32)

## Next Steps

If all tests pass:
1. ✅ Signature verification is fixed
2. ✅ Network key sharing is working
3. ✅ Device discovery is automatic

You can now:
- Deploy to real server
- Add more peers to the network
- Implement device-specific features
- Add hardware-based trust verification

## Still Stuck?

Check these files for reference implementations:
- [src/tests/protocolTests.ts](src/tests/protocolTests.ts) - Unit tests
- [src/tests/mqttSimulation.ts](src/tests/mqttSimulation.ts) - MQTT flow simulation
- [FIRMWARE_FIX_EXPLANATION.md](FIRMWARE_FIX_EXPLANATION.md) - Deep dive into the fix
- [NETWORK_KEY_SHARING.md](NETWORK_KEY_SHARING.md) - Complete architecture guide
