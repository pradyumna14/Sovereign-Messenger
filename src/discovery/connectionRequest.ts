/**
 * Connection Request Service
 *
 * Implements a two-way mutual connection request flow:
 *   1. User A discovers User B
 *   2. User A sends a connection request
 *   3. User B receives the request and gets a modal prompt
 *   4. If accepted, User B sends back an acceptance
 *   5. User A receives acceptance and adds contact
 *   6. Only after mutual acceptance do both parties add the contact
 *
 * Security: Requests include sender's public key so receiver can verify identity.
 * No private keys are exchanged.
 */

import { v4 as uuidv4 } from "uuid";

// ── Types ──────────────────────────────────────────────────────────────

export type ConnectionRequestStatus =
  | "pending"      // Waiting for response
  | "accepted"     // Accepted by recipient, mutual contact established
  | "rejected"     // Explicitly rejected
  | "cancelled";   // Cancelled by sender

export interface OutgoingConnectionRequest {
  id: string;                    // Unique request ID
  recipientPublicKey: string;
  recipientUsername: string;
  senderPublicKey: string;
  senderUsername: string;
  status: ConnectionRequestStatus;
  sentAt: number;
}

export interface IncomingConnectionRequest {
  id: string;
  requesterPublicKey: string;
  requesterUsername: string;
  recipientPublicKey: string;   // Our public key
  status: ConnectionRequestStatus;
  receivedAt: number;
}

// Message types exchanged over BroadcastChannel/MQTT

export interface ConnectionRequestMessage {
  type: "connection-request";
  id: string;
  fromPublicKey: string;
  fromUsername: string;
  timestamp: number;
}

export interface ConnectionAcceptedMessage {
  type: "connection-accepted";
  requestId: string;
  fromPublicKey: string;
  timestamp: number;
}

export interface ConnectionRejectedMessage {
  type: "connection-rejected";
  requestId: string;
  fromPublicKey: string;
  timestamp: number;
}

export type ConnectionMessage =
  | ConnectionRequestMessage
  | ConnectionAcceptedMessage
  | ConnectionRejectedMessage;

// Callbacks
export type OnIncomingRequestCallback = (request: IncomingConnectionRequest) => void;
export type OnRequestAcceptedCallback = (requestId: string) => void;
export type OnRequestRejectedCallback = (requestId: string) => void;

// ── Constants ──────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 30 * 1000;    // Clean up expired requests every 30s

// ── Connection Request Service ─────────────────────────────────────────

