/**
 * MQTT Transport Client
 * 
 * Browser-based MQTT client using mqtt.js over WebSocket.
 * The MQTT broker is treated as UNTRUSTED – it only relays
 * opaque encrypted packets. All security verification happens client-side.
 * 
 * Default broker: ws://localhost:9001 (local Mosquitto with WS support)
 */

import mqtt, { MqttClient, IClientOptions } from "mqtt";
import { getInboxTopic } from "./topicManager";

// ── Types ──────────────────────────────────────────────────────────────

export interface MQTTConfig {
  brokerUrl: string;
  clientId: string;
  onMessage: (topic: string, payload: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onError: (error: Error) => void;
}

export interface MQTTConnection {
  client: MqttClient;
  connected: boolean;
  subscribedTopics: Set<string>;
}

// ── Constants ──────────────────────────────────────────────────────────

export const DEFAULT_BROKER_URL = "wss://broker.hivemq.com:8884/mqtt";

// ── Connection Management ──────────────────────────────────────────────

/**
 * Connect to the MQTT broker over WebSocket.
 */
export function connectBroker(config: MQTTConfig): MQTTConnection {
  const options: IClientOptions = {
    clientId: config.clientId,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    // No authentication – broker is untrusted relay
  };

  const client = mqtt.connect(config.brokerUrl, options);
  const connection: MQTTConnection = {
    client,
    connected: false,
    subscribedTopics: new Set(),
  };

  client.on("connect", () => {
    connection.connected = true;
    config.onConnect();
  });

  client.on("message", (topic: string, payload: Buffer) => {
    const message = payload.toString("utf-8");
    config.onMessage(topic, message);
  });

  client.on("close", () => {
    connection.connected = false;
    config.onDisconnect();
  });

  client.on("error", (err: Error) => {
    config.onError(err);
  });

  client.on("offline", () => {
    connection.connected = false;
  });

  return connection;
}

/**
 * Subscribe to our inbox topic based on public key hash.
 */
export function subscribeInbox(
  connection: MQTTConnection,
  publicKeyHex: string
): void {
  const topic = getInboxTopic(publicKeyHex);

  if (connection.subscribedTopics.has(topic)) return;

  connection.client.subscribe(topic, { qos: 1 }, (err) => {
    if (err) {
      console.error(`Failed to subscribe to ${topic}:`, err);
    } else {
      connection.subscribedTopics.add(topic);
      console.log(`Subscribed to inbox: ${topic}`);
    }
  });
}

/**
 * Publish an encrypted packet to a receiver's inbox topic.
 */
export function publishPacket(
  connection: MQTTConnection,
  receiverPublicKeyHex: string,
  serializedPacket: string
): void {
  if (!connection.connected) {
    throw new Error("MQTT not connected");
  }

  const topic = getInboxTopic(receiverPublicKeyHex);

  connection.client.publish(topic, serializedPacket, { qos: 1 }, (err) => {
    if (err) {
      console.error(`Failed to publish to ${topic}:`, err);
    }
  });
}

/**
 * Unsubscribe from a topic.
 */
export function unsubscribeTopic(
  connection: MQTTConnection,
  topic: string
): void {
  connection.client.unsubscribe(topic, (err) => {
    if (err) {
      console.error(`Failed to unsubscribe from ${topic}:`, err);
    } else {
      connection.subscribedTopics.delete(topic);
    }
  });
}

/**
 * Disconnect from the MQTT broker.
 */
export function disconnectBroker(connection: MQTTConnection): void {
  connection.client.end(true);
  connection.connected = false;
  connection.subscribedTopics.clear();
}
