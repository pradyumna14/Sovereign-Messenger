/**
 * useHardwareIdentity Hook
 * 
 * React hook for managing hardware-anchored identity.
 * Supports both real ESP32 hardware (via WebSerial) and
 * software-simulated devices through the IHardwareDevice abstraction.
 * 
 * Handles:
 * - Device mode switching (hardware ↔ simulated)
 * - Nonce challenge verification on connect
 * - Automatic daily key rotation (simulated mode)
 * - Serial log access for debugging
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type {
  IHardwareDevice,
  DeviceMode,
  DeviceInfo,
  SerialLogEntry,
  NonceChallenge,
} from "../hardware/deviceInterface";
import { RealESP32Device } from "../hardware/esp32SerialDevice";
import { SimulatedESP32Device } from "../hardware/simulatedDevice";
import {
  createSoftwareIdentity,
  rotateIdentity,
  verifyNonceChallenge,
  verifyESP32NonceLiveness,
  isRotationDue,
  type Identity,
  type LineagePacket,
} from "../hardware/identityManager";

// ── Types ──────────────────────────────────────────────────────────────

export interface HardwareIdentityState {
  identity: Identity | null;
  connected: boolean;
  mode: "hardware" | "software" | "none";
  error: string | null;
  loading: boolean;
  lastRotation: LineagePacket | null;
  deviceInfo: DeviceInfo | null;
  lastChallenge: NonceChallenge | null;
}

export interface HardwareIdentityActions {
  connectHardware: () => Promise<void>;
  initSoftwareIdentity: (username?: string) => Promise<void>;
  forceRotation: () => Promise<LineagePacket | null>;
  disconnect: () => void;
  performChallenge: () => Promise<NonceChallenge | null>;
  getSerialLog: () => SerialLogEntry[];
  clearSerialLog: () => void;
  getDevice: () => IHardwareDevice | null;
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useHardwareIdentity(): [HardwareIdentityState, HardwareIdentityActions] {
  const [state, setState] = useState<HardwareIdentityState>({
    identity: null,
    connected: false,
    mode: "none",
    error: null,
    loading: false,
    lastRotation: null,
    deviceInfo: null,
    lastChallenge: null,
  });

  const deviceRef = useRef<IHardwareDevice | null>(null);
  const rotationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ── Hardware Connection (Real ESP32/ESP8266 via WebSerial) ──
  const connectHardware = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      // Disconnect existing device if any
      if (deviceRef.current?.connected) {
        await deviceRef.current.disconnect();
      }

      const device = new RealESP32Device();
      deviceRef.current = device;

      // Connect — triggers WebSerial port picker and waits for handshake
      // Works with both original firmware (no READY) and enhanced (with READY)
      const deviceInfo = await device.connect();

      // Perform nonce challenge to verify device liveness
      const challenge = await device.performNonceChallenge();

      // ESP firmware uses SHA-256 symmetric signing (not Ed25519/ECDSA).
      // We can't do crypto.subtle.verify() — use liveness check instead.
      const liveness = verifyESP32NonceLiveness(
        challenge.publicKey,
        challenge.nonce,
        challenge.signature
      );

      if (!liveness.valid) {
        await device.disconnect();
        const serialLog = device.getSerialLog();
        const lastSigLog = serialLog
          .reverse()
          .find((log) => log.data.includes("SIGNATURE") || log.data.includes("Response"));
        const diagnostic = lastSigLog 
          ? ` Last response: ${lastSigLog.data.slice(0, 50)}...`
          : " Check Hardware Debug Panel for serial log.";
        throw new Error(`ESP nonce challenge failed: ${liveness.reason}.${diagnostic}`);
      }

      console.log(`[Hardware] ${liveness.reason}`);

      // Create a software identity for protocol compatibility (WIMP signing).
      // The ESP's public key becomes our hardware identity anchor, but message signing
      // uses the browser-generated Ed25519/ECDSA key pair (ESP's SHA-256 scheme can't do
      // Ed25519/ECDSA signatures needed for PICP).
      const softId = await createSoftwareIdentity();
      const identity: Identity = {
        ...softId,
        hardwarePublicKey: deviceInfo.publicKey,        // Keep ESP32 key separate
        hardwareUsername: deviceInfo.username,
        // softId.publicKey is used for WIMP signing (Ed25519/ECDSA)
      };

      setState({
        identity,
        connected: true,
        mode: "hardware",
        error: null,
        loading: false,
        lastRotation: null,
        deviceInfo,
        lastChallenge: challenge,
      });
    } catch (err) {
      deviceRef.current = null;
      setState((s) => ({
        ...s,
        loading: false,
        error: `Hardware connection failed: ${(err as Error).message}`,
      }));
    }
  }, []);

  // ── Software/Simulated Identity ──
  const initSoftwareIdentity = useCallback(async (username?: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      // Disconnect existing device if any
      if (deviceRef.current?.connected) {
        await deviceRef.current.disconnect();
      }

      const device = new SimulatedESP32Device(username);
      deviceRef.current = device;

      // Connect simulated device (creates identity internally)
      const deviceInfo = await device.connect();

      // Perform nonce challenge (self-sign + self-verify for protocol exercise)
      const challenge = await device.performNonceChallenge();
      const valid = await verifyNonceChallenge(
        challenge.publicKey,
        challenge.nonce,
        challenge.signature
      );

      if (!valid) {
        console.warn("[Simulated] Self-challenge verification failed, continuing anyway");
      }

      // Use the simulated device's internal identity
      const identity = device.getIdentity()!;

      setState({
        identity,
        connected: true,
        mode: "software",
        error: null,
        loading: false,
        lastRotation: null,
        deviceInfo,
        lastChallenge: challenge,
      });
    } catch (err) {
      deviceRef.current = null;
      setState((s) => ({
        ...s,
        loading: false,
        error: `Simulated identity creation failed: ${(err as Error).message}`,
      }));
    }
  }, []);

  // ── Perform Nonce Challenge (manual / debug) ──
  const performChallenge = useCallback(async (): Promise<NonceChallenge | null> => {
    if (!deviceRef.current?.connected) return null;

    try {
      const challenge = await deviceRef.current.performNonceChallenge();
      const valid = await verifyNonceChallenge(
        challenge.publicKey,
        challenge.nonce,
        challenge.signature
      );

      setState((s) => ({
        ...s,
        lastChallenge: challenge,
        error: valid ? null : "Nonce challenge verification FAILED",
      }));

      return challenge;
    } catch (err) {
      setState((s) => ({
        ...s,
        error: `Challenge failed: ${(err as Error).message}`,
      }));
      return null;
    }
  }, []);

  // ── Key Rotation ──
  const forceRotation = useCallback(async (): Promise<LineagePacket | null> => {
    if (!state.identity) return null;

    try {
      const { identity: newIdentity, lineage } = await rotateIdentity(state.identity);
      setState((s) => ({
        ...s,
        identity: newIdentity,
        lastRotation: lineage,
        deviceInfo: s.deviceInfo
          ? { ...s.deviceInfo, publicKey: newIdentity.publicKey }
          : null,
      }));
      return lineage;
    } catch (err) {
      setState((s) => ({
        ...s,
        error: `Key rotation failed: ${(err as Error).message}`,
      }));
      return null;
    }
  }, [state.identity]);

  // ── Disconnect ──
  const disconnect = useCallback(() => {
    if (deviceRef.current) {
      deviceRef.current.disconnect().catch(console.error);
      deviceRef.current = null;
    }
    if (rotationTimerRef.current) {
      clearInterval(rotationTimerRef.current);
    }
    setState({
      identity: null,
      connected: false,
      mode: "none",
      error: null,
      loading: false,
      lastRotation: null,
      deviceInfo: null,
      lastChallenge: null,
    });
  }, []);

  // ── Serial Log Accessors ──
  const getSerialLog = useCallback((): SerialLogEntry[] => {
    return deviceRef.current?.getSerialLog() || [];
  }, []);

  const clearSerialLog = useCallback((): void => {
    deviceRef.current?.clearSerialLog();
  }, []);

  // ── Device Accessor ──
  const getDevice = useCallback((): IHardwareDevice | null => {
    return deviceRef.current;
  }, []);

  // ── Automatic Rotation Check ──
  useEffect(() => {
    if (!state.identity || !state.connected) return;

    rotationTimerRef.current = setInterval(() => {
      if (state.identity && isRotationDue(state.identity)) {
        console.log("[Identity] Daily rotation due, rotating...");
        forceRotation();
      }
    }, 60_000); // check every minute

    return () => {
      if (rotationTimerRef.current) {
        clearInterval(rotationTimerRef.current);
      }
    };
  }, [state.identity, state.connected, forceRotation]);

  return [
    state,
    {
      connectHardware,
      initSoftwareIdentity,
      forceRotation,
      disconnect,
      performChallenge,
      getSerialLog,
      clearSerialLog,
      getDevice,
    },
  ];
}
