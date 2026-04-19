/**
 * ChatWindow Component
 * 
 * Displays the message conversation with verification status indicators.
 * Messages show:
 * - Plaintext content
 * - Signature verification status (✓ / ✗)
 * - Chain lineage status
 * - Time-to-live countdown
 */

import React, { useEffect, useRef } from "react";
import type { ChatMessage, Alert } from "../chat/chatReducer";

interface Props {
  messages: ChatMessage[];
  alerts: Alert[];
  myPublicKey: string | null;
}

export default function ChatWindow({ messages, alerts, myPublicKey }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, alerts.length]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const getTimeRemaining = (expiry: number) => {
    const remaining = expiry - Date.now();
    if (remaining <= 0) return "EXPIRED";
    const seconds = Math.floor(remaining / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  return (
    <div className="bg-sovereign-panel border border-sovereign-border rounded-lg flex flex-col h-full">
      <div className="px-4 py-2 border-b border-sovereign-border">
        <h2 className="text-sm font-semibold text-sovereign-accent uppercase tracking-wider">
          💬 Messages
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {/* Alerts */}
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`px-3 py-2 rounded text-xs border ${
              alert.type === "error"
                ? "bg-sovereign-danger/10 border-sovereign-danger/30 text-sovereign-danger"
                : alert.type === "warning"
                ? "bg-sovereign-warn/10 border-sovereign-warn/30 text-sovereign-warn"
                : "bg-sovereign-accent/10 border-sovereign-accent/30 text-sovereign-accent"
            }`}
          >
            <span className="font-semibold uppercase mr-1">[{alert.type}]</span>
            {alert.message}
          </div>
        ))}

        {/* Messages */}
        {messages.length === 0 && alerts.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sovereign-muted text-sm italic">
              No messages yet. Send one to begin.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.direction === "sent" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 ${
                  msg.direction === "sent"
                    ? "bg-sovereign-accent/15 border border-sovereign-accent/25"
                    : "bg-sovereign-bg border border-sovereign-border"
                }`}
              >
                {/* Message Text */}
                <p className="text-sm text-sovereign-text break-words">
                  {msg.plaintext || "[encrypted]"}
                </p>

                {/* Status Bar */}
                <div className="flex items-center gap-2 mt-1.5 text-[10px]">
                  {/* Time */}
                  <span className="text-sovereign-muted">
                    {formatTime(msg.timestamp)}
                  </span>

                  {/* Signature Status */}
                  <span
                    className={
                      msg.signatureValid
                        ? "text-sovereign-accent"
                        : "text-sovereign-danger"
                    }
                    title={msg.signatureValid ? "Signature verified" : "Signature INVALID"}
                  >
                    {msg.signatureValid ? "✓ SIG" : "✗ SIG"}
                  </span>

                  {/* Chain Status */}
                  <span
                    className={
                      msg.chainValid
                        ? "text-sovereign-accent"
                        : "text-sovereign-warn"
                    }
                    title={msg.chainValid ? "Chain intact" : "Chain broken"}
                  >
                    {msg.chainValid ? "⛓ OK" : "⛓ BREAK"}
                  </span>

                  {/* TTL */}
                  <span className="text-sovereign-muted" title="Time remaining">
                    ⏱ {getTimeRemaining(msg.packet.expiry)}
                  </span>

                  {/* Direction */}
                  <span className="text-sovereign-muted">
                    {msg.direction === "sent" ? "↗" : "↙"}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