export class ConnectionRequestService {
  private outgoing = new Map<string, OutgoingConnectionRequest>();
  private incoming = new Map<string, IncomingConnectionRequest>();
  private ourPublicKey: string = "";
  private onIncomingRequest: OnIncomingRequestCallback | null = null;
  private onRequestAccepted: OnRequestAcceptedCallback | null = null;
  private onRequestRejected: OnRequestRejectedCallback | null = null;
  private channelName = "sovereign-messenger-requests";
  private broadcastChannel: BroadcastChannel | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Initialize with our public key and event callbacks
   */
  initialize(
    ourPublicKey: string,
    onIncomingRequest?: OnIncomingRequestCallback,
    onRequestAccepted?: OnRequestAcceptedCallback,
    onRequestRejected?: OnRequestRejectedCallback
  ) {
    this.ourPublicKey = ourPublicKey;
    if (onIncomingRequest) this.onIncomingRequest = onIncomingRequest;
    if (onRequestAccepted) this.onRequestAccepted = onRequestAccepted;
    if (onRequestRejected) this.onRequestRejected = onRequestRejected;

    // Set up BroadcastChannel for cross-tab request communication
    if (typeof BroadcastChannel !== "undefined") {
      this.broadcastChannel = new BroadcastChannel(this.channelName);
      this.broadcastChannel.onmessage = (event) =>
        this.handleBroadcastMessage(event.data);
    }

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => this.cleanupExpiredRequests(), CLEANUP_INTERVAL_MS);
  }

  /**
   * Send a connection request to a peer
   */
  sendRequest(recipientPublicKey: string, recipientUsername: string, senderUsername: string) {
    const requestId = uuidv4();
    const request: OutgoingConnectionRequest = {
      id: requestId,
      recipientPublicKey,
      recipientUsername,
      senderPublicKey: this.ourPublicKey,
      senderUsername,
      status: "pending",
      sentAt: Date.now(),
    };

    this.outgoing.set(requestId, request);

    // Broadcast the request
    const message: ConnectionRequestMessage = {
      type: "connection-request",
      id: requestId,
      fromPublicKey: this.ourPublicKey,
      fromUsername: senderUsername,
      timestamp: Date.now(),
    };

    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(message);
    }

    return requestId;
  }

  /**
   * Accept an incoming connection request
   */
  acceptRequest(requestId: string, responderUsername: string) {
    const request = this.incoming.get(requestId);
    if (!request) return;

    request.status = "accepted";

    // Send acceptance back
    const acceptMessage: ConnectionAcceptedMessage = {
      type: "connection-accepted",
      requestId,
      fromPublicKey: this.ourPublicKey,
      timestamp: Date.now(),
    };

    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(acceptMessage);
    }
  }

  /**
   * Reject an incoming connection request
   */
  rejectRequest(requestId: string) {
    const request = this.incoming.get(requestId);
    if (!request) return;

    request.status = "rejected";

    // Send rejection back
    const rejectMessage: ConnectionRejectedMessage = {
      type: "connection-rejected",
      requestId,
      fromPublicKey: this.ourPublicKey,
      timestamp: Date.now(),
    };

    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(rejectMessage);
    }
  }

  /**
   * Get all incoming requests
   */
  getIncomingRequests(): IncomingConnectionRequest[] {
    return Array.from(this.incoming.values());
  }

  /**
   * Get all outgoing requests
   */
  getOutgoingRequests(): OutgoingConnectionRequest[] {
    return Array.from(this.outgoing.values());
  }

  /**
   * Get pending incoming requests
   */
  getPendingIncomingRequests(): IncomingConnectionRequest[] {
    return Array.from(this.incoming.values()).filter((r) => r.status === "pending");
  }

  /**
   * Check if we already have a request with a peer (in either direction)
   */
  hasExistingRequest(publicKey: string): boolean {
    // Check outgoing
    for (const req of this.outgoing.values()) {
      if (req.recipientPublicKey === publicKey && req.status === "pending") {
        return true;
      }
    }
    // Check incoming
    for (const req of this.incoming.values()) {
      if (req.requesterPublicKey === publicKey && req.status === "pending") {
        return true;
      }
    }
    return false;
  }

  /**
   * Handle BroadcastChannel messages
   */
  private handleBroadcastMessage(data: ConnectionMessage) {
    if (data.type === "connection-request" && "fromPublicKey" in data) {
      const message = data as ConnectionRequestMessage;
      
      // Ignore our own messages
      if (message.fromPublicKey === this.ourPublicKey) return;

      // Check if we already have this request
      if (this.incoming.has(message.id)) return;

      const incomingRequest: IncomingConnectionRequest = {
        id: message.id,
        requesterPublicKey: message.fromPublicKey,
        requesterUsername: message.fromUsername,
        recipientPublicKey: this.ourPublicKey,
        status: "pending",
        receivedAt: Date.now(),
      };

      this.incoming.set(message.id, incomingRequest);

      // Notify app
      if (this.onIncomingRequest) {
        this.onIncomingRequest(incomingRequest);
      }
    } else if (data.type === "connection-accepted" && "requestId" in data) {
      const message = data as ConnectionAcceptedMessage;
      const outgoing = this.outgoing.get(message.requestId);

      if (outgoing) {
        outgoing.status = "accepted";
        if (this.onRequestAccepted) {
          this.onRequestAccepted(message.requestId);
        }
      }
    } else if (data.type === "connection-rejected" && "requestId" in data) {
      const message = data as ConnectionRejectedMessage;
      const outgoing = this.outgoing.get(message.requestId);

      if (outgoing) {
        outgoing.status = "rejected";
        if (this.onRequestRejected) {
          this.onRequestRejected(message.requestId);
        }
      }
    }
  }

  /**
   * Clean up expired/old requests
   */
  private cleanupExpiredRequests() {
    const now = Date.now();

    // Remove old pending outgoing requests (timeout after 5 min)
    for (const [id, req] of this.outgoing.entries()) {
      if (req.status === "pending" && now - req.sentAt > REQUEST_TIMEOUT_MS) {
        this.outgoing.delete(id);
      } else if (
        (req.status === "rejected" || req.status === "accepted" || req.status === "cancelled") &&
        now - req.sentAt > REQUEST_TIMEOUT_MS * 2
      ) {
        // Remove old completed requests after 10 min
        this.outgoing.delete(id);
      }
    }

    // Remove old incoming requests
    for (const [id, req] of this.incoming.entries()) {
      if (req.status === "pending" && now - req.receivedAt > REQUEST_TIMEOUT_MS) {
        this.incoming.delete(id);
      } else if (
        (req.status === "rejected" || req.status === "accepted") &&
        now - req.receivedAt > REQUEST_TIMEOUT_MS * 2
      ) {
        this.incoming.delete(id);
      }
    }
  }

  /**
   * Shutdown the service
   */
  stop() {
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
