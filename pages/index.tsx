/**
 * Sovereign Messenger – Main Page
 * 
 * Integrates all protocol layers and UI components into a single
 * browser-based messaging interface.
 * 
 * Architecture:
 *   Identity (ESP32/Software) → WIMP Packet → PICP Signature →
 *   TTL-Chain → AES-GCM Encryption → Transport (MQTT or Local)
 * 
 * Supports two transport modes:
 *   - Demo Mode (default): Local in-browser message bus, no external broker needed
 *   - MQTT Mode: Real MQTT broker over WebSocket (requires Mosquitto)
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import Head from "next/head";
import { useHardwareIdentity } from "../src/hooks/useHardwareIdentity";
import { useMQTT } from "../src/hooks/useMQTT";
import { useLocalTransport } from "../src/hooks/useLocalTransport";
import { useMessageLifecycle } from "../src/hooks/useMessageLifecycle";
import { useDiscovery } from "../src/hooks/useDiscovery";
import { useConnectionRequests } from "../src/hooks/useConnectionRequests";
import { decodeInviteLink } from "../src/discovery/peerDiscovery";
import { DemoEchoBot } from "../src/demo/demoEchoBot";
import { getInboxTopic } from "../src/mqtt/topicManager";
import HardwareConnect from "../src/ui/HardwareConnect";
import ContactList from "../src/ui/ContactList";
import ChatWindow from "../src/ui/ChatWindow";
import MessageComposer from "../src/ui/MessageComposer";
import SecurityStatusPanel from "../src/ui/SecurityStatusPanel";
import DebugPanel from "../src/ui/DebugPanel";
import HardwareDebugPanel from "../src/ui/HardwareDebugPanel";
import RequestModal from "../src/ui/RequestModal";

// ── Types ──────────────────────────────────────────────────────────────

interface Contact {
  publicKey: string;
  label: string;
  lastSeen: number | null;
}

type TransportMode = "demo" | "mqtt";

// ── Page Component ─────────────────────────────────────────────────────

export default function Home() {
  // ── State ──
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeContactPk, setActiveContactPk] = useState<string | null>(null);
  const [brokerUrl, setBrokerUrl] = useState("wss://broker.hivemq.com:8884/mqtt");
  const [transportMode, setTransportMode] = useState<TransportMode>("demo");
  const [currentIncomingRequest, setCurrentIncomingRequest] = useState<string | null>(null);

  // Demo echo bot ref (persists across renders)
  const echoBotRef = useRef<DemoEchoBot | null>(null);

  // ── Hooks ──
  const [identityState, identityActions] = useHardwareIdentity();

  // Message lifecycle (depends on identity)
  const [chatState, chatActions] = useMessageLifecycle(identityState.identity);

  // Transport message handler (shared between MQTT and local)
  const handleTransportMessage = useCallback(
    (topic: string, payload: string) => {
      console.log(`[Transport] Incoming on ${topic}, length: ${payload.length}`);
      chatActions.receiveMessage(payload);
    },
    [chatActions]
  );

  // Both transports are always initialized; we use the active one
  const [mqttState, mqttActions] = useMQTT(handleTransportMessage);
  const [localState, localActions] = useLocalTransport(handleTransportMessage);

  // Select active transport based on mode
  const transportState = transportMode === "demo" ? localState : mqttState;
  const transportActions = transportMode === "demo" ? localActions : mqttActions;

  // ── Peer Discovery ──
  // Auto-discovers other tabs/windows running the app via BroadcastChannel.
  // Also handles invite links (URL-based contact sharing).
  const {
    discoveredPeers,
    inviteLink,
    addPeerFromInvite,
    addPeer: addDiscoveredPeer,
  } = useDiscovery({
    publicKey: identityState.identity?.publicKey ?? null,
    username: identityState.deviceInfo?.username ?? "anonymous",
  });

  // ── Connection Requests ──
  // Manages the two-way mutual connection request flow.
  const {
    incomingRequests,
    outgoingRequests,
    sendRequest,
    acceptRequest,
    rejectRequest,
  } = useConnectionRequests({
    publicKey: identityState.identity?.publicKey ?? null,
    username: identityState.deviceInfo?.username ?? "anonymous",
  });

  // Show the first pending incoming request in the modal
  const currentRequest = incomingRequests.find((r) => r.status === "pending");
  useEffect(() => {
    if (currentRequest && !currentIncomingRequest) {
      setCurrentIncomingRequest(currentRequest.id);
    } else if (!currentRequest && currentIncomingRequest) {
      setCurrentIncomingRequest(null);
    }
  }, [currentRequest, currentIncomingRequest]);

  // ── Auto-connect transport when identity is ready ──
  useEffect(() => {
    if (identityState.connected && identityState.identity && !transportState.connected) {
      if (transportMode === "demo") {
        localActions.connect();
      } else {
        mqttActions.connect(brokerUrl);
      }
    }
  }, [identityState.connected, identityState.identity, transportState.connected, transportMode, brokerUrl, localActions, mqttActions]);

  // Subscribe to our inbox when transport connects
  useEffect(() => {
    if (transportState.connected && identityState.identity) {
      transportActions.subscribe(identityState.identity.publicKey);
    }
  }, [transportState.connected, identityState.identity, transportActions]);

  // ── One-Click Demo Setup ──
  const handleStartDemo = useCallback(async () => {
    setTransportMode("demo");

    // Create a simulated identity if not already connected
    if (!identityState.connected) {
      await identityActions.initSoftwareIdentity();
    }

    // Initialize the echo bot with a real "bob" identity
    if (!echoBotRef.current || !echoBotRef.current.ready) {
      const bot = new DemoEchoBot();
      const bobPk = await bot.initialize();
      echoBotRef.current = bot;

      // Add bob as a contact with his REAL public key
      setContacts((prev) => {
        if (prev.find((c) => c.label === "bob (demo)")) return prev;
        return [...prev, { publicKey: bobPk, label: "bob (demo)", lastSeen: Date.now() }];
      });
    }
  }, [identityState.connected, identityActions]);

  // ── Handlers ──
  const handleAddContact = useCallback((publicKey: string, label: string) => {
    setContacts((prev) => {
      if (prev.find((c) => c.publicKey === publicKey)) return prev;
      return [...prev, { publicKey, label, lastSeen: null }];
    });
  }, []);

  // Handle invite link paste — decode, add to discovery AND contacts
  const handlePasteInvite = useCallback(
    (url: string): boolean => {
      const ok = addPeerFromInvite(url);
      if (ok) {
        // Also add directly as contact for immediate use
        const decoded = decodeInviteLink(url);
        if (decoded) {
          handleAddContact(decoded.publicKey, decoded.username);
        }
      }
      return ok;
    },
    [addPeerFromInvite, handleAddContact]
  );

  // Handle incoming connection request acceptance
  const handleAcceptRequest = useCallback(
    (requestId: string) => {
      const request = incomingRequests.find((r) => r.id === requestId);
      if (request) {
        acceptRequest(requestId);
        // Add the requester as a contact
        handleAddContact(request.requesterPublicKey, request.requesterUsername);
      }
    },
    [incomingRequests, acceptRequest, handleAddContact]
  );

  // Handle incoming connection request rejection
  const handleRejectRequest = useCallback(
    (requestId: string) => {
      rejectRequest(requestId);
    },
    [rejectRequest]
  );

  // Handle request sent callback - when mutual acceptance happens
  useEffect(() => {
    outgoingRequests.forEach((req) => {
      if (req.status === "accepted") {
        // Auto-add as contact when mutually accepted
        if (!contacts.find((c) => c.publicKey === req.recipientPublicKey)) {
          handleAddContact(req.recipientPublicKey, req.recipientUsername);
        }
      }
    });
  }, [outgoingRequests, contacts, handleAddContact]);

  const handleSelectContact = useCallback(
    (publicKey: string) => {
      setActiveContactPk(publicKey);
      chatActions.setContact(publicKey);
      // In MQTT mode, subscribe to contact's inbox for bi-directional messaging
      // In demo mode, the echo bot handles responses, so no need to subscribe
      if (transportMode === "mqtt" && transportState.connected) {
        transportActions.subscribe(publicKey);
      }
    },
    [chatActions, transportMode, transportState.connected, transportActions]
  );

  const handleSendMessage = useCallback(
    async (plaintext: string, expiryMs: number) => {
      if (!activeContactPk || !identityState.identity) return;

      const serialized = await chatActions.sendMessage(
        plaintext,
        activeContactPk,
        expiryMs
      );

      if (serialized) {
        transportActions.publish(activeContactPk, serialized);

        // In demo mode, have the echo bot generate a response from bob → alice
        if (transportMode === "demo" && echoBotRef.current?.ready) {
          // Small delay to make the response feel natural
          setTimeout(async () => {
            const response = await echoBotRef.current!.createEchoResponse(
              identityState.identity!.publicKey,
              expiryMs
            );
            if (response) {
              // Publish to alice's inbox (our own inbox) so we receive it
              const aliceInbox = getInboxTopic(identityState.identity!.publicKey);
              const { getLocalBus } = await import("../src/transport/localBus");
              getLocalBus().publish(aliceInbox, response);
            }
          }, 500 + Math.random() * 1000);
        }
      }
    },
    [activeContactPk, chatActions, transportActions, transportMode, identityState.identity]
  );

  const handleSwitchTransport = useCallback((mode: TransportMode) => {
    // Disconnect current transport
    if (transportState.connected) {
      transportActions.disconnect();
    }
    setTransportMode(mode);
  }, [transportState.connected, transportActions]);

  const activeContact = contacts.find((c) => c.publicKey === activeContactPk);

  // Determine if messaging is possible
  const canSendMessages = identityState.connected && !!activeContactPk && transportState.connected;

  // ── Render ──
  return (
    <>
      <Head>
        <title>Sovereign Messenger – WIMP/PICP/TTL-Chain</title>
        <meta name="description" content="Sovereign messaging prototype with hardware-anchored identity" />
      </Head>

      <div className="min-h-screen bg-sovereign-bg text-sovereign-text">
        {/* Header */}
        <header className="border-b border-sovereign-border px-6 py-3">
          <div className="flex items-center justify-between max-w-7xl mx-auto">
            <div>
              <h1 className="text-lg font-bold text-sovereign-accent">
                ⚡ Sovereign Messenger
              </h1>
              <p className="text-[10px] text-sovereign-muted uppercase tracking-widest">
                WIMP/1 · PICP · TTL-Chain
              </p>
            </div>

            {/* Transport Mode + Config */}
            <div className="flex items-center gap-3">
              {/* Transport Toggle */}
              <div className="flex rounded-md overflow-hidden border border-sovereign-border">
                <button
                  onClick={() => handleSwitchTransport("demo")}
                  className={`px-3 py-1 text-[10px] font-medium transition-colors ${
                    transportMode === "demo"
                      ? "bg-sovereign-accent/20 text-sovereign-accent"
                      : "bg-sovereign-bg text-sovereign-muted hover:text-sovereign-text"
                  }`}
                >
                  🏠 Demo
                </button>
                <button
                  onClick={() => handleSwitchTransport("mqtt")}
                  className={`px-3 py-1 text-[10px] font-medium transition-colors border-l border-sovereign-border ${
                    transportMode === "mqtt"
                      ? "bg-sovereign-accent/20 text-sovereign-accent"
                      : "bg-sovereign-bg text-sovereign-muted hover:text-sovereign-text"
                  }`}
                >
                  📡 MQTT
                </button>
              </div>

              {/* Broker URL (only for MQTT mode) */}
              {transportMode === "mqtt" && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={brokerUrl}
                    onChange={(e) => setBrokerUrl(e.target.value)}
                    disabled={mqttState.connected}
                    className="bg-sovereign-bg border border-sovereign-border rounded px-2 py-1
                               text-xs font-mono text-sovereign-text w-44
                               focus:outline-none focus:border-sovereign-accent
                               disabled:opacity-50"
                  />
                </div>
              )}

              {/* Connection Status Dot */}
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    transportState.connected
                      ? "bg-sovereign-accent"
                      : transportState.error
                      ? "bg-sovereign-danger"
                      : "bg-sovereign-muted"
                  }`}
                />
                <span className="text-[10px] text-sovereign-muted">
                  {transportState.connected
                    ? transportMode === "demo"
                      ? "Local Bus"
                      : "MQTT"
                    : "Offline"}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* One-Click Demo Banner (shown when not connected) */}
        {!identityState.connected && (
          <div className="max-w-7xl mx-auto px-4 pt-4">
            <div className="bg-gradient-to-r from-sovereign-accent/10 to-sovereign-warn/10 
                          border border-sovereign-accent/30 rounded-lg p-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-sovereign-accent">
                  🚀 Quick Start Demo
                </h2>
                <p className="text-xs text-sovereign-muted mt-1">
                  Launch a simulator identity instantly — no hardware or MQTT broker needed.
                  All protocols run in-browser.
                </p>
              </div>
              <button
                onClick={handleStartDemo}
                className="px-6 py-2.5 bg-sovereign-accent text-sovereign-bg font-bold rounded-lg
                         hover:bg-sovereign-accent/80 transition-colors text-sm whitespace-nowrap
                         shadow-lg shadow-sovereign-accent/20"
              >
                ▶ Start Demo
              </button>
            </div>
          </div>
        )}

        {/* Main Layout */}
        <main className="max-w-7xl mx-auto p-4 grid grid-cols-12 gap-4 h-[calc(100vh-64px)]">
          {/* Left Sidebar – Identity & Contacts */}
          <aside className="col-span-3 space-y-4 overflow-y-auto">
            <HardwareConnect state={identityState} actions={identityActions} />
            <ContactList
              contacts={contacts}
              activeContact={activeContactPk}
              onSelectContact={handleSelectContact}
              onAddContact={handleAddContact}
              discoveredPeers={discoveredPeers}
              inviteLink={inviteLink}
              onPasteInvite={handlePasteInvite}
              outgoingRequests={outgoingRequests}
              onSendRequest={sendRequest}
            />
            <SecurityStatusPanel
              identity={identityState}
              mqtt={transportState}
              chat={chatState}
            />
          </aside>

          {/* Center – Chat */}
          <section className="col-span-6 flex flex-col gap-4 min-h-0">
            <div className="flex-1 min-h-0">
              <ChatWindow
                messages={chatState.messages}
                alerts={chatState.alerts}
                myPublicKey={identityState.identity?.publicKey || null}
              />
            </div>
            <MessageComposer
              onSend={handleSendMessage}
              disabled={!canSendMessages}
              contactLabel={activeContact?.label || null}
            />
          </section>

          {/* Right Sidebar – Debug */}
          <aside className="col-span-3 overflow-y-auto space-y-4">
            <HardwareDebugPanel
              state={identityState}
              actions={identityActions}
            />
            <DebugPanel
              identity={identityState}
              mqtt={transportState}
              chat={chatState}
            />
          </aside>
        </main>
      </div>

      {/* Connection Request Modal */}
      <RequestModal
        request={currentRequest || null}
        onAccept={handleAcceptRequest}
        onReject={handleRejectRequest}
      />
    </>
  );
}
