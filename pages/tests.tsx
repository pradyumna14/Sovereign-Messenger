/**
 * Test Runner Page
 * 
 * Browser-based test execution page. Run protocol tests and
 * MQTT simulations directly from the UI.
 */

import React, { useState, useCallback } from "react";
import Head from "next/head";

// Dynamic imports for tests (browser-only)
let runAllTests: (() => Promise<any[]>) | null = null;
let runMQTTSimulation: (() => Promise<any[]>) | null = null;
let runAttackSimulation: (() => Promise<void>) | null = null;

if (typeof window !== "undefined") {
  import("../src/tests/protocolTests").then((m) => {
    runAllTests = m.runAllTests;
  });
  import("../src/tests/mqttSimulation").then((m) => {
    runMQTTSimulation = m.runMQTTSimulation;
    runAttackSimulation = m.runAttackSimulation;
  });
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

export default function TestRunner() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [simLogs, setSimLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const runProtocolTests = useCallback(async () => {
    if (!runAllTests) {
      setSimLogs(["Test module not loaded yet. Wait a moment and retry."]);
      return;
    }
    setRunning(true);
    setResults([]);
    try {
      const res = await runAllTests();
      setResults(res);
    } catch (err) {
      setSimLogs([(err as Error).message]);
    }
    setRunning(false);
  }, []);

  const runSimulation = useCallback(async () => {
    if (!runMQTTSimulation) {
      setSimLogs(["Simulation module not loaded yet."]);
      return;
    }
    setRunning(true);
    setSimLogs(["Running MQTT simulation..."]);
    try {
      const logs = await runMQTTSimulation();
      setSimLogs(
        logs.map(
          (l: any) =>
            `${l.from} → ${l.to}: "${l.plaintext}" | verified:${l.verified} chain:${l.chainValid} (${l.packetSize}B)`
        )
      );
    } catch (err) {
      setSimLogs([(err as Error).message]);
    }
    setRunning(false);
  }, []);

  const runAttacks = useCallback(async () => {
    if (!runAttackSimulation) {
      setSimLogs(["Attack module not loaded yet."]);
      return;
    }
    setRunning(true);
    setSimLogs(["Running attack simulation... (check browser console for details)"]);
    try {
      await runAttackSimulation();
      setSimLogs((prev) => [...prev, "✅ All attacks properly detected! See console for details."]);
    } catch (err) {
      setSimLogs((prev) => [...prev, `❌ Error: ${(err as Error).message}`]);
    }
    setRunning(false);
  }, []);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  return (
    <>
      <Head>
        <title>Sovereign Messenger – Test Runner</title>
      </Head>

      <div className="min-h-screen bg-sovereign-bg text-sovereign-text p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-sovereign-accent mb-2">
            🧪 Protocol Test Runner
          </h1>
          <p className="text-sm text-sovereign-muted mb-6">
            WIMP / PICP / TTL-Chain Protocol Stack Tests
          </p>

          {/* Action Buttons */}
          <div className="flex gap-3 mb-8">
            <button
              onClick={runProtocolTests}
              disabled={running}
              className="px-4 py-2 bg-sovereign-accent text-sovereign-bg font-semibold
                         rounded hover:bg-sovereign-accent/80 disabled:opacity-50 text-sm"
            >
              {running ? "Running..." : "▶ Run Protocol Tests"}
            </button>
            <button
              onClick={runSimulation}
              disabled={running}
              className="px-4 py-2 bg-blue-600 text-white font-semibold
                         rounded hover:bg-blue-500 disabled:opacity-50 text-sm"
            >
              📡 Run MQTT Simulation
            </button>
            <button
              onClick={runAttacks}
              disabled={running}
              className="px-4 py-2 bg-sovereign-danger text-white font-semibold
                         rounded hover:bg-red-400 disabled:opacity-50 text-sm"
            >
              🔴 Run Attack Simulation
            </button>
          </div>

          {/* Protocol Test Results */}
          {results.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-sovereign-text mb-3">
                Protocol Test Results
                <span className="ml-3 text-sm font-normal">
                  <span className="text-sovereign-accent">{passed} passed</span>
                  {failed > 0 && (
                    <span className="text-sovereign-danger ml-2">{failed} failed</span>
                  )}
                </span>
              </h2>

              <div className="space-y-1">
                {results.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 px-3 py-2 rounded text-sm ${
                      r.passed
                        ? "bg-sovereign-accent/10 border border-sovereign-accent/20"
                        : "bg-sovereign-danger/10 border border-sovereign-danger/20"
                    }`}
                  >
                    <span>{r.passed ? "✅" : "❌"}</span>
                    <span className="flex-1 text-sovereign-text">{r.name}</span>
                    <span className="text-sovereign-muted text-xs">
                      {r.duration.toFixed(1)}ms
                    </span>
                    {r.error && (
                      <span className="text-sovereign-danger text-xs">{r.error}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Simulation Logs */}
          {simLogs.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-sovereign-text mb-3">
                Simulation Log
              </h2>
              <div className="bg-sovereign-panel border border-sovereign-border rounded-lg p-4">
                {simLogs.map((log, i) => (
                  <div key={i} className="text-xs font-mono text-sovereign-text py-0.5">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Instructions */}
          <div className="mt-8 bg-sovereign-panel border border-sovereign-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-sovereign-accent mb-2">
              Console Access
            </h3>
            <p className="text-xs text-sovereign-muted">
              You can also run tests from the browser console:
            </p>
            <pre className="text-xs font-mono text-sovereign-text mt-2 bg-sovereign-bg rounded p-2">
{`// Run protocol tests
await runProtocolTests()

// Run MQTT simulation
await runMQTTSimulation()

// Run attack simulation
await runAttackSimulation()`}
            </pre>
          </div>
        </div>
      </div>
    </>
  );
}
