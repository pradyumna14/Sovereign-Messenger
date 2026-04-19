/**
 * SecurityStatusPanel Component
 * 
 * Displays real-time security status:
 * - Signature verification state
 * - Chain lineage integrity
 * - Key rotation state
 * - MQTT connection status
 */

import React from "react";
import type { HardwareIdentityState } from "../hooks/useHardwareIdentity";
import type { TransportState } from "../transport/types";
import type { ChatState } from "../chat/chatReducer";

interface Props {
  identity: HardwareIdentityState;
  mqtt: TransportState;
  chat: ChatState;
}

interface StatusItem {
  label: string;
  status: "ok" | "warn" | "error" | "off";
  detail: string;
}

export default function SecurityStatusPanel({ identity, mqtt, chat }: Props) {
  const items: StatusItem[] = [
    {
      label: "Identity",
      status: identity.connected ? "ok" : "off",
      detail: identity.connected
        ? `${identity.mode === "hardware" ? "ESP32" : "Software"} – Day ${identity.identity?.currentDay || "?"}`
        : "Not connected",
    },
    {
      label: "Transport",
      status: mqtt.connected ? "ok" : mqtt.error ? "error" : "off",
      detail: mqtt.connected
        ? mqtt.brokerUrl?.startsWith("local://")
          ? `Demo Mode – ${mqtt.subscribedTopics.length} topic(s)`
          : `MQTT – ${mqtt.subscribedTopics.length} topic(s)`
        : mqtt.error || "Disconnected",
    },
    {
      label: "Signatures",
      status: chat.messages.length === 0
        ? "off"
        : chat.messages.every((m) => m.signatureValid)
        ? "ok"
        : "error",
      detail: chat.messages.length === 0
        ? "No messages"
        : `${chat.messages.filter((m) => m.signatureValid).length}/${chat.messages.length} verified`,
    },
    {
      label: "Chain",
      status: chat.messages.length === 0
        ? "off"
        : chat.messages.every((m) => m.chainValid)
        ? "ok"
        : "warn",
      detail: chat.messages.length === 0
        ? "No messages"
        : chat.messages.every((m) => m.chainValid)
        ? "All links intact"
        : "Lineage break detected",
    },
    {
      label: "Key Rotation",
      status: identity.lastRotation ? "ok" : "off",
      detail: identity.lastRotation
        ? `Rotated at ${new Date(identity.lastRotation.rotationTimestamp).toLocaleTimeString()}`
        : "No rotation yet",
    },
    {
      label: "Active Alerts",
      status: chat.alerts.length === 0 ? "ok" : "warn",
      detail: `${chat.alerts.length} alert(s)`,
    },
  ];

  const statusColor = (s: StatusItem["status"]) => {
    switch (s) {
      case "ok": return "bg-sovereign-accent";
      case "warn": return "bg-sovereign-warn";
      case "error": return "bg-sovereign-danger";
      case "off": return "bg-sovereign-muted";
    }
  };

  return (
    <div className="bg-sovereign-panel border border-sovereign-border rounded-lg p-4">
      <h2 className="text-sm font-semibold text-sovereign-accent uppercase tracking-wider mb-3">
        🛡️ Security Status
      </h2>

      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor(item.status)}`} />
            <span className="text-xs font-medium text-sovereign-text w-20">
              {item.label}
            </span>
            <span className="text-xs text-sovereign-muted truncate">
              {item.detail}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
