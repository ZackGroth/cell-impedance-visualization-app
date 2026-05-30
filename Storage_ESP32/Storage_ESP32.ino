/*
  Storage_ESP32.ino
  Single-ESP32 test firmware for the web app.

  The ESP32 advertises one BLE service and one readable characteristic.
  Every app read returns a fresh simulated JSON packet:
  {
    "timestamp": ...,
    "deviceId": ...,
    "frequency": ...,
    "real impedance": ...,
    "imaginary impedance": ...,
    "relative humidity %": ...
  }

  Each packet is also appended to SPIFFS at /sensor_data.jsonl.
*/

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <esp_system.h>
#include "FS.h"
#include "SPIFFS.h"

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLECharacteristic* sensorCharacteristic;
bool deviceConnected = false;
unsigned long lastSimulationTime = 0;

const char* DATA_FILE = "/sensor_data.jsonl";

const float R_SERIES = 10.0;
const float R_PARALLEL = 500.0;
const float CAPACITANCE = 5e-6;

float frequencies[] = {100, 150, 220, 330, 470, 680, 1000, 1500, 2200, 3300, 4700, 6800, 10000};
const int NUM_FREQUENCIES = sizeof(frequencies) / sizeof(frequencies[0]);
int frequencyIndex = 0;

String latestPacket = "";
String deviceId = "";
String deviceName = "";

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    deviceConnected = true;
    Serial.println("Web app connected.");
  }

  void onDisconnect(BLEServer*) override {
    deviceConnected = false;
    Serial.println("Web app disconnected. Restarting advertising...");
    delay(100);
    BLEDevice::startAdvertising();
  }
};

float randomFloat(float minValue, float maxValue) {
  return minValue + ((float)random(0, 10000) / 10000.0) * (maxValue - minValue);
}

String buildSimulatedPacket() {
  unsigned long timestamp = millis();
  float frequency = frequencies[frequencyIndex];
  frequencyIndex = (frequencyIndex + 1) % NUM_FREQUENCIES;

  float omega = 2.0 * PI * frequency;
  float rcTerm = omega * R_PARALLEL * CAPACITANCE;
  float realParallel = R_PARALLEL / (1.0 + (rcTerm * rcTerm));
  float imagParallel = -(omega * CAPACITANCE * R_PARALLEL * R_PARALLEL) / (1.0 + (rcTerm * rcTerm));

  float realImpedance = R_SERIES + realParallel + randomFloat(-0.5, 0.5);
  float imaginaryImpedance = imagParallel + randomFloat(-1.0, 1.0);

  float humidity = 52.0 + 2.0 * sin(timestamp / 60000.0) + randomFloat(-0.25, 0.25);

  String json = "{";
  json += "\"timestamp\":" + String(timestamp) + ",";
  json += "\"deviceId\":\"" + deviceId + "\",";
  json += "\"frequency\":" + String(frequency, 1) + ",";
  json += "\"real impedance\":" + String(realImpedance, 3) + ",";
  json += "\"imaginary impedance\":" + String(imaginaryImpedance, 3) + ",";
  json += "\"relative humidity %\":" + String(humidity, 2);
  json += "}";

  return json;
}

void appendPacketToStorage(const String& packet) {
  File file = SPIFFS.open(DATA_FILE, FILE_APPEND);
  if (!file) {
    Serial.println("Failed to open storage file.");
    return;
  }

  file.println(packet);
  file.close();
}

void generateStoreAndPublishPacket(bool notifyClient) {
  latestPacket = buildSimulatedPacket();
  appendPacketToStorage(latestPacket);
  sensorCharacteristic->setValue(latestPacket.c_str());

  if (notifyClient && deviceConnected) {
    sensorCharacteristic->notify();
  }

  Serial.println(latestPacket);
}

class SensorReadCallbacks : public BLECharacteristicCallbacks {
  void onRead(BLECharacteristic*) override {
    sensorCharacteristic->setValue(latestPacket.c_str());
  }
};

void setupBLE() {
  uint64_t chipId = ESP.getEfuseMac();
  char suffix[7];
  snprintf(suffix, sizeof(suffix), "%06llX", chipId & 0xFFFFFF);
  deviceId = "ESP32_" + String(suffix);
  deviceName = "ESP32_Storage_" + String(suffix);

  BLEDevice::init(deviceName.c_str());

  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SERVICE_UUID);

  sensorCharacteristic = service->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  sensorCharacteristic->addDescriptor(new BLE2902());
  sensorCharacteristic->setCallbacks(new SensorReadCallbacks());

  latestPacket = buildSimulatedPacket();
  sensorCharacteristic->setValue(latestPacket.c_str());

  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->start();

  Serial.println("BLE storage simulator advertising as " + deviceName + ".");
  Serial.println("Packet deviceId: " + deviceId);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  randomSeed((uint32_t)esp_random());

  if (!SPIFFS.begin(true)) {
    Serial.println("SPIFFS mount failed.");
    return;
  }

  setupBLE();
}

void loop() {
  unsigned long now = millis();

  if (now - lastSimulationTime >= 1000) {
    lastSimulationTime = now;
    generateStoreAndPublishPacket(true);
  }

  delay(100);
}
