/**
 * ESP8266/ESP32 Firmware for Sovereign Messenger
 * 
 * This directory contains the Arduino firmware that runs on the
 * hardware identity module (ESP8266 or ESP32).
 * 
 * Files:
 *   firmware_original.ino  — The user's original ESP8266 firmware
 *   firmware.ino           — Enhanced version with full protocol support
 * 
 * Protocol (text-based, 115200 baud, newline-delimited):
 * 
 *   Device → Browser (on boot):
 *     ESP_AUTH_MODULE\n          (optional boot banner)
 *     USERNAME:<name>\n
 *     PUBLIC_KEY:<64 hex chars>\n
 *     READY\n
 * 
 *   Browser → Device:
 *     NONCE:<64 hex chars>\n     (nonce challenge)
 *     SIGN:<hex data>\n          (sign arbitrary data)
 *     PING\n                     (liveness check)
 * 
 *   Device → Browser:
 *     SIGNATURE:<64 hex chars>\n (nonce response)
 *     SIGNED:<64 hex chars>\n    (data signature)
 *     PONG\n                     (liveness response)
 * 
 * Crypto scheme (symmetric, SHA-256 based):
 *   master_seed    = 32 random bytes (stored in EEPROM, generated once)
 *   daily_key      = SHA-256(master_seed || day_counter)
 *   public_key     = SHA-256(daily_key)
 *   signature      = SHA-256(daily_key || nonce)
 * 
 * Note: This is a SYMMETRIC scheme — the browser cannot independently
 * verify signatures without the daily_key. Verification works by:
 *   1. Sending a nonce challenge to prove device liveness
 *   2. Storing (public_key, nonce, signature) as authentication proof
 *   3. The public_key serves as a stable identity anchor
 * 
 * For production, replace with Ed25519 (e.g., using libsodium on ESP32).
 * 
 * Wiring: USB → Serial (built-in USB on most ESP8266/ESP32 dev boards)
 * Driver: CP2102 or CH340 (depends on board)
 */
