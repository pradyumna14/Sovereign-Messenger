/**
 * HardwareDebugPanel Component
 * 
 * Developer-facing panel for monitoring hardware device state:
 * - Serial I/O log (TX/RX) with timestamps
 * - Device info (username, public key, firmware)
 * - Nonce challenge test button
 * - Sign data test button
 * - WebSerial availability indicator
 */

import React, { useState, useEffect, useRef } from "react";
import type { HardwareIdentityState, HardwareIdentityActions } from "../hooks/useHardwareIdentity";
import type { SerialLogEntry } from "../hardware/deviceInterface";

interface Props {
  state: HardwareIdentityState;
  actions: HardwareIdentityActions;
}

export default function HardwareDebugPanel({ state, actions }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [serialLog, setSerialLog] = useState<SerialLogEntry[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [testSignResult, setTestSignResult] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-refresh serial log
  useEffect(() => {
    if (!expanded || !autoRefresh || !state.connected) return;

    const interval = setInterval(() => {
      const log = actions.getSerialLog();
      setSerialLog(log);
    }, 500);

    return () => clearInterval(interval);
  }, [expanded, autoRefresh, state.connected, actions]);

  // Scroll to bottom when new log entries appear
  useEffect(() => {
    if (logEndRef.current && autoRefresh) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [serialLog.length, autoRefresh]);

  const hasWebSerial = typeof navigator !== "undefined" && "serial" in navigator;

  const handleTestSign = async () => {
    setTestSignResult(null);
    const device = actions.getDevice();
    if (!device?.connected) {
      setTestSignResult("❌ No device connected");
      return;
    }

    try {
      const testData = new TextEncoder().encode("TEST_SIGN_DATA_" + Date.now());
      const sig = await device.signData(testData);
      setTestSignResult(`✅ Sig: ${sig.slice(0, 24)}...`);
    } catch (err) {
      setTestSignResult(`❌ ${(err as Error).message}`);
    }
    setTimeout(() => setTestSignResult(null), 5000);
  };

  const handleRefreshLog = () => {
    const log = actions.getSerialLog();
    setSerialLog(log);
  };

  const handleClearLog = () => {
    actions.clearSerialLog();
    setSerialLog([]);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d
      .getMinutes()
      .toString()
      .padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d
      .getMilliseconds()
      .toString()
      .padStart(3, "0")}`;
  };

  return (
    <div className="bg-sovereign-panel border border-sovereign-border rounded-lg p-4">
      <button
        onClick={() => {
          setExpanded(!expanded);
          if (!expanded) handleRefreshLog();
        }}
        className="flex items-center justify-between w-full text-sm font-semibold 
                   text-sovereign-accent uppercase tracking-wider"
      >
        <span>🔧 Hardware Debug</span>
        <span className="text-xs">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 text-xs">
          {/* WebSerial Status */}
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${hasWebSerial ? "bg-sovereign-accent" : "bg-sovereign-danger"}`} />
            <span className="text-sovereign-muted">
              WebSerial: {hasWebSerial ? "Available" : "Not Supported"}
            </span>
          </div>

          {/* Device Info */}
          {state.deviceInfo && (
            <Section title="Device Info">
              <div className="space-y-1 font-mono">
                <Row label="Username" value={state.deviceInfo.username} />
                <Row label="Mode" value={state.deviceInfo.mode} />
                <Row label="Connected" value={state.deviceInfo.connected ? "YES" : "NO"} />
                {state.deviceInfo.firmwareVersion && (
                  <Row label="Firmware" value={state.deviceInfo.firmwareVersion} />
                )}
                <Row label="Public Key" value={state.deviceInfo.publicKey.slice(0, 32) + "..."} />
              </div>
            </Section>
          )}

          {/* Last Challenge */}
          {state.lastChallenge && (
            <Section title="Last Nonce Challenge">
              <div className="space-y-1 font-mono">
                <Row label="Nonce" value={state.lastChallenge.nonce.slice(0, 24) + "..."} />
                <Row label="Signature" value={state.lastChallenge.signature.slice(0, 24) + "..."} />
                <Row label="Time" value={formatTime(state.lastChallenge.timestamp)} />
              </div>
            </Section>
          )}

          {/* Test Actions */}
          {state.connected && (
            <Section title="Test Actions">
              <div className="flex gap-2">
                <button
                  onClick={() => actions.performChallenge()}
                  className="flex-1 px-2 py-1 bg-sovereign-accent/20 text-sovereign-accent
                             border border-sovereign-accent/30 rounded text-[10px]
                             hover:bg-sovereign-accent/30 transition-colors"
                >
                  🎲 Nonce Challenge
                </button>
                <button
                  onClick={handleTestSign}
                  className="flex-1 px-2 py-1 bg-sovereign-warn/20 text-sovereign-warn
                             border border-sovereign-warn/30 rounded text-[10px]
                             hover:bg-sovereign-warn/30 transition-colors"
                >
                  ✍️ Test Sign
                </button>
              </div>
              {testSignResult && (
                <div className="mt-1 text-[10px] text-sovereign-accent font-mono bg-sovereign-bg rounded px-2 py-1">
                  {testSignResult}
                </div>
              )}
            </Section>
          )}

          {/* Serial Log */}
          <Section title="Serial Log">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-sovereign-muted">
                {serialLog.length} entries
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={`px-1.5 py-0.5 rounded text-[10px] border ${
                    autoRefresh
                      ? "bg-sovereign-accent/20 text-sovereign-accent border-sovereign-accent/30"
                      : "bg-sovereign-bg text-sovereign-muted border-sovereign-border"
                  }`}
                >
                  {autoRefresh ? "Auto ●" : "Auto ○"}
                </button>
                <button
                  onClick={handleRefreshLog}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-sovereign-bg 
                             text-sovereign-muted border border-sovereign-border
                             hover:text-sovereign-text"
                >
                  ↻
                </button>
                <button
                  onClick={handleClearLog}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-sovereign-bg 
                             text-sovereign-danger border border-sovereign-border
                             hover:text-sovereign-danger"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="bg-sovereign-bg rounded p-2 max-h-48 overflow-y-auto font-mono text-[10px]">
              {serialLog.length === 0 ? (
                <span className="text-sovereign-muted italic">No serial data</span>
              ) : (
                serialLog.map((entry, i) => (
                  <div key={i} className="flex gap-1 leading-tight">
                    <span className="text-sovereign-muted shrink-0">
                      {formatTime(entry.timestamp)}
                    </span>
                    <span
                      className={`shrink-0 font-bold ${
                        entry.direction === "tx" ? "text-sovereign-warn" : "text-sovereign-accent"
                      }`}
                    >
                      {entry.direction === "tx" ? "TX▸" : "RX◂"}
                    </span>
                    <span className="text-sovereign-text break-all">{entry.data}</span>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </Section>

          {/* Rotation Lineage */}
          {state.lastRotation && (
            <Section title="Last Rotation">
              <div className="space-y-1 font-mono">
                <Row label="Old PK" value={state.lastRotation.previousPublicKey.slice(0, 24) + "..."} />
                <Row label="New PK" value={state.lastRotation.newPublicKey.slice(0, 24) + "..."} />
                <Row label="Sig" value={state.lastRotation.signature.slice(0, 24) + "..."} />
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[10px]">
      <span className="text-sovereign-muted">{label}</span>
      <span className="text-sovereign-text ml-2 text-right">{value}</span>
    </div>
  );
}
