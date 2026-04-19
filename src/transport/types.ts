/**
 * Transport Types
 * 
 * Shared types for both MQTT and local transport layers.
 * Enables components to accept either transport without caring about the implementation.
 */

export interface TransportState {
  connected: boolean;
  brokerUrl: string;
  subscribedTopics: string[];
  error: string | null;
  messageCount: number;
}

export interface TransportActions {
  connect: (brokerUrl?: string) => void;
  subscribe: (publicKeyHex: string) => void;
  publish: (receiverPublicKeyHex: string, serializedPacket: string) => void;
  disconnect: () => void;
}
