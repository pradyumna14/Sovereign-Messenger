/**
 * Peer Discovery Service
 * 
 * Solves the "how do I find other users without copy-pasting keys?" problem.
 * 
 * In real-world messaging:
 *   - Signal uses phone numbers → server lookup
 *   - Matrix uses @user:server handles → federation
 *   - AirDrop uses BLE + WiFi → nearby discovery
 * 
 * For Sovereign Messenger, we implement THREE discovery mechanisms:
 * 
 * 1. **Presence Broadcasting** (automatic)
 *    Uses BroadcastChannel to announce identity across browser tabs.
 *    Other tabs on the same origin automatically discover peers.
 *    Simulates what a real DHT/mDNS/MQTT presence topic would do.
 * 
 * 2. **Invite Links** (manual but easy)
 *    Generate a URL like: localhost:3000?invite=<base64({pk,username})>
 *    Share it — the receiver clicks it and the contact is auto-added.
 *    Real-world equivalent: QR codes, NFC tap, shareable links.
 * 
 * 3. **MQTT Presence Topic** (networked)
 *    In MQTT mode, publish to /wimp/v1/presence with identity info.
 *    Other MQTT clients subscribe and auto-discover peers.
 * 
 * Security note: Presence only shares the PUBLIC key + username.
 * No private keys or secrets are ever transmitted.
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface DiscoveredPeer {
  publicKey: string;
  username: string;
  firstSeen: number;
  lastSeen: number;
  source: "broadcast" | "invite" | "mqtt" | "manual";
}

export interface PresenceAnnouncement {
  type: "presence";
  publicKey: string;
  username: string;
  timestamp: number;
}

export interface PresenceGoodbye {
  type: "goodbye";
  publicKey: string;
}

type PresenceMessage = PresenceAnnouncement | PresenceGoodbye;

export type PeerChangeCallback = (peers: DiscoveredPeer[]) => void;

// ── Constants ──────────────────────────────────────────────────────────

const BROADCAST_CHANNEL_NAME = "sovereign-messenger-presence";
const PRESENCE_INTERVAL_MS = 5_000;   // Re-announce every 5s
const STALE_TIMEOUT_MS = 15_000;      // Peer considered offline after 15s
const CLEANUP_INTERVAL_MS = 10_000;   // Prune stale peers every 10s

// ── Invite Link Encoding ───────────────────────────────────────────────

export function encodeInviteLink(publicKey: string, username: string): string {
  const payload = JSON.stringify({ pk: publicKey, u: username });
  const encoded = btoa(payload);
  // Use current origin for the URL
  const base = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  return `${base}?invite=${encodeURIComponent(encoded)}`;
}

export function decodeInviteLink(url: string): { publicKey: string; username: string } | null {
  try {
    const u = new URL(url);
    const invite = u.searchParams.get("invite");
    if (!invite) return null;
    const json = atob(decodeURIComponent(invite));
    const data = JSON.parse(json);
    if (data.pk && data.u) {
      return { publicKey: data.pk, username: data.u };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse invite from current page URL (for auto-adding contacts on page load).
 */
export function parseInviteFromCurrentURL(): { publicKey: string; username: string } | null {
  if (typeof window === "undefined") return null;
  return decodeInviteLink(window.location.href);
}

// ── Peer Discovery Service ─────────────────────────────────────────────

export class PeerDiscoveryService {
  private peers = new Map<string, DiscoveredPeer>();
  private channel: BroadcastChannel | null = null;
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private onChange: PeerChangeCallback | null = null;

  private myPublicKey: string | null = null;
  private myUsername: string | null = null;

