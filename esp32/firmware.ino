/*
 * Enhanced ESP8266/ESP32 Firmware for Sovereign Messenger
 * 
 * Changes from original:
 *   1. Sends READY after handshake (browser waits for this)
 *   2. Supports SIGN:<hex> command for signing arbitrary data
 *   3. Supports PING/PONG for liveness checks
 *   4. Better error handling with ERROR: responses
 *   5. Sends FIRMWARE version for browser display
 * 
 * Upload via Arduino IDE:
 *   Board: "Generic ESP8266 Module" or "ESP32 Dev Module"
 *   Baud:  115200
 *   Flash: 4MB (FS:1MB)
 * 
 * Required library: BearSSL (built-in for ESP8266)
 * For ESP32: use mbedtls (built-in) instead of BearSSL
 */

#include <Arduino.h>
#include <EEPROM.h>

// ── Platform-specific SHA-256 ──────────────────────────────────────────

#if defined(ESP8266)
  #include <bearssl/bearssl.h>
  
  void sha256(uint8_t *data, int len, uint8_t *out)
  {
    br_sha256_context ctx;
    br_sha256_init(&ctx);
    br_sha256_update(&ctx, data, len);
    br_sha256_out(&ctx, out);
  }

#elif defined(ESP32)
  #include "mbedtls/sha256.h"
  
  void sha256(uint8_t *data, int len, uint8_t *out)
  {
    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);
    mbedtls_sha256_starts(&ctx, 0);  // 0 = SHA-256 (not SHA-224)
    mbedtls_sha256_update(&ctx, data, len);
    mbedtls_sha256_finish(&ctx, out);
    mbedtls_sha256_free(&ctx);
  }
#endif

// ── Constants ──────────────────────────────────────────────────────────

#define SEED_SIZE     32
#define NONCE_SIZE    32
#define USERNAME_SIZE 40
#define FIRMWARE_VER  "1.1.0"

// ── Globals ────────────────────────────────────────────────────────────

uint8_t master_seed[SEED_SIZE];
uint8_t daily_key[32];
uint8_t public_key[32];
char    username[USERNAME_SIZE];

// ── Utility ────────────────────────────────────────────────────────────

void printHex(uint8_t *data, int len)
{
  for (int i = 0; i < len; i++)
  {
    if (data[i] < 16) Serial.print("0");
    Serial.print(data[i], HEX);
  }
}

bool hexToByte(char hi, char lo, uint8_t *out)
{
  char buf[3] = { hi, lo, 0 };
  char *end;
  unsigned long val = strtoul(buf, &end, 16);
  if (*end != 0) return false;
  *out = (uint8_t)val;
  return true;
}

bool parseHexString(String hex, uint8_t *out, int expectedLen)
{
  if ((int)hex.length() != expectedLen * 2) return false;
  
  for (int i = 0; i < expectedLen; i++)
  {
    if (!hexToByte(hex[i*2], hex[i*2+1], &out[i]))
      return false;
  }
  return true;
}

// ── EEPROM: Seed ───────────────────────────────────────────────────────

void loadOrCreateSeed()
{
  EEPROM.begin(128);

  bool empty = true;
  for (int i = 0; i < SEED_SIZE; i++)
  {
    master_seed[i] = EEPROM.read(i);
    if (master_seed[i] != 0xFF) empty = false;
  }

  if (empty)
  {
    // Use hardware random if available, fallback to analogRead noise
    randomSeed(analogRead(0) ^ micros());
    
    for (int i = 0; i < SEED_SIZE; i++)
    {
      master_seed[i] = random(0, 256);
      EEPROM.write(i, master_seed[i]);
    }
    EEPROM.commit();
    
    Serial.println("INFO:New device seed generated");
  }
  else
  {
    Serial.println("INFO:Existing seed loaded");
  }
}

// ── EEPROM: Username ───────────────────────────────────────────────────

void loadOrSetUsername()
{
  bool empty = true;

  for (int i = 0; i < USERNAME_SIZE; i++)
  {
    char c = EEPROM.read(40 + i);
    username[i] = c;
    if (c != 0xFF && c != 0x00) empty = false;
  }

  if (empty)
  {
    Serial.println("PROMPT:Enter username");

    while (!Serial.available()) { delay(10); }

    String input = Serial.readStringUntil('\n');
    input.trim();

    memset(username, 0, USERNAME_SIZE);
    for (int i = 0; i < (int)input.length() && i < USERNAME_SIZE - 1; i++)
    {
      username[i] = input[i];
      EEPROM.write(40 + i, username[i]);
    }
    EEPROM.write(40 + input.length(), '\0');
    EEPROM.commit();
  }
}

// ── Key Derivation ─────────────────────────────────────────────────────

void deriveDailyKey()
{
  uint8_t buffer[36];
  memcpy(buffer, master_seed, 32);

  // Use millis-based day counter (resets on reboot)
  // For production: use NTP or RTC for real Unix day
  uint32_t day = millis() / 86400000UL;

  buffer[32] = (day >> 24) & 0xFF;
  buffer[33] = (day >> 16) & 0xFF;
  buffer[34] = (day >> 8)  & 0xFF;
  buffer[35] = day & 0xFF;

  sha256(buffer, 36, daily_key);
}

void generatePublicKey()
{
  // PK = SHA-256(daily_key)
  sha256(daily_key, 32, public_key);
}

// ── Signing ────────────────────────────────────────────────────────────

