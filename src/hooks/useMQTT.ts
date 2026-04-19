/**
 * useMQTT Hook
 * 
 * React hook for managing MQTT connection and message transport.
 * Handles connection lifecycle, topic subscriptions, and message routing.
 * Also supports presence broadcasting for peer discovery.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  connectBroker,
  subscribeInbox,
  publishPacket,
  disconnectBroker,
  DEFAULT_BROKER_URL,
  type MQTTConnection,
} from "../mqtt/mqttClient";
import { getInboxTopic } from "../mqtt/topicManager";
import { MQTTPresenceManager, type DiscoveredNetworkPeer } from "../mqtt/presenceManager";
import { v4 as uuidv4 } from "uuid";

// ── Types ──────────────────────────────────────────────────────────────

export interface MQTTState {
  connected: boolean;
  brokerUrl: string;
  subscribedTopics: string[];
  error: string | null;
  messageCount: number;
  networkPeers: DiscoveredNetworkPeer[];
}

export interface MQTTActions {
  connect: (brokerUrl?: string) => void;
  subscribe: (publicKeyHex: string) => void;
  publish: (receiverPublicKeyHex: string, serializedPacket: string) => void;
  announcePresence: (publicKey: string, username: string, options?: { hardwarePublicKey?: string; hardwareUsername?: string }) => void;
  stopPresence: () => void;
  disconnect: () => void;
}

export type MessageHandler = (topic: string, payload: string) => void;

// ── Hook ───────────────────────────────────────────────────────────────

export function useMQTT(
  onMessage: MessageHandler
): [MQTTState, MQTTActions] {
  const [state, setState] = useState<MQTTState>({
    connected: false,
    brokerUrl: DEFAULT_BROKER_URL,
    subscribedTopics: [],
    error: null,
    messageCount: 0,
    networkPeers: [],
  });

  const connectionRef = useRef<MQTTConnection | null>(null);
  const presenceRef = useRef<MQTTPresenceManager | null>(null);
  const onMessageRef = useRef(onMessage);

  // Keep callback ref up to date
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  // ── Connect ──
  const connect = useCallback((brokerUrl: string = DEFAULT_BROKER_URL) => {
    if (connectionRef.current?.connected) return;

    try {
      const connection = connectBroker({
        brokerUrl,
        clientId: `wimp-${uuidv4().slice(0, 8)}`,
        onMessage: (topic, payload) => {
          setState((s) => ({ ...s, messageCount: s.messageCount + 1 }));
          onMessageRef.current(topic, payload);
        },
        onConnect: () => {
          setState((s) => ({
            ...s,
            connected: true,
            brokerUrl,
            error: null,
          }));
          console.log("[MQTT] Connected to broker:", brokerUrl);

          // Initialize presence manager once connected
          if (!presenceRef.current) {
            presenceRef.current = new MQTTPresenceManager();
            presenceRef.current.initialize(connection.client, (peers) => {
              setState((s) => ({ ...s, networkPeers: peers }));
            });
          }
        },
        onDisconnect: () => {
          setState((s) => ({ ...s, connected: false }));
          console.log("[MQTT] Disconnected from broker");
        },
        onError: (error) => {
          setState((s) => ({ ...s, error: error.message }));
          console.error("[MQTT] Error:", error);
        },
      });

      connectionRef.current = connection;
    } catch (err) {
      setState((s) => ({
        ...s,
        error: `Connection failed: ${(err as Error).message}`,
      }));
    }
  }, []);

  // ── Subscribe ──
  const subscribe = useCallback((publicKeyHex: string) => {
    if (!connectionRef.current) return;

    subscribeInbox(connectionRef.current, publicKeyHex);
    const topic = getInboxTopic(publicKeyHex);
    setState((s) => ({
      ...s,
      subscribedTopics: s.subscribedTopics.includes(topic)
        ? s.subscribedTopics
        : [...s.subscribedTopics, topic],
    }));
  }, []);

  // ── Publish ──
  const publish = useCallback(
    (receiverPublicKeyHex: string, serializedPacket: string) => {
      if (!connectionRef.current) {
        throw new Error("MQTT not connected");
      }
      publishPacket(connectionRef.current, receiverPublicKeyHex, serializedPacket);
    },
    []
  );

  // ── Announce Presence ──
  const announcePresence = useCallback(
    (publicKey: string, username: string, options?: { hardwarePublicKey?: string; hardwareUsername?: string }) => {
      if (!presenceRef.current) {
        console.warn("[MQTT] Presence manager not initialized");
        return;
      }
      presenceRef.current.announcePresence(publicKey, username, options);
    },
    []
  );

  // ── Stop Presence ──
  const stopPresence = useCallback(() => {
    if (presenceRef.current) {
      presenceRef.current.stopAnnouncing();
    }
  }, []);

  // ── Disconnect ──
  const disconnect = useCallback(() => {
    if (presenceRef.current) {
      presenceRef.current.cleanup();
      presenceRef.current = null;
    }
    if (connectionRef.current) {
      disconnectBroker(connectionRef.current);
      connectionRef.current = null;
    }
    setState({
      connected: false,
      brokerUrl: DEFAULT_BROKER_URL,
      subscribedTopics: [],
      error: null,
      messageCount: 0,
      networkPeers: [],
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (presenceRef.current) {
        presenceRef.current.cleanup();
      }
      if (connectionRef.current) {
        disconnectBroker(connectionRef.current);
      }
    };
  }, []);

  return [state, { connect, subscribe, publish, announcePresence, stopPresence, disconnect }];
}
