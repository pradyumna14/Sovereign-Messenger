/**
 * useMessageLifecycle Hook
 * 
 * Manages the complete lifecycle of messages:
 * - Sending: encrypt → sign → chain-link → publish
 * - Receiving: validate → verify → chain-link → decrypt
 * - Expiration: periodic timer to shred expired messages
 * - Session key destruction on expiry
 */

import { useReducer, useCallback, useEffect, useRef } from "react";
import {
  chatReducer,
  initialChatState,
  generateMessageId,
  type ChatMessage,
  type ChatState,
  type ChatAction,
} from "../chat/chatReducer";
import { buildPacket, serializePacket, hashPacket, GENESIS_HASH } from "../protocol/wimpPacket";
import { signPacket } from "../protocol/picpSignature";
import { encryptMessage } from "../protocol/encryption";
import { validateIncomingMessage } from "../chat/messageValidator";
import { createChainState, appendWithValidation, type ChainState } from "../protocol/ttlChain";
import type { Identity } from "../hardware/identityManager";

// ── Types ──────────────────────────────────────────────────────────────

export interface MessageLifecycleActions {
  sendMessage: (
    plaintext: string,
    receiverPk: string,
    expiryMs?: number
  ) => Promise<string | null>; // returns serialized packet or null on error

  receiveMessage: (rawPayload: string) => Promise<void>;

  setContact: (publicKey: string) => void;

  reset: () => void;
}

// ── Default TTL ────────────────────────────────────────────────────────

const DEFAULT_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes default
const SHRED_INTERVAL_MS = 10_000;          // check every 10 seconds

// ── Hook ───────────────────────────────────────────────────────────────

export function useMessageLifecycle(
  identity: Identity | null
): [ChatState, MessageLifecycleActions] {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const chainRef = useRef<ChainState>(createChainState());

  // ── Send Message ──
  const sendMessage = useCallback(
    async (
      plaintext: string,
      receiverPk: string,
      expiryMs: number = DEFAULT_EXPIRY_MS
    ): Promise<string | null> => {
      if (!identity) {
        console.error("[Lifecycle] No identity – cannot send");
        return null;
      }

      try {
        // 1. Encrypt the plaintext
        const ciphertext = await encryptMessage(
          plaintext,
          identity.publicKey,
          receiverPk
        );

        // 2. Build the unsigned packet
        const unsigned = buildPacket({
          senderPublicKey: identity.publicKey,
          receiverPublicKey: receiverPk,
          parentHash: chainRef.current.lastHash,
          expiryMs,
          ciphertext,
        });

        // 3. Sign the packet
        const signed = await signPacket(unsigned, identity.privateKey);

        // 4. Update chain
        chainRef.current = await appendWithValidation(signed, chainRef.current);

        // 5. Compute hash and update reducer
        const hash = await hashPacket(signed);
        dispatch({ type: "UPDATE_LAST_HASH", payload: { hash } });

        const chatMessage: ChatMessage = {
          id: generateMessageId(),
          packet: signed,
          plaintext,
          direction: "sent",
          signatureValid: true,
          chainValid: true,
          expired: false,
          timestamp: signed.timestamp,
        };

        dispatch({ type: "NEW_MESSAGE", payload: chatMessage });

        // 6. Serialize for MQTT transport
        return serializePacket(signed);
      } catch (err) {
        console.error("[Lifecycle] Send error:", err);
        return null;
      }
    },
    [identity]
  );

  // ── Receive Message ──
  const receiveMessage = useCallback(
    async (rawPayload: string) => {
      if (!identity) {
        console.error("[Lifecycle] No identity – cannot receive");
        return;
      }

      // Quick-parse to detect self-sent messages — they are already in chat
      // from sendMessage() and would fail decryption (wrong shared key pair).
      try {
        const peek = JSON.parse(rawPayload);
        if (peek.sender_pk === identity.publicKey) {
          console.log("[Lifecycle] Skipping self-sent message (already in chat)");
          return;
        }
      } catch {
        // If JSON parse fails, let the full pipeline handle the error
      }

      // Run full validation pipeline
      const result = await validateIncomingMessage(
        rawPayload,
        chainRef.current,
        identity.publicKey
      );

      if (!result.valid || !result.packet) {
        dispatch({
          type: "INVALID_MESSAGE",
          payload: {
            reason: result.errors.join("; "),
            packet: result.packet!,
          },
        });
        return;
      }

      // Update chain
      chainRef.current = await appendWithValidation(
        result.packet,
        chainRef.current
      );

      const hash = await hashPacket(result.packet);
      dispatch({ type: "UPDATE_LAST_HASH", payload: { hash } });

      // Check chain validity
      if (!result.chainValid) {
        dispatch({
          type: "LINEAGE_BROKEN",
          payload: {
            expected: chainRef.current.lastHash,
            actual: result.packet.parent_hash,
            packetTimestamp: result.packet.timestamp,
          },
        });
      }

      const chatMessage: ChatMessage = {
        id: generateMessageId(),
        packet: result.packet,
        plaintext: result.plaintext,
        direction: "received",
        signatureValid: result.signatureValid,
        chainValid: result.chainValid,
        expired: false,
        timestamp: result.packet.timestamp,
      };

      dispatch({ type: "NEW_MESSAGE", payload: chatMessage });
    },
    [identity]
  );

  // ── Set Contact ──
  const setContact = useCallback((publicKey: string) => {
    dispatch({ type: "SET_CONTACT", payload: { publicKey } });
  }, []);

  // ── Reset ──
  const reset = useCallback(() => {
    chainRef.current = createChainState();
    dispatch({ type: "RESET" });
  }, []);

  // ── Expiration Timer (Shredding) ──
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const expiredIds = state.messages
        .filter((m) => m.packet.expiry <= now && !m.expired)
        .map((m) => m.id);

      if (expiredIds.length > 0) {
        console.log(`[Lifecycle] Shredding ${expiredIds.length} expired messages`);
        dispatch({ type: "SHRED_EXPIRED", payload: { messageIds: expiredIds } });
      }
    }, SHRED_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [state.messages]);

  return [state, { sendMessage, receiveMessage, setContact, reset }];
}
