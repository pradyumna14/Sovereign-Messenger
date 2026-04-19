/**
 * HardwareConnect Component
 * 
 * Provides mode switching between ESP32 hardware and simulated identity.
 * Displays current public key, device info, and connection status.
 * Supports nonce challenge testing from the UI.
 */

import React, { useState } from "react";
import type { HardwareIdentityState, HardwareIdentityActions } from "../hooks/useHardwareIdentity";

interface Props {
  state: HardwareIdentityState;
  actions: HardwareIdentityActions;
}

export default function HardwareConnect({ state, actions }: Props) {
  const [selectedMode, setSelectedMode] = useState<"simulated" | "hardware">("simulated");
  const [username, setUsername] = useState("");
  const [challengeResult, setChallengeResult] = useState<string | null>(null);

  const truncateKey = (key: string) =>
    key ? `${key.slice(0, 12)}...${key.slice(-8)}` : "—";

  // Detect WebSerial support
  const webSerialAvailable = typeof window !== "undefined" && "serial" in navigator;

  const handleConnect = async () => {
    if (selectedMode === "hardware") {
      if (!webSerialAvailable) {
        // Can't use actions.connectHardware — show guidance instead
        return;
      }
      await actions.connectHardware();
    } else {
      await actions.initSoftwareIdentity(username || undefined);
    }
  };

  const handleTestChallenge = async () => {
    setChallengeResult(null);
    const result = await actions.performChallenge();
    if (result) {
      setChallengeResult(
        `✅ Verified | Nonce: ${result.nonce.slice(0, 12)}... | Sig: ${result.signature.slice(0, 12)}...`
      );
    } else {
      setChallengeResult("❌ Challenge failed");
    }
    // Clear result after 5 seconds
    setTimeout(() => setChallengeResult(null), 5000);
  };

  return (
    <div className="bg-sovereign-panel border border-sovereign-border rounded-lg p-4">
      <h2 className="text-sm font-semibold text-sovereign-accent uppercase tracking-wider mb-3">
        🔐 Identity
      </h2>

      {!state.connected ? (
        <div className="space-y-3">
          {/* Mode Toggle */}
          <div className="flex rounded-md overflow-hidden border border-sovereign-border">
            <button
              onClick={() => setSelectedMode("simulated")}
              className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedMode === "simulated"
                  ? "bg-sovereign-accent/20 text-sovereign-accent border-r border-sovereign-border"
                  : "bg-sovereign-bg text-sovereign-muted hover:text-sovereign-text border-r border-sovereign-border"
              }`}
            >
              💻 Simulator
            </button>
            <button
              onClick={() => setSelectedMode("hardware")}
              className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedMode === "hardware"
                  ? "bg-sovereign-accent/20 text-sovereign-accent"
                  : "bg-sovereign-bg text-sovereign-muted hover:text-sovereign-text"
              }`}
            >
              🔌 ESP Hardware
            </button>
          </div>

          {/* Username input for simulated mode */}
          {selectedMode === "simulated" && (
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username (e.g., alice)"
              className="w-full px-3 py-1.5 bg-sovereign-bg border border-sovereign-border rounded
                         text-xs text-sovereign-text placeholder-sovereign-muted
                         focus:outline-none focus:border-sovereign-accent"
            />
          )}

          {/* Hardware mode notice */}
          {selectedMode === "hardware" && (
            <div className="space-y-2">
              {!webSerialAvailable ? (
                <div className="bg-sovereign-danger/10 border border-sovereign-danger/30 rounded p-2 space-y-1">
                  <p className="text-[10px] text-sovereign-danger font-semibold">
                    ⚠ WebSerial Not Available
                  </p>
                  <ul className="text-[10px] text-sovereign-muted list-disc list-inside space-y-0.5">
                    <li>Open in <strong>Chrome</strong> or <strong>Edge</strong> (not Firefox/Safari)</li>
                    <li>Must be at <strong>localhost</strong> or <strong>HTTPS</strong></li>
                    <li>VS Code Simple Browser does not support WebSerial</li>
                    <li>Copy URL → paste in Chrome: <code className="text-sovereign-accent">http://localhost:3000</code></li>
                  </ul>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-[10px] text-sovereign-accent">
                    ✓ WebSerial available
                  </p>
                  <p className="text-[10px] text-sovereign-muted">
                    Connect your ESP8266/ESP32 via USB. The browser will prompt you to
                    select the serial port. Device must run the Sovereign Messenger firmware
                    (115200 baud).
                  </p>
                  <details className="text-[10px] text-sovereign-muted">
                    <summary className="cursor-pointer hover:text-sovereign-text">
                      📋 Expected firmware protocol
                    </summary>
                    <div className="mt-1 pl-2 space-y-0.5 font-mono bg-sovereign-bg rounded p-1.5">
                      <p className="text-sovereign-muted">Device → Browser:</p>
                      <p className="text-sovereign-text">USERNAME:alice</p>
                      <p className="text-sovereign-text">PUBLIC_KEY:abcdef...</p>
                      <p className="text-sovereign-text">READY <span className="text-sovereign-muted">(optional)</span></p>
                      <p className="text-sovereign-muted mt-1">Browser → Device:</p>
                      <p className="text-sovereign-text">NONCE:&lt;64 hex chars&gt;</p>
                      <p className="text-sovereign-muted mt-1">Device → Browser:</p>
                      <p className="text-sovereign-text">SIGNATURE:&lt;64 hex chars&gt;</p>
                    </div>
                  </details>
                  <details className="text-[10px] text-sovereign-muted">
                    <summary className="cursor-pointer hover:text-sovereign-text">
                      🔧 ESP not showing up?
                    </summary>
                    <ul className="list-disc list-inside mt-1 space-y-0.5 pl-2">
                      <li>Install <strong>CP2102</strong> or <strong>CH340</strong> USB-serial driver</li>
                      <li>Check Device Manager → Ports (COM &amp; LPT)</li>
                      <li>Try a different USB cable (data cable, not charge-only)</li>
                      <li>Press the <strong>RST</strong> button on your ESP after connecting</li>
                      <li>Upload firmware from <code className="text-sovereign-accent">esp32/firmware.ino</code></li>
                      <li>Ensure serial monitor is <strong>closed</strong> in Arduino IDE</li>
                    </ul>
                  </details>
                </div>
              )}
            </div>
          )}

          {/* Connect button */}
          <button
            onClick={handleConnect}
            disabled={state.loading || (selectedMode === "hardware" && !webSerialAvailable)}
            className={`w-full px-4 py-2 border rounded-md text-sm transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed ${
              selectedMode === "hardware"
                ? "bg-sovereign-accent/20 text-sovereign-accent border-sovereign-accent/30 hover:bg-sovereign-accent/30"
                : "bg-sovereign-warn/20 text-sovereign-warn border-sovereign-warn/30 hover:bg-sovereign-warn/30"
            }`}
          >
            {state.loading
              ? "Connecting..."
              : selectedMode === "hardware"
              ? "🔌 Connect ESP Device"
              : "💻 Start Simulator"}
          </button>

          {state.error && (
            <p className="text-sovereign-danger text-xs mt-2">{state.error}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Connection Mode Badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  state.mode === "hardware" ? "bg-sovereign-accent" : "bg-sovereign-warn"
                }`}
              />
              <span className="text-xs text-sovereign-muted uppercase">
                {state.mode === "hardware" ? "ESP Hardware" : "Simulated Device"}
              </span>
            </div>
            {state.deviceInfo?.username && (
              <span className="text-xs font-medium text-sovereign-text">
                @{state.deviceInfo.username}
              </span>
            )}
          </div>

          {/* Device Info */}
          {state.deviceInfo && (
            <div className="bg-sovereign-bg rounded p-2 space-y-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-sovereign-muted">Username</span>
                <span className="text-sovereign-text font-mono">{state.deviceInfo.username}</span>
              </div>
              {state.deviceInfo.firmwareVersion && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-sovereign-muted">Firmware</span>
                  <span className="text-sovereign-text font-mono">{state.deviceInfo.firmwareVersion}</span>
                </div>
              )}
              <div className="flex justify-between text-[10px]">
                <span className="text-sovereign-muted">Mode</span>
                <span className="text-sovereign-text font-mono">{state.deviceInfo.mode}</span>
              </div>
            </div>
          )}

          {/* Public Key */}
          <div>
            <label className="text-xs text-sovereign-muted">Public Key</label>
            <div className="font-mono text-xs text-sovereign-text bg-sovereign-bg 
                          rounded px-2 py-1 mt-1 break-all select-all">
              {state.identity?.publicKey || "—"}
            </div>
          </div>

          {/* Previous Key (if rotated) */}
          {state.identity?.previousPublicKey && (
            <div>
              <label className="text-xs text-sovereign-muted">Previous Key</label>
              <div className="font-mono text-xs text-sovereign-muted bg-sovereign-bg 
                            rounded px-2 py-1 mt-1">
                {truncateKey(state.identity.previousPublicKey)}
              </div>
            </div>
          )}

          {/* Challenge result */}
          {challengeResult && (
            <div className="text-[10px] bg-sovereign-bg rounded px-2 py-1 text-sovereign-accent font-mono">
              {challengeResult}
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={handleTestChallenge}
              className="px-2 py-1.5 bg-sovereign-accent/20 text-sovereign-accent
                         border border-sovereign-accent/30 rounded text-[10px] hover:bg-sovereign-accent/30
                         transition-colors"
              title="Perform nonce challenge to verify device"
            >
              🎲 Challenge
            </button>
            <button
              onClick={actions.forceRotation}
              className="px-2 py-1.5 bg-sovereign-warn/20 text-sovereign-warn
                         border border-sovereign-warn/30 rounded text-[10px] hover:bg-sovereign-warn/30
                         transition-colors"
            >
              🔄 Rotate
            </button>
            <button
              onClick={actions.disconnect}
              className="px-2 py-1.5 bg-sovereign-danger/20 text-sovereign-danger
                         border border-sovereign-danger/30 rounded text-[10px] hover:bg-sovereign-danger/30
                         transition-colors"
            >
              ⏏ Disconnect
            </button>
          </div>

          {state.error && (
            <p className="text-sovereign-danger text-xs">{state.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