void signNonce(uint8_t *nonce)
{
  // SIGNATURE = SHA-256(daily_key || nonce)
  uint8_t buffer[64];
  uint8_t signature[32];

  // Initialize signature to zeros
  memset(signature, 0, 32);

  memcpy(buffer, daily_key, 32);
  memcpy(buffer + 32, nonce, 32);

  // Compute SHA-256
  sha256(buffer, 64, signature);

  // Verify signature is not corrupted (all zeros or all ones)
  uint8_t allZeros = 1;
  uint8_t allOnes = 1;
  for (int i = 0; i < 32; i++)
  {
    if (signature[i] != 0) allZeros = 0;
    if (signature[i] != 0xFF) allOnes = 0;
  }

  if (allZeros || allOnes)
  {
    Serial.print("ERROR:SHA256 failed (signature invalid: ");
    if (allZeros) Serial.print("all zeros");
    else Serial.print("all ones");
    Serial.println(")");
    return;
  }

  Serial.print("SIGNATURE:");
  printHex(signature, 32);
  Serial.println();
  Serial.flush();  // Ensure data is sent before returning
}

void signData(uint8_t *data, int dataLen)
{
  // SIGNATURE = SHA-256(daily_key || data)
  int bufLen = 32 + dataLen;
  uint8_t *buffer = (uint8_t *)malloc(bufLen);
  
  if (!buffer)
  {
    Serial.println("ERROR:Out of memory for SIGN");
    return;
  }

  uint8_t signature[32];
  memset(signature, 0, 32);  // Initialize to zeros
  
  memcpy(buffer, daily_key, 32);
  memcpy(buffer + 32, data, dataLen);

  sha256(buffer, bufLen, signature);
  free(buffer);

  // Verify signature is not corrupted
  uint8_t allZeros = 1;
  uint8_t allOnes = 1;
  for (int i = 0; i < 32; i++)
  {
    if (signature[i] != 0) allZeros = 0;
    if (signature[i] != 0xFF) allOnes = 0;
  }

  if (allZeros || allOnes)
  {
    Serial.print("ERROR:SHA256 failed (signature invalid: ");
    if (allZeros) Serial.print("all zeros");
    else Serial.print("all ones");
    Serial.println(")");
    return;
  }

  Serial.print("SIGNED:");
  printHex(signature, 32);
  Serial.println();
  Serial.flush();  // Ensure data is sent before returning
}

// ── Setup ──────────────────────────────────────────────────────────────

void setup()
{
  Serial.begin(115200);
  delay(2000);

  Serial.println("ESP_AUTH_MODULE");

  loadOrCreateSeed();
  loadOrSetUsername();

  deriveDailyKey();
  generatePublicKey();

  // ── Handshake: Send identity to browser ──
  Serial.print("USERNAME:");
  Serial.println(username);

  Serial.print("PUBLIC_KEY:");
  printHex(public_key, 32);
  Serial.println();

  Serial.print("FIRMWARE:");
  Serial.println(FIRMWARE_VER);

  // Signal that handshake is complete — browser waits for this
  Serial.println("READY");
}

// ── Main Loop (command handler) ────────────────────────────────────────

void loop()
{
  if (Serial.available())
  {
    String input = Serial.readStringUntil('\n');
    input.trim();

    if (input.length() == 0) return;

    // ── NONCE challenge ──
    if (input.startsWith("NONCE:"))
    {
      String hex = input.substring(6);
      hex.trim();

      uint8_t nonce[32];
      if (parseHexString(hex, nonce, 32))
      {
        signNonce(nonce);
      }
      else
      {
        Serial.println("ERROR:Invalid nonce hex (expected 64 hex chars)");
      }
    }
    // ── SIGN arbitrary data ──
    else if (input.startsWith("SIGN:"))
    {
      String hex = input.substring(5);
      hex.trim();

      int dataLen = hex.length() / 2;
      if (dataLen > 0 && dataLen <= 512)
      {
        uint8_t *data = (uint8_t *)malloc(dataLen);
        if (data && parseHexString(hex, data, dataLen))
        {
          signData(data, dataLen);
        }
        else
        {
          Serial.println("ERROR:Invalid sign data hex");
        }
        if (data) free(data);
      }
      else
      {
        Serial.println("ERROR:Sign data too large or empty");
      }
    }
    // ── PING liveness ──
    else if (input == "PING")
    {
      Serial.println("PONG");
    }
    // ── TEST SHA256 (diagnostic) ──
    else if (input == "TEST")
    {
      // Test SHA-256 with known input
      // SHA-256("test") should be: 9f86d081884c7d6d9ffd60014fc7ee77e0c4e8cc5ffe3a5fe6b827e4c91f7d5e
      uint8_t testInput[] = { 't', 'e', 's', 't' };
      uint8_t testOutput[32];
      memset(testOutput, 0, 32);
      
      sha256(testInput, 4, testOutput);
      
      Serial.print("TEST:SHA256(test)=");
      printHex(testOutput, 32);
      Serial.println();
      Serial.flush();
    }
    // ── DUMP key (diagnostic) ──
    else if (input == "DUMP")
    {
      Serial.print("DUMP:daily_key=");
      printHex(daily_key, 32);
      Serial.println();
      Serial.print("DUMP:public_key=");
      printHex(public_key, 32);
      Serial.println();
      Serial.flush();
    }
    // ── Unknown command ──
    else
    {
      Serial.print("ERROR:Unknown command: ");
      Serial.println(input);
    }
  }
}
