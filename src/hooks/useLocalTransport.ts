/**
 * useLocalTransport Hook
 * 
 * Drop-in replacement for useMQTT that uses the local message bus.
 * Enables full messaging demo without any external broker.
 * 
 * API is compatible with MQTTState / MQTTActions so the main page
 * can switch between real MQTT and local transport seamlessly.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { getLocalBus } from "../transport/localBus";
import { getInboxTopic } from "../mqtt/topicManager";

// Re-use the same types for compatibility
export interface LocalTransportState {
  connected: boolean;
  brokerUrl: string;
  subscribedTopics: string[];
  error: string | null;
  messageCount: number;
}

export interface LocalTransportActions {
  connect: (brokerUrl?: string) => void;
  subscribe: (publicKeyHex: string) => void;
  publish: (receiverPublicKeyHex: string, serializedPacket: string) => void;
  disconnect: () => void;
}

export type MessageHandler = (topic: string, payload: string) => void;

export function useLocalTransport(
  onMessage: MessageHandler
): [LocalTransportState, LocalTransportActions] {
  const [state, setState] = useState<LocalTransportState>({
    connected: false,
    brokerUrl: "local://in-browser",
    subscribedTopics: [],
    error: null,
    messageCount: 0,
  });

  const subscriptionIds = useRef<string[]>([]);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const connect = useCallback((_brokerUrl?: string) => {
    // Local bus is always "connected" — just flip the flag
    setState((s) => ({
      ...s,
      connected: true,
      error: null,
      brokerUrl: "local://in-browser",
    }));
    console.log("[LocalTransport] Connected (in-browser message bus)");
  }, []);

  const subscribe = useCallback((publicKeyHex: string) => {
    const bus = getLocalBus();
    const topic = getInboxTopic(publicKeyHex);

    // Avoid duplicate subscriptions
    if (state.subscribedTopics.includes(topic)) return;

    const subId = bus.subscribe(topic, (t, payload) => {
      setState((s) => ({ ...s, messageCount: s.messageCount + 1 }));
      onMessageRef.current(t, payload);
    });

    subscriptionIds.current.push(subId);
    setState((s) => ({
      ...s,
      subscribedTopics: [...s.subscribedTopics, topic],
    }));

    console.log(`[LocalTransport] Subscribed to ${topic}`);
  }, [state.subscribedTopics]);

  const publish = useCallback(
    (receiverPublicKeyHex: string, serializedPacket: string) => {
      const bus = getLocalBus();
      const topic = getInboxTopic(receiverPublicKeyHex);
      bus.publish(topic, serializedPacket);
      console.log(`[LocalTransport] Published to ${topic}`);
    },
    []
  );

  const disconnect = useCallback(() => {
    const bus = getLocalBus();
    for (const id of subscriptionIds.current) {
      bus.unsubscribe(id);
    }
    subscriptionIds.current = [];
    setState({
      connected: false,
      brokerUrl: "local://in-browser",
      subscribedTopics: [],
      error: null,
      messageCount: 0,
    });
    console.log("[LocalTransport] Disconnected");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const bus = getLocalBus();
      for (const id of subscriptionIds.current) {
        bus.unsubscribe(id);
      }
    };
  }, []);

  return [state, { connect, subscribe, publish, disconnect }];
}
