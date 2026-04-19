/**
 * MessageComposer Component
 * 
 * Input area for composing and sending encrypted messages.
 * Includes TTL (time-to-live) selector for temporal message expiration.
 */

import React, { useState, useCallback } from "react";

interface Props {
  onSend: (plaintext: string, expiryMs: number) => Promise<void>;
  disabled: boolean;
  contactLabel: string | null;
}

const TTL_OPTIONS = [
  { label: "30s", value: 30_000 },
  { label: "1m", value: 60_000 },
  { label: "5m", value: 300_000 },
  { label: "15m", value: 900_000 },
  { label: "1h", value: 3_600_000 },
  { label: "24h", value: 86_400_000 },
];

export default function MessageComposer({ onSend, disabled, contactLabel }: Props) {
  const [text, setText] = useState("");
  const [ttl, setTtl] = useState(300_000); // default 5 minutes
  const [sending, setSending] = useState(false);

  const handleSend = useCallback(async () => {
    if (!text.trim() || sending) return;

    setSending(true);
    try {
      await onSend(text.trim(), ttl);
      setText("");
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setSending(false);
    }
  }, [text, ttl, onSend, sending]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="bg-sovereign-panel border border-sovereign-border rounded-lg p-3">
      {/* TTL Selector */}
      <div className="flex items-center gap-1 mb-2">
        <span className="text-[10px] text-sovereign-muted uppercase mr-1">TTL:</span>
        {TTL_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTtl(opt.value)}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
              ttl === opt.value
                ? "bg-sovereign-accent/20 text-sovereign-accent border border-sovereign-accent/30"
                : "bg-sovereign-bg text-sovereign-muted hover:text-sovereign-text"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Input Area */}
      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={
            disabled
              ? "Connect identity and select contact to start..."
              : `Message ${contactLabel || "peer"}... (Enter to send)`
          }
          rows={2}
          className="flex-1 bg-sovereign-bg border border-sovereign-border rounded px-3 py-2
                     text-sm text-sovereign-text placeholder-sovereign-muted
                     focus:outline-none focus:border-sovereign-accent resize-none
                     disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim() || sending}
          className="px-4 py-2 bg-sovereign-accent text-sovereign-bg font-semibold
                     rounded hover:bg-sovereign-accent/80 transition-colors text-sm
                     disabled:opacity-30 disabled:cursor-not-allowed self-end"
        >
          {sending ? "⏳" : "Send"}
        </button>
      </div>
    </div>
  );
}
