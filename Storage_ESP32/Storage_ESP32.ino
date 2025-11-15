#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "FS.h"
#include "SPIFFS.h"

#define SERVICE_UUID           "12345678-1234-1234-1234-1234567890ab"
#define REQUEST_CHAR_UUID      "12345678-1234-1234-1234-1234567890ac"
#define RESPONSE_CHAR_UUID     "12345678-1234-1234-1234-1234567890ad"

BLECharacteristic* requestChar;
BLECharacteristic* responseChar;
BLEServer* pServer;

bool deviceConnected = false;
String pendingRequest = "";
bool newRequestReceived = false;

unsigned long startEpoch = 0;

class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("ESP-A connected.");
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("ESP-A disconnected.");
    BLEDevice::startAdvertising();
  }
};

class RequestCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    pendingRequest = characteristic->getValue().c_str();
    newRequestReceived = true;
    Serial.println("Request received: " + pendingRequest);
  }
};

void setupBLE() {
  BLEDevice::init("ESP-B_Storage");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService* service = pServer->createService(SERVICE_UUID);

  requestChar = service->createCharacteristic(
    REQUEST_CHAR_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  requestChar->setCallbacks(new RequestCallback());

  responseChar = service->createCharacteristic(
    RESPONSE_CHAR_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  responseChar->addDescriptor(new BLE2902());

  service->start();
  BLEDevice::startAdvertising();
  Serial.println("BLE Storage Server started...");
}

void generateAndStoreData() {
  unsigned long relativeTime = millis() / 1000;

  float freq = 1000.0 + random(-500, 500);  // simulated frequency
  float R = 700.0 + random(-100, 100);      // real part
  float X = -1.0 / (2.0 * PI * freq * 1e-6); // imaginary part (capacitive)
  X += random(-100, 100) / 10.0;

  float mag = sqrt(R * R + X * X);
  float phase = atan2(X, R) * 180.0 / PI;

  File file = SPIFFS.open("/impedance_data.csv", FILE_APPEND);
  if (file) {
    file.printf("%lu,%.1f,%.2f,%.2f,%.2f,%.2f\n", startEpoch + relativeTime, freq, R, X, mag, phase);
    file.close();
  }
}

void sendDataInRange(unsigned long start, unsigned long end) {
  File file = SPIFFS.open("/impedance_data.csv");
  if (!file) {
    Serial.println("Failed to open CSV.");
    return;
  }

  while (file.available()) {
    String line = file.readStringUntil('\n');
    if (line.length() == 0) continue;

    int commaIdx = line.indexOf(',');
    if (commaIdx == -1) continue;

    unsigned long timestamp = line.substring(0, commaIdx).toInt();
    if (timestamp >= (startEpoch + start) && timestamp <= (startEpoch + end)) {
      responseChar->setValue(line.c_str());
      responseChar->notify();
      delay(50);
    }
  }

  file.close();
  Serial.println("Finished sending data in range.");
}

void setup() {
  Serial.begin(115200);
  delay(500);

  if (!SPIFFS.begin(true)) {
    Serial.println("SPIFFS mount failed!");
    return;
  }

  // Prompt user to input start time manually
  Serial.println("Enter current epoch time (seconds):");
  while (Serial.available() == 0) {
    delay(100);
  }
  startEpoch = Serial.readStringUntil('\n').toInt();
  Serial.printf("Start epoch time set to: %lu\n", startEpoch);

  setupBLE();
}

void loop() {
  static unsigned long lastDataTime = 0;
  if (millis() - lastDataTime > 10000) {
    generateAndStoreData();
    lastDataTime = millis();
  }

  if (deviceConnected && newRequestReceived) {
    newRequestReceived = false;

    int commaIdx = pendingRequest.indexOf(',');
    if (commaIdx == -1) {
      Serial.println("Malformed request.");
      return;
    }

    unsigned long startRel = pendingRequest.substring(0, commaIdx).toInt();
    unsigned long endRel = pendingRequest.substring(commaIdx + 1).toInt();

    Serial.printf("Requesting range: %lus to %lus\n", startRel, endRel);
    sendDataInRange(startRel, endRel);
  }

  delay(100);
}