  /**
   * Start the discovery service with our own identity.
   * Begins broadcasting presence and listening for peers.
   */
  start(publicKey: string, username: string, onChange: PeerChangeCallback): void {
    this.myPublicKey = publicKey;
    this.myUsername = username;
    this.onChange = onChange;

    // Open BroadcastChannel for cross-tab discovery
    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        this.channel.onmessage = (event) => {
          this.handlePresenceMessage(event.data as PresenceMessage);
        };
      } catch {
        // BroadcastChannel not available
      }
    }

    // Announce immediately, then periodically
    this.announce();
    this.announceTimer = setInterval(() => this.announce(), PRESENCE_INTERVAL_MS);

    // Start stale peer cleanup
    this.cleanupTimer = setInterval(() => this.cleanupStale(), CLEANUP_INTERVAL_MS);

    // Check URL for invite link on start
    const invite = parseInviteFromCurrentURL();
    if (invite && invite.publicKey !== publicKey) {
      this.addPeer(invite.publicKey, invite.username, "invite");
      // Clean the invite param from URL without reload
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("invite");
        window.history.replaceState({}, "", url.toString());
      }
    }
  }

  /**
   * Stop broadcasting and clean up.
   */
  stop(): void {
    // Send goodbye
    if (this.channel && this.myPublicKey) {
      try {
        const goodbye: PresenceGoodbye = {
          type: "goodbye",
          publicKey: this.myPublicKey,
        };
        this.channel.postMessage(goodbye);
      } catch { /* ignore */ }
    }

    if (this.announceTimer) clearInterval(this.announceTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);

    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }

    this.peers.clear();
    this.myPublicKey = null;
    this.myUsername = null;
    this.onChange = null;
  }

  /**
   * Manually add a peer (from invite link, manual entry, etc.)
   */
  addPeer(publicKey: string, username: string, source: DiscoveredPeer["source"] = "manual"): void {
    // Don't add ourselves
    if (publicKey === this.myPublicKey) return;

    const existing = this.peers.get(publicKey);
    if (existing) {
      existing.lastSeen = Date.now();
      existing.username = username; // Update in case it changed
    } else {
      this.peers.set(publicKey, {
        publicKey,
        username,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        source,
      });
    }
    this.notifyChange();
  }

  /**
   * Get the current peer list snapshot.
   */
  getPeers(): DiscoveredPeer[] {
    return Array.from(this.peers.values());
  }

  /**
   * Integrate network peers from MQTT presence (called when MQTT peers change).
   * Merges network peers with existing peers, favoring existing peer data.
   */
  updateNetworkPeers(networkPeers: Array<{ publicKey: string; username: string }>): void {
    for (const peer of networkPeers) {
      // Skip ourselves
      if (peer.publicKey === this.myPublicKey) continue;

      const existing = this.peers.get(peer.publicKey);
      if (existing) {
        // Update last seen and username
        existing.lastSeen = Date.now();
        existing.username = peer.username;
        // Upgrade source if it was manual, but keep mqtt/broadcast
        if (existing.source === "manual") {
          existing.source = "mqtt";
        }
      } else {
        // New peer from network
        this.addPeer(peer.publicKey, peer.username, "mqtt");
      }
    }
  }

  /**
   * Generate an invite link for our identity.
   */
  getInviteLink(): string | null {
    if (!this.myPublicKey || !this.myUsername) return null;
    return encodeInviteLink(this.myPublicKey, this.myUsername);
  }

  // ── Private ──

  private announce(): void {
    if (!this.channel || !this.myPublicKey || !this.myUsername) return;

    try {
      const msg: PresenceAnnouncement = {
        type: "presence",
        publicKey: this.myPublicKey,
        username: this.myUsername,
        timestamp: Date.now(),
      };
      this.channel.postMessage(msg);
    } catch { /* ignore */ }
  }

  private handlePresenceMessage(msg: PresenceMessage): void {
    if (!msg || !msg.type) return;

    if (msg.type === "presence") {
      const ann = msg as PresenceAnnouncement;
      // Ignore our own announcements
      if (ann.publicKey === this.myPublicKey) return;
      this.addPeer(ann.publicKey, ann.username, "broadcast");
    } else if (msg.type === "goodbye") {
      const bye = msg as PresenceGoodbye;
      if (this.peers.has(bye.publicKey)) {
        this.peers.delete(bye.publicKey);
        this.notifyChange();
      }
    }
  }

  private cleanupStale(): void {
    const now = Date.now();
    let changed = false;
    for (const [pk, peer] of this.peers) {
      // Only remove broadcast-discovered peers (invite/manual peers persist)
      if (peer.source === "broadcast" && now - peer.lastSeen > STALE_TIMEOUT_MS) {
        this.peers.delete(pk);
        changed = true;
      }
    }
    if (changed) this.notifyChange();
  }

  private notifyChange(): void {
    if (this.onChange) {
      this.onChange(this.getPeers());
    }
  }
}
