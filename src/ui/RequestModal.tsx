/**
 * RequestModal Component
 *
 * Displays incoming connection requests as a modal popup.
 * User can accept or reject with a single click.
 */

import React, { useState } from "react";
import type { IncomingConnectionRequest } from "../discovery/connectionRequest";

interface Props {
  request: IncomingConnectionRequest | null;
  onAccept: (requestId: string) => void;
  onReject: (requestId: string) => void;
}

export default function RequestModal({ request, onAccept, onReject }: Props) {
  const [isLoading, setIsLoading] = useState(false);

  if (!request) {
    return null;
  }

  const handleAccept = async () => {
    setIsLoading(true);
    onAccept(request.id);
    // Modal will close when request is removed from state
    setIsLoading(false);
  };

  const handleReject = async () => {
    setIsLoading(true);
    onReject(request.id);
    // Modal will close when request is removed from state
    setIsLoading(false);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={() => handleReject()}
    >
      <div
        className="bg-sovereign-bg border border-sovereign-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4">
          <h2 className="text-lg font-bold text-sovereign-text">Connection Request</h2>
          <p className="text-xs text-sovereign-muted mt-1">
            {request.requesterUsername} wants to connect with you
          </p>
        </div>

        {/* Details */}
        <div className="bg-sovereign-panel/50 border border-sovereign-border/30 rounded px-3 py-2 mb-4 text-xs">
          <p className="text-sovereign-muted font-mono break-all">
            {request.requesterPublicKey.slice(0, 20)}...
          </p>
        </div>

        {/* Info */}
        <p className="text-xs text-sovereign-muted mb-6">
          Once you accept, you can start messaging each other directly.
        </p>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleReject}
            disabled={isLoading}
            className="flex-1 px-4 py-2 rounded text-xs font-medium transition-colors
                       bg-sobmitted/20 text-sovereign-muted hover:bg-red-900/30 hover:text-red-400
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Reject
          </button>
          <button
            onClick={handleAccept}
            disabled={isLoading}
            className="flex-1 px-4 py-2 rounded text-xs font-medium transition-colors
                       bg-green-900/30 text-green-400 hover:bg-green-800/40
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? "Processing..." : "Accept"}
          </button>
        </div>
      </div>
    </div>
  );
}
