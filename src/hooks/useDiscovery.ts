/**
 * useDiscovery — React hook for peer discovery.
 *
 * Wraps the PeerDiscoveryService and exposes:
 *   - discoveredPeers: live list of discovered peers
 *   - inviteLink: shareable invite URL for our identity
 *   - addPeerFromInvite(url): parse invite link and add peer
 *   - isActive: whether discovery is currently running
 *
 * Usage:
 *   const { discoveredPeers, inviteLink } = useDiscovery(identity, username);
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  PeerDiscoveryService,
  DiscoveredPeer,
  decodeInviteLink,
} from "../discovery/peerDiscovery";

interface UseDiscoveryOptions {
  /** The user's hex public key. If null, discovery won't start. */
  publicKey: string | null;
  /** The user's display name. */
  username: string;
  /** Auto-start discovery when publicKey is available. Default: true */
  autoStart?: boolean;
}

interface UseDiscoveryReturn {
  /** Currently discovered peers (live, auto-updates). */
  discoveredPeers: DiscoveredPeer[];
  /** Shareable invite link for our identity, or null if not active. */
  inviteLink: string | null;
  /** Whether discovery is currently broadcasting and listening. */
  isActive: boolean;
  /** Parse an invite link URL and add the peer. Returns true if valid. */
  addPeerFromInvite: (url: string) => boolean;
  /** Manually add a peer by public key and username. */
  addPeer: (publicKey: string, username: string) => void;
}

export function useDiscovery({
  publicKey,
  username,
  autoStart = true,
}: UseDiscoveryOptions): UseDiscoveryReturn {
  const [discoveredPeers, setDiscoveredPeers] = useState<DiscoveredPeer[]>([]);
  const [isActive, setIsActive] = useState(false);
  const serviceRef = useRef<PeerDiscoveryService | null>(null);

  // Start/stop the discovery service when identity changes
  useEffect(() => {
    if (!publicKey || !username || !autoStart) {
      // No identity yet — clean up if running
      if (serviceRef.current) {
        serviceRef.current.stop();
        serviceRef.current = null;
        setIsActive(false);
        setDiscoveredPeers([]);
      }
      return;
    }

    // Create and start the service
    const service = new PeerDiscoveryService();
    serviceRef.current = service;

    service.start(publicKey, username, (peers) => {
      setDiscoveredPeers([...peers]); // New array for React state
    });
    setIsActive(true);

    // Cleanup on unmount or identity change
    return () => {
      service.stop();
      serviceRef.current = null;
      setIsActive(false);
    };
  }, [publicKey, username, autoStart]);

  // Invite link derived from service
  const inviteLink = serviceRef.current?.getInviteLink() ?? null;

  // Add peer from invite link
  const addPeerFromInvite = useCallback(
    (url: string): boolean => {
      const decoded = decodeInviteLink(url);
      if (!decoded) return false;
      if (decoded.publicKey === publicKey) return false; // Can't add yourself
      if (serviceRef.current) {
        serviceRef.current.addPeer(decoded.publicKey, decoded.username, "invite");
      }
      return true;
    },
    [publicKey]
  );

  // Manual add peer
  const addPeer = useCallback(
    (pk: string, name: string): void => {
      if (serviceRef.current) {
        serviceRef.current.addPeer(pk, name, "manual");
      }
    },
    []
  );

  return {
    discoveredPeers,
    inviteLink,
    isActive,
    addPeerFromInvite,
    addPeer,
  };
}
