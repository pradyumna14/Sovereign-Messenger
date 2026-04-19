/**
 * Local Message Bus
 * 
 * In-browser pub/sub transport that replaces MQTT for demo/hackathon mode.
 * Allows two simulated identities to message each other locally without
 * needing an external Mosquitto broker.
 * 
 * This is a singleton event bus using BroadcastChannel (same-origin tabs)
 * with an in-page fallback for single-tab demos.
 */

// ── Types ──────────────────────────────────────────────────────────────

export type LocalBusHandler = (topic: string, payload: string) => void;

interface Subscription {
  id: string;
  topic: string;
  handler: LocalBusHandler;
}

// ── Singleton Bus ──────────────────────────────────────────────────────

class LocalMessageBus {
  private subscriptions: Subscription[] = [];
  private nextId = 0;
  private broadcastChannel: BroadcastChannel | null = null;

  constructor() {
    // Try to use BroadcastChannel for multi-tab demos
    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.broadcastChannel = new BroadcastChannel("sovereign-messenger-bus");
        this.broadcastChannel.onmessage = (event) => {
          const { topic, payload } = event.data;
          this.deliverLocal(topic, payload);
        };
      } catch {
        // Fallback: single-tab only
      }
    }
  }

  subscribe(topic: string, handler: LocalBusHandler): string {
    const id = `sub_${this.nextId++}`;
    this.subscriptions.push({ id, topic, handler });
    return id;
  }

  unsubscribe(subscriptionId: string): void {
    this.subscriptions = this.subscriptions.filter((s) => s.id !== subscriptionId);
  }

  publish(topic: string, payload: string): void {
    // Deliver to in-page subscribers
    this.deliverLocal(topic, payload);

    // Also broadcast to other tabs
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({ topic, payload });
      } catch {
        // Ignore if channel is closed
      }
    }
  }

  private deliverLocal(topic: string, payload: string): void {
    // Use setTimeout to make delivery async (like real MQTT)
    for (const sub of this.subscriptions) {
      if (sub.topic === topic) {
        setTimeout(() => sub.handler(topic, payload), 0);
      }
    }
  }

  getSubscribedTopics(): string[] {
    return [...new Set(this.subscriptions.map((s) => s.topic))];
  }

  destroy(): void {
    this.subscriptions = [];
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
  }
}

// ── Singleton Instance ─────────────────────────────────────────────────

let busInstance: LocalMessageBus | null = null;

export function getLocalBus(): LocalMessageBus {
  if (!busInstance) {
    busInstance = new LocalMessageBus();
  }
  return busInstance;
}

export function resetLocalBus(): void {
  if (busInstance) {
    busInstance.destroy();
    busInstance = null;
  }
}

export { LocalMessageBus };
