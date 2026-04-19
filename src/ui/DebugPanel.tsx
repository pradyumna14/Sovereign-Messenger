/**
 * DebugPanel Component
 * 
 * Developer-facing panel showing raw protocol state:
 * - Current public key
 * - Subscribed MQTT topics
 * - Last message hash (chain tip)
 * - Packet verification results
 * - Raw packet inspector
 */

import React, { useState } from "react";
import type { HardwareIdentityState } from "../hooks/useHardwareIdentity";
import type { TransportState } from "../transport/types";
import type { ChatState } from "../chat/chatReducer";

interface Props {
  identity: HardwareIdentityState;
  mqtt: TransportState;
  chat: ChatState;
}

export default function DebugPanel({ identity, mqtt, chat }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [selectedMsg, setSelectedMsg] = useState<number | null>(null);

  return (
    <div className="bg-sovereign-panel border border-sovereign-border rounded-lg p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-sm font-semibold 
                   text-sovereign-accent uppercase tracking-wider"
      >
        <span>🐛 Debug Panel</span>
        <span className="text-xs">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 text-xs">
          {/* Public Key */}
          <Section title="Current Public Key">
            <code className="text-sovereign-accent break-all">
              {identity.identity?.publicKey || "—"}
            </code>
          </Section>

          {/* MQTT Topics */}
          <Section title="Subscribed MQTT Topics">
            {mqtt.subscribedTopics.length === 0 ? (
              <span className="text-sovereign-muted italic">None</span>
            ) : (
              <ul className="space-y-0.5">
                {mqtt.subscribedTopics.map((t) => (
                  <li key={t} className="font-mono text-sovereign-text">{t}</li>
                ))}
              </ul>
            )}
          </Section>

          {/* Chain State */}
          <Section title="Chain State">
            <div className="space-y-1">
              <div>
                <span className="text-sovereign-muted">Last Hash: </span>
                <code className="text-sovereign-text">
                  {chat.lastHash?.slice(0, 32) || "GENESIS"}...
                </code>
              </div>
              <div>
                <span className="text-sovereign-muted">Messages: </span>
                <span className="text-sovereign-text">{chat.messages.length}</span>
              </div>
              <div>
                <span className="text-sovereign-muted">MQTT Msgs Received: </span>
                <span className="text-sovereign-text">{mqtt.messageCount}</span>
              </div>
            </div>
          </Section>

          {/* Broker */}
          <Section title="MQTT Broker">
            <span className={mqtt.connected ? "text-sovereign-accent" : "text-sovereign-danger"}>
              {mqtt.brokerUrl} – {mqtt.connected ? "CONNECTED" : "DISCONNECTED"}
            </span>
            {mqtt.error && (
              <p className="text-sovereign-danger mt-1">{mqtt.error}</p>
            )}
          </Section>

          {/* Packet Inspector */}
          <Section title="Packet Inspector">
            {chat.messages.length === 0 ? (
              <span className="text-sovereign-muted italic">No packets</span>
            ) : (
              <div className="space-y-1">
                <div className="flex gap-1 flex-wrap">
                  {chat.messages.map((msg, i) => (
                    <button
                      key={msg.id}
                      onClick={() => setSelectedMsg(selectedMsg === i ? null : i)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                        selectedMsg === i
                          ? "bg-sovereign-accent/20 text-sovereign-accent"
                          : "bg-sovereign-bg text-sovereign-muted hover:text-sovereign-text"
                      }`}
                    >
                      #{i} {msg.direction === "sent" ? "↗" : "↙"}
                    </button>
                  ))}
                </div>

                {selectedMsg !== null && chat.messages[selectedMsg] && (
                  <div className="bg-sovereign-bg rounded p-2 mt-2 overflow-x-auto">
                    <pre className="text-[10px] text-sovereign-text whitespace-pre-wrap">
                      {JSON.stringify(
                        {
                          ...chat.messages[selectedMsg].packet,
                          _meta: {
                            direction: chat.messages[selectedMsg].direction,
                            sigValid: chat.messages[selectedMsg].signatureValid,
                            chainValid: chat.messages[selectedMsg].chainValid,
                          },
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* Alerts */}
          {chat.alerts.length > 0 && (
            <Section title="Alerts Log">
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {chat.alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`text-[10px] ${
                      alert.type === "error"
                        ? "text-sovereign-danger"
                        : alert.type === "warning"
                        ? "text-sovereign-warn"
                        : "text-sovereign-accent"
                    }`}
                  >
                    [{alert.type.toUpperCase()}] {alert.message}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[10px] text-sovereign-muted uppercase tracking-wider font-semibold">
        {title}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
