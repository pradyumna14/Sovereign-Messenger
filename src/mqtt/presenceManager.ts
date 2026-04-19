/**
 * MQTT Presence Manager
 * 
 * Handles network-wide peer discovery via MQTT presence topic.
 * 
 * Topic: /wimp/v1/presence
 * 
 * Message format:
 * {
 *   "publicKey": "hex-encoded Ed25519/ECDSA public key",
 *   "hardwarePublicKey": "hex-encoded ESP32 SHA-256 public key (optional)",
 *   "username": "user display name",
 *   "timestamp": 1234567890,
 *   "version": "1.0"
 * }
 * 
 * All peers on the same MQTT broker receive presence announcements.
 * Public keys only - no private data is transmitted.
 */

import { MqttClient } from "mqtt";

// ── Types ──────────────────────────────────────────────────────────────

export interface PresenceInfo {
  publicKey: string;                    // Protocol public key (Ed25519/ECDSA)
  hardwarePublicKey?: string;           // Optional: Hardware anchor key (ESP32)
  hardwareUsername?: string;            // Optional: Hardware device username
  username: string;                     // Display username
  timestamp: number;
  version: string;
}

export interface DiscoveredNetworkPeer extends PresenceInfo {
  firstSeen: number;                    // When we first saw this peer
  lastSeen: number;                     // Last presence announcement
}

export type OnNetworkPeerCallback = (peers: DiscoveredNetworkPeer[]) => void;

// ── Constants ──────────────────────────────────────────────────────────

const PRESENCE_TOPIC = "/wimp/v1/presence";
const PRESENCE_VERSION = "1.0";
const ANNOUNCE_INTERVAL_MS = 10_000;   // Announce every 10 seconds
const STALE_TIMEOUT_MS = 30_000;       // Peer offline after 30 seconds
const CLEANUP_INTERVAL_MS = 15_000;    // Cleanup every 15 seconds

// ── MQTT Presence Manager ──────────────────────────────────────────────

export class MQTTPresenceManager {
  private client: MqttClient | null = null;
  private peers = new Map<string, DiscoveredNetworkPeer>();
  private myPresence: PresenceInfo | null = null;
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private onPeerChange: OnNetworkPeerCallback | null = null;

  /**
   * Initialize presence manager with MQTT client.
   */
  initialize(client: MqttClient, onPeerChange?: OnNetworkPeerCallback): void {
    this.client = client;
    if (onPeerChange) this.onPeerChange = onPeerChange;

    // Subscribe to presence topic
    this.client.subscribe(PRESENCE_TOPIC, { qos: 1 }, (err) => {
      if (err) {
        console.error(`[Presence] Failed to subscribe to ${PRESENCE_TOPIC}:`, err);
      } else {
        console.log(`[Presence] Subscribed to ${PRESENCE_TOPIC}`);
      }
    });

    // Handle incoming presence announcements
    this.client.on("message", (topic, payload) => {
      if (topic === PRESENCE_TOPIC) {
        this.handlePresenceMessage(payload.toString("utf-8"));
      }
    });
  }

  /**
   * Announce our presence to the network.
   * Call this after connecting or identity changes.
   */
  announcePresence(
    publicKey: string,
    username: string,
    options?: { hardwarePublicKey?: string; hardwareUsername?: string }
  ): void {
    if (!this.client) return;

    this.myPresence = {
      publicKey,
      hardwarePublicKey: options?.hardwarePublicKey,
      hardwareUsername: options?.hardwareUsername,
      username,
      timestamp: Date.now(),
      version: PRESENCE_VERSION,
    };

    // Announce immediately once
    this.publishPresence();

    // Then periodically
    if (this.announceTimer) clearInterval(this.announceTimer);
    this.announceTimer = setInterval(() => this.publishPresence(), ANNOUNCE_INTERVAL_MS);

    // Start cleanup timer if not already running
    if (!this.cleanupTimer) {
      this.cleanupTimer = setInterval(() => this.cleanupStalePeers(), CLEANUP_INTERVAL_MS);
    }
  }

  /**
   * Stop announcing presence.
   */
  stopAnnouncing(): void {
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
    this.myPresence = null;
  }

  /**
   * Get current list of discovered network peers.
   */
  getPeers(): DiscoveredNetworkPeer[] {
    return Array.from(this.peers.values());
  }

  /**
   * Cleanup - stop all timers and clear peers.
   */
  cleanup(): void {
    this.stopAnnouncing();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.peers.clear();
    this.client = null;
    this.onPeerChange = null;
  }

  // ── Private ────────────────────────────────────────────────────────

  private publishPresence(): void {
    if (!this.client || !this.myPresence) return;

    const message = JSON.stringify(this.myPresence);
    this.client.publish(PRESENCE_TOPIC, message, { qos: 1 }, (err) => {
      if (err) {
        console.error("[Presence] Failed to publish:", err);
      }
    });
  }

  private handlePresenceMessage(payload: string): void {
    try {
      const info = JSON.parse(payload) as PresenceInfo;

      // Validate required fields
      if (!info.publicKey || !info.username || typeof info.timestamp !== "number") {
        return;
      }

      // Don't add ourselves (check both public keys)
      if (
        this.myPresence &&
        (info.publicKey === this.myPresence.publicKey ||
          (info.hardwarePublicKey && info.hardwarePublicKey === this.myPresence.hardwarePublicKey))
      ) {
        return;
      }

      // Update or add peer
      const existing = this.peers.get(info.publicKey);
      if (existing) {
        existing.lastSeen = Date.now();
        existing.username = info.username;
        existing.hardwarePublicKey = info.hardwarePublicKey;
        existing.hardwareUsername = info.hardwareUsername;
      } else {
        this.peers.set(info.publicKey, {
          ...info,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
        });
      }

      this.notifyChange();
    } catch (err) {
      console.warn("[Presence] Failed to parse message:", err);
    }
  }

  private cleanupStalePeers(): void {
    const now = Date.now();
    let removed = false;

    for (const [key, peer] of this.peers.entries()) {
      if (now - peer.lastSeen > STALE_TIMEOUT_MS) {
        this.peers.delete(key);
        removed = true;
      }
    }

    if (removed) {
      this.notifyChange();
    }
  }

  private notifyChange(): void {
    if (this.onPeerChange) {
      this.onPeerChange(this.getPeers());
    }
  }
}
