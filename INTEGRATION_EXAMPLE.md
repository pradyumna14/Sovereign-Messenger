/**
 * Integration Example: Network Key Sharing in index.tsx
 * 
 * Place this in your pages/index.tsx to enable network-wide peer discovery.
 * Shows where to add presence broadcasting and network peer integration.
 */

// ── Add these imports at the top ──
import { useEffect } from "react";
import type { DiscoveredNetworkPeer } from "../src/mqtt/presenceManager";

// ────────────────────────────────────────────────────────────────────────

// In the Home component, after the existing useEffect hooks, add:

export default function Home() {
  // ... existing code ...

  // ── After all existing useEffect blocks, add this: ──

  /**
   * Step 1: Announce presence when identity and MQTT are both ready
   * This broadcasts "who we are" to all peers on the network
   */
  useEffect(() => {
    if (
      identityState.connected &&
      identityState.identity &&
      transportMode === "mqtt" &&
      mqttState.connected
    ) {
      // Announce our presence with protocol key (required)
      // and hardware key (optional, only if connected to ESP32)
      mqttActions.announcePresence(
        identityState.identity.publicKey,  // Ed25519/ECDSA key for WIMP protocol
        identityState.deviceInfo?.username || "anonymous",
        {
          hardwarePublicKey: identityState.identity.hardwarePublicKey,  // ESP32 key (if available)
          hardwareUsername: identityState.identity.hardwareUsername,    // Device name (if available)
        }
      );
    }

    // Stop announcing when switching to demo mode
    return () => {
      if (transportMode === "demo") {
        mqttActions.stopPresence();
      }
    };
  }, [
    identityState.connected,
    identityState.identity,
    identityState.deviceInfo,
    transportMode,
    mqttState.connected,
    mqttActions,
  ]);

  /**
   * Step 2: Merge MQTT network peers with local discovery
   * This makes peers discovered over the network appear in your contacts list
   */
  useEffect(() => {
    if (transportMode === "mqtt" && mqttState.networkPeers.length > 0) {
      // Convert MQTT network peers to discovery format and merge
      const networkPeerData = mqttState.networkPeers.map((peer) => ({
        publicKey: peer.publicKey,
        username: peer.username,
      }));

      // Update the discovery service with network peers
      addDiscoveredPeer(networkPeerData);
    }
  }, [mqttState.networkPeers, transportMode]);

  /**
   * Step 3: Auto-subscribe to network peers' inboxes
   * This allows bi-directional messaging with discovered peers
   */
  useEffect(() => {
    // Subscribe to each discovered network peer's inbox
    // This allows them to send messages back to us
    if (transportMode === "mqtt" && mqttState.networkPeers.length > 0) {
      mqttState.networkPeers.forEach((peer) => {
        // Subscribe to their inbox so we can receive their messages
        transportActions.subscribe(peer.publicKey);
      });
    }
  }, [mqttState.networkPeers, transportMode, transportActions]);

  return (
    // ... rest of component ...
  );
}
