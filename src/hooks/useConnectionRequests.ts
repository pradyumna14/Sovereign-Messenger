/**
 * useConnectionRequests — React hook for managing connection requests
 *
 * Wraps ConnectionRequestService and provides:
 *   - sendRequest(): initiate a connection request
 *   - acceptRequest(): accept an incoming request
 *   - rejectRequest(): reject an incoming request
 *   - incomingRequests: array of pending incoming requests
 *   - outgoingRequests: array of pending outgoing requests
 *
 * Usage:
 *   const { incomingRequests, sendRequest, acceptRequest } = 
 *     useConnectionRequests(publicKey, username);
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ConnectionRequestService,
  IncomingConnectionRequest,
  OutgoingConnectionRequest,
} from "../discovery/connectionRequest";

interface UseConnectionRequestsOptions {
  publicKey: string | null;
  username: string;
}

interface UseConnectionRequestsReturn {
  incomingRequests: IncomingConnectionRequest[];
  outgoingRequests: OutgoingConnectionRequest[];
  sendRequest: (recipientPublicKey: string, recipientUsername: string) => void;
  acceptRequest: (requestId: string) => void;
  rejectRequest: (requestId: string) => void;
  hasExistingRequest: (publicKey: string) => boolean;
}

export function useConnectionRequests({
  publicKey,
  username,
}: UseConnectionRequestsOptions): UseConnectionRequestsReturn {
  const [incomingRequests, setIncomingRequests] = useState<IncomingConnectionRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<OutgoingConnectionRequest[]>([]);
  const serviceRef = useRef<ConnectionRequestService | null>(null);

  // Initialize service when publicKey is available
  useEffect(() => {
    if (!publicKey) {
      return;
    }

    const service = new ConnectionRequestService();

    service.initialize(
      publicKey,
      (incomingRequest) => {
        // Update incoming requests when received
        setIncomingRequests((prev) => {
          // Check if we already have this request
          if (prev.find((r) => r.id === incomingRequest.id)) {
            return prev;
          }
          return [...prev, incomingRequest];
        });
      },
      (requestId) => {
        // Update outgoing request status to accepted
        setOutgoingRequests((prev) =>
          prev.map((r) => (r.id === requestId ? { ...r, status: "accepted" } : r))
        );
      },
      (requestId) => {
        // Update outgoing request status to rejected
        setOutgoingRequests((prev) =>
          prev.map((r) => (r.id === requestId ? { ...r, status: "rejected" } : r))
        );
      }
    );

    serviceRef.current = service;

    return () => {
      service.stop();
      serviceRef.current = null;
    };
  }, [publicKey]);

  const sendRequest = useCallback(
    (recipientPublicKey: string, recipientUsername: string) => {
      if (serviceRef.current) {
        const requestId = serviceRef.current.sendRequest(
          recipientPublicKey,
          recipientUsername,
          username
        );

        // Update local state
        const newRequest: OutgoingConnectionRequest = {
          id: requestId,
          recipientPublicKey,
          recipientUsername,
          senderPublicKey: publicKey!,
          senderUsername: username,
          status: "pending",
          sentAt: Date.now(),
        };
        setOutgoingRequests((prev) => [...prev, newRequest]);
      }
    },
    [publicKey, username]
  );

  const acceptRequest = useCallback((requestId: string) => {
    if (serviceRef.current) {
      serviceRef.current.acceptRequest(requestId, username);

      // Update local state
      setIncomingRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, status: "accepted" } : r))
      );
    }
  }, [username]);

  const rejectRequest = useCallback((requestId: string) => {
    if (serviceRef.current) {
      serviceRef.current.rejectRequest(requestId);

      // Update local state
      setIncomingRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, status: "rejected" } : r))
      );
    }
  }, []);

  const hasExistingRequest = useCallback(
    (pk: string): boolean => {
      if (serviceRef.current) {
        return serviceRef.current.hasExistingRequest(pk);
      }
      return false;
    },
    []
  );

  return {
    incomingRequests,
    outgoingRequests,
    sendRequest,
    acceptRequest,
    rejectRequest,
    hasExistingRequest,
  };
}
