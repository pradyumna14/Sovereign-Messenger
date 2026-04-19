/*
 * Original ESP8266 Firmware (User's Version)
 * 
 * This is the original firmware provided by the user.
 * See firmware.ino for the enhanced version with READY signal
 * and SIGN/PING command support.
 */

#include <Arduino.h>
#include <bearssl/bearssl.h>
#include <EEPROM.h>

#define SEED_SIZE 32
#define NONCE_SIZE 32
#define USERNAME_SIZE 40

uint8_t master_seed[SEED_SIZE];
uint8_t daily_key[32];
uint8_t public_key[32];

char username[USERNAME_SIZE];

void printHex(uint8_t *data,int len)
{
  for(int i=0;i<len;i++)
  {
    if(data[i]<16) Serial.print("0");
    Serial.print(data[i],HEX);
  }
}

void sha256(uint8_t *data,int len,uint8_t *out)
{
  br_sha256_context ctx;

  br_sha256_init(&ctx);
  br_sha256_update(&ctx,data,len);
  br_sha256_out(&ctx,out);
}

void loadOrCreateSeed()
{
  EEPROM.begin(128);

  bool empty = true;

  for(int i=0;i<SEED_SIZE;i++)
  {
    master_seed[i] = EEPROM.read(i);
    if(master_seed[i] != 0xFF) empty = false;
  }

  if(empty)
  {
    Serial.println("Generating new device seed");

    for(int i=0;i<SEED_SIZE;i++)
    {
      master_seed[i] = random(0,255);
      EEPROM.write(i,master_seed[i]);
    }

    EEPROM.commit();
  }
  else
  {
    Serial.println("Loaded existing device seed");
  }
}

void loadOrSetUsername()
{
  bool empty = true;

  for(int i=0;i<USERNAME_SIZE;i++)
  {
    char c = EEPROM.read(40+i);
    username[i] = c;

    if(c != 0xFF && c != 0x00)
        empty = false;
  }

  if(empty)
  {
    Serial.println("Enter username:");

    while(!Serial.available());

    String input = Serial.readStringUntil('\n');
    input.trim();

    memset(username,0,USERNAME_SIZE);

    for(int i=0;i<input.length() && i<USERNAME_SIZE-1;i++)
    {
      username[i] = input[i];
      EEPROM.write(40+i, username[i]);
    }

    EEPROM.write(40 + input.length(), '\0');

    EEPROM.commit();
  }
}

void deriveDailyKey()
{
  uint8_t buffer[36];

  memcpy(buffer,master_seed,32);

  uint32_t day = millis()/86400000;

  buffer[32] = (day>>24)&0xFF;
  buffer[33] = (day>>16)&0xFF;
  buffer[34] = (day>>8)&0xFF;
  buffer[35] = day&0xFF;

  sha256(buffer,36,daily_key);
}

void generatePublicKey()
{
  sha256(daily_key,32,public_key);
}

void signNonce(uint8_t *nonce)
{
  uint8_t buffer[64];
  uint8_t signature[32];

  memcpy(buffer,daily_key,32);
  memcpy(buffer+32,nonce,32);

  sha256(buffer,64,signature);

  Serial.print("SIGNATURE:");
  printHex(signature,32);
  Serial.println();
}

void setup()
{
  Serial.begin(115200);
  delay(2000);

  Serial.println("ESP8266 AUTH MODULE");

  loadOrCreateSeed();
  loadOrSetUsername();

  deriveDailyKey();
  generatePublicKey();

  Serial.print("USERNAME:");
  Serial.println(username);

  Serial.print("PUBLIC_KEY:");
  printHex(public_key,32);
  Serial.println();
}

void loop()
{
  if(Serial.available())
  {
    String input = Serial.readStringUntil('\n');

    if(input.startsWith("NONCE:"))
    {
      String hex = input.substring(6);

      uint8_t nonce[32];

      for(int i=0;i<32;i++)
      {
        String byteStr = hex.substring(i*2,i*2+2);
        nonce[i] = strtoul(byteStr.c_str(),NULL,16);
      }

      signNonce(nonce);
    }
  }
}
