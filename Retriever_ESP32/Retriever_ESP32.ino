#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEClient.h>
#include <BLEAddress.h>
#include <BLEScan.h>
#include <BLE2902.h>

#define SERVICE_UUID           "12345678-1234-1234-1234-1234567890ab"
#define REQUEST_CHAR_UUID      "12345678-1234-1234-1234-1234567890ac"
#define RESPONSE_CHAR_UUID     "12345678-1234-1234-1234-1234567890ad"

BLEClient* pClient = nullptr;
BLERemoteCharacteristic* requestChar = nullptr;
BLERemoteCharacteristic* responseChar = nullptr;

bool connected = false;
bool newDataReceived = false;

static void notifyCallback(
  BLERemoteCharacteristic*,
  uint8_t* pData,
  size_t length,
  bool isNotify
) {
  String line;
  for (size_t i = 0; i < length; i++) line += (char)pData[i];
  Serial.print("📡 "); Serial.println(line);
  newDataReceived = true;
}

bool connectToESP_B() {
  Serial.println("🔍 Scanning for ESP-B_Storage...");
  BLEScan* pScan = BLEDevice::getScan();
  pScan->setActiveScan(true);
  BLEScanResults* results = pScan->start(5);      // your core returns pointer

  for (int i = 0; i < results->getCount(); i++) {
    BLEAdvertisedDevice dev = results->getDevice(i);
    if (dev.getName() == "ESP-B_Storage") {
      Serial.println("✅ Found ESP-B_Storage. Connecting...");
      pClient = BLEDevice::createClient();
      if (!pClient->connect(&dev)) { Serial.println("❌ Connect fail."); return false; }

      BLERemoteService* svc = pClient->getService(SERVICE_UUID);
      if (!svc) { Serial.println("❌ No service."); return false; }

      requestChar  = svc->getCharacteristic(REQUEST_CHAR_UUID);
      responseChar = svc->getCharacteristic(RESPONSE_CHAR_UUID);
      if (!requestChar || !responseChar) { Serial.println("❌ Missing chars."); return false; }

      if (responseChar->canNotify()) responseChar->registerForNotify(notifyCallback);

      connected = true;
      Serial.println("🔗 Connected.");
      return true;
    }
  }
  Serial.println("❌ ESP-B_Storage not found.");
  return false;
}

void requestData(const String& startOffset, const String& endOffset) {
  if (!connected || !requestChar) return;
  String request = startOffset + "," + endOffset;
  Serial.println("📤 Sending: " + request);
  requestChar->writeValue(request.c_str());
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== ESP-A (Retriever) Ready ===");
  BLEDevice::init("ESP-A_Requester");

  if (!connectToESP_B()) {
    Serial.println("⚠️ Could not connect. Will retry in loop.");
  } else {
    Serial.println("Type a time range like 20,60 and press Enter:");
  }
}

void loop() {
  if (!connected) {
    if (connectToESP_B()) Serial.println("Type a time range like 20,60 and press Enter:");
    delay(3000);
    return;
  }

  if (Serial.available()) {
    String input = Serial.readStringUntil('\n');
    input.trim();
    int comma = input.indexOf(',');
    if (comma > 0) {
      String start = input.substring(0, comma);
      String end   = input.substring(comma + 1);
      requestData(start, end);
    } else {
      Serial.println("⚠️ Invalid format. Use start,end (e.g. 30,90).");
    }
  }

  delay(100);
}
