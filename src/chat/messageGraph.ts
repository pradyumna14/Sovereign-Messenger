/**
 * Message Graph
 * 
 * Maintains a directed acyclic graph of messages linked by parent hashes.
 * Provides utilities for traversal, integrity checking, and visualization.
 */

import { type WIMPPacket, hashPacket, GENESIS_HASH } from "../protocol/wimpPacket";

// ── Types ──────────────────────────────────────────────────────────────

export interface MessageNode {
  hash: string;
  packet: WIMPPacket;
  parentHash: string;
  children: string[];    // hashes of child messages
  depth: number;
  valid: boolean;
}

export interface MessageGraph {
  nodes: Map<string, MessageNode>;
  roots: string[];       // hashes of genesis messages
  tips: string[];        // hashes of leaf messages (no children)
  lastHash: string;
}

// ── Graph Operations ───────────────────────────────────────────────────

/**
 * Create an empty message graph.
 */
export function createMessageGraph(): MessageGraph {
  return {
    nodes: new Map(),
    roots: [],
    tips: [],
    lastHash: GENESIS_HASH,
  };
}

/**
 * Add a message to the graph.
 * Automatically links to parent and updates tips.
 */
export async function addMessageToGraph(
  graph: MessageGraph,
  packet: WIMPPacket,
  isValid: boolean = true
): Promise<MessageGraph> {
  const hash = await hashPacket(packet);
  const parentHash = packet.parent_hash;

  // Calculate depth
  let depth = 0;
  if (parentHash !== GENESIS_HASH) {
    const parent = graph.nodes.get(parentHash);
    if (parent) {
      depth = parent.depth + 1;
    }
  }

  // Create node
  const node: MessageNode = {
    hash,
    packet,
    parentHash,
    children: [],
    depth,
    valid: isValid,
  };

  // Clone the graph
  const newNodes = new Map(graph.nodes);
  newNodes.set(hash, node);

  // Link to parent
  if (parentHash !== GENESIS_HASH && newNodes.has(parentHash)) {
    const parent = { ...newNodes.get(parentHash)! };
    parent.children = [...parent.children, hash];
    newNodes.set(parentHash, parent);
  }

  // Update roots (messages with GENESIS parent or unknown parent)
  const roots = parentHash === GENESIS_HASH
    ? [...graph.roots, hash]
    : [...graph.roots];

  // Update tips: remove parent from tips, add new node
  const tipSet = new Set(graph.tips);
  tipSet.delete(parentHash);
  tipSet.add(hash);

  return {
    nodes: newNodes,
    roots,
    tips: Array.from(tipSet),
    lastHash: hash,
  };
}

/**
 * Get the ordered chain of messages from genesis to a specific tip.
 */
export function getChainToTip(
  graph: MessageGraph,
  tipHash: string
): MessageNode[] {
  const chain: MessageNode[] = [];
  let current = graph.nodes.get(tipHash);

  while (current) {
    chain.unshift(current);
    if (current.parentHash === GENESIS_HASH) break;
    current = graph.nodes.get(current.parentHash);
  }

  return chain;
}

/**
 * Get all messages in chronological order.
 */
export function getOrderedMessages(graph: MessageGraph): MessageNode[] {
  return Array.from(graph.nodes.values()).sort(
    (a, b) => a.packet.timestamp - b.packet.timestamp
  );
}

/**
 * Check if a graph has any broken links (orphan messages).
 */
export function findOrphanMessages(graph: MessageGraph): MessageNode[] {
  return Array.from(graph.nodes.values()).filter((node) => {
    if (node.parentHash === GENESIS_HASH) return false;
    return !graph.nodes.has(node.parentHash);
  });
}

/**
 * Get the current chain length.
 */
export function getChainLength(graph: MessageGraph): number {
  return graph.nodes.size;
}

/**
 * Remove a node from the graph (for expiration).
 */
export function removeFromGraph(
  graph: MessageGraph,
  hash: string
): MessageGraph {
  const newNodes = new Map(graph.nodes);
  const node = newNodes.get(hash);

  if (!node) return graph;

  // Remove from parent's children
  if (node.parentHash !== GENESIS_HASH && newNodes.has(node.parentHash)) {
    const parent = { ...newNodes.get(node.parentHash)! };
    parent.children = parent.children.filter((c) => c !== hash);
    newNodes.set(node.parentHash, parent);
  }

  newNodes.delete(hash);

  // Recalculate roots and tips
  const roots = graph.roots.filter((r) => r !== hash);
  const tips = Array.from(newNodes.values())
    .filter((n) => n.children.length === 0)
    .map((n) => n.hash);

  return {
    nodes: newNodes,
    roots,
    tips,
    lastHash: tips.length > 0 ? tips[tips.length - 1] : GENESIS_HASH,
  };
}
