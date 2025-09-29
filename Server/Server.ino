#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLECharacteristic *pCharacteristic;
bool deviceConnected = false;
unsigned long lastSendTime = 0;

// Simulated circuit parameters
const float R_series = 10.0;     // Ohms (series resistance)
const float R_parallel = 500.0;  // Ohms (parallel resistance)
const float C = 5e-6;            // Farads (capacitance)

// Logarithmic frequency sweep (like EIS)
float freqs[] = {100, 150, 220, 330, 470, 680, 1000, 1500, 2200, 3300, 4700, 6800, 10000};
int freqIndex = 0;
const int numFreqs = sizeof(freqs) / sizeof(freqs[0]);

class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("Device connected");
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("Disconnected. Restarting advertising...");
    delay(100);
    BLEDevice::startAdvertising();
  }
};

void setup() {
  Serial.begin(115200);
  BLEDevice::init("ESP32_Impedance_Sim");
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_NOTIFY
                    );
  pCharacteristic->addDescriptor(new BLE2902());
  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->start();
  Serial.println("Advertising started...");
}

void loop() {
  if (!deviceConnected) return;

  unsigned long currentMillis = millis();
  if (currentMillis - lastSendTime >= 500) { // send every 500 ms
    lastSendTime = currentMillis;

    float freq = freqs[freqIndex];
    freqIndex = (freqIndex + 1) % numFreqs;

    // Angular frequency
    float omega = 2.0 * PI * freq;

    // Impedance of RC in parallel with R_series
    // Z_parallel = (R_parallel || 1/(jωC))
    float real_parallel = (R_parallel) / (1 + pow(omega * R_parallel * C, 2));
    float imag_parallel = -(omega * C * R_parallel * R_parallel) / (1 + pow(omega * R_parallel * C, 2));

    // Total impedance = R_series + Z_parallel
    float realZ = R_series + real_parallel;
    float imagZ = imag_parallel;

    // Add small noise to simulate real measurement scatter
    realZ += random(-50, 50) / 100.0;   // ±0.5 Ω noise
    imagZ += random(-100, 100) / 100.0; // ±1 Ω noise

    // JSON string
    String json = "{";
    json += "\"timestamp\":" + String(currentMillis) + ",";
    json += "\"freq\":" + String(freq, 1) + ",";
    json += "\"real\":" + String(realZ, 2) + ",";
    json += "\"imag\":" + String(imagZ, 2);
    json += "}";

    pCharacteristic->setValue(json.c_str());
    pCharacteristic->notify();

    Serial.println(json); // Debug output
  }
}
