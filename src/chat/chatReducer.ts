/**
 * Chat Reducer – State management for the messaging system
 * 
 * Implements a reducer-based architecture for handling:
 * - New incoming/outgoing messages
 * - Invalid message detection
 * - Chain lineage errors
 * - Temporal message expiration (shredding)
 * 
 * State is held entirely in memory – nothing persists to disk.
 */

import { type WIMPPacket } from "../protocol/wimpPacket";

// ── Types ──────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;                 // unique message ID
  packet: WIMPPacket;         // the raw WIMP packet
  plaintext: string | null;   // decrypted content (null if not yet decrypted)
  direction: "sent" | "received";
  signatureValid: boolean;
  chainValid: boolean;
  expired: boolean;
  timestamp: number;
}

export interface Alert {
  id: string;
  type: "warning" | "error" | "info";
  message: string;
  timestamp: number;
}

export interface ChatState {
  messages: ChatMessage[];
  lastHash: string | null;
  alerts: Alert[];
  contactPublicKey: string | null;  // current peer's public key
}

// ── Action Types ───────────────────────────────────────────────────────

export type ChatAction =
  | { type: "NEW_MESSAGE"; payload: ChatMessage }
  | { type: "INVALID_MESSAGE"; payload: { reason: string; packet: WIMPPacket } }
  | { type: "LINEAGE_BROKEN"; payload: { expected: string; actual: string; packetTimestamp: number } }
  | { type: "SHRED_EXPIRED"; payload: { messageIds: string[] } }
  | { type: "SET_CONTACT"; payload: { publicKey: string } }
  | { type: "UPDATE_LAST_HASH"; payload: { hash: string } }
  | { type: "CLEAR_ALERTS" }
  | { type: "RESET" };

// ── Initial State ──────────────────────────────────────────────────────

export const initialChatState: ChatState = {
  messages: [],
  lastHash: null,
  alerts: [],
  contactPublicKey: null,
};

// ── Reducer ────────────────────────────────────────────────────────────

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "NEW_MESSAGE": {
      return {
        ...state,
        messages: [...state.messages, action.payload],
      };
    }

    case "INVALID_MESSAGE": {
      const alert: Alert = {
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "error",
        message: `Invalid message rejected: ${action.payload.reason}`,
        timestamp: Date.now(),
      };
      return {
        ...state,
        alerts: [...state.alerts, alert],
      };
    }

    case "LINEAGE_BROKEN": {
      const alert: Alert = {
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "warning",
        message: `Chain lineage broken at ${new Date(action.payload.packetTimestamp).toISOString()}. Expected hash: ${action.payload.expected.slice(0, 12)}... Got: ${action.payload.actual.slice(0, 12)}...`,
        timestamp: Date.now(),
      };
      return {
        ...state,
        alerts: [...state.alerts, alert],
      };
    }

    case "SHRED_EXPIRED": {
      const idsToRemove = new Set(action.payload.messageIds);
      const remaining = state.messages.filter((m) => !idsToRemove.has(m.id));
      const shredded = state.messages.filter((m) => idsToRemove.has(m.id));

      // Clear plaintext from shredded messages before removal
      shredded.forEach((m) => {
        m.plaintext = null;
      });

      const alert: Alert = {
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "info",
        message: `${idsToRemove.size} expired message(s) shredded`,
        timestamp: Date.now(),
      };

      return {
        ...state,
        messages: remaining,
        alerts: [...state.alerts, alert],
      };
    }

    case "SET_CONTACT": {
      return {
        ...state,
        contactPublicKey: action.payload.publicKey,
      };
    }

    case "UPDATE_LAST_HASH": {
      return {
        ...state,
        lastHash: action.payload.hash,
      };
    }

    case "CLEAR_ALERTS": {
      return {
        ...state,
        alerts: [],
      };
    }

    case "RESET": {
      return { ...initialChatState };
    }

    default:
      return state;
  }
}

/**
 * Generate a unique message ID.
 */
export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
