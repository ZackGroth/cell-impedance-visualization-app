/* ESP32_HC05_Simulated_Data.ino */
HardwareSerial HC05(2);

const int HC05_RX_PIN = 16;
const int HC05_TX_PIN = 17;
const unsigned long SEND_INTERVAL_MS = 1000;
const char* DEVICE_ID = "HC05_A";

const float R_SERIES = 10.0;
const float R_PARALLEL = 500.0;
const float CAPACITANCE = 5e-6;

const float frequencies[] = {
  100, 150, 220, 330, 470, 680, 1000,
  1500, 2200, 3300, 4700, 6800, 10000
};
const int NUM_FREQUENCIES = sizeof(frequencies) / sizeof(frequencies[0]);
int frequencyIndex = 0;
unsigned long lastSendTime = 0;

float randomFloat(float minValue, float maxValue) {
  return minValue + ((float)random(0, 10000) / 10000.0) * (maxValue - minValue);
}

String buildSimulatedPacket() {
  unsigned long timestamp = millis();
  float frequency = frequencies[frequencyIndex];
  frequencyIndex = (frequencyIndex + 1) % NUM_FREQUENCIES;

  float omega = 2.0 * PI * frequency;
  float rcTerm = omega * R_PARALLEL * CAPACITANCE;
  float denominator = 1.0 + (rcTerm * rcTerm);
  float realParallel = R_PARALLEL / denominator;
  float imagParallel = -(omega * CAPACITANCE * R_PARALLEL * R_PARALLEL) / denominator;
  float realImpedance = R_SERIES + realParallel + randomFloat(-0.5, 0.5);
  float imaginaryImpedance = imagParallel + randomFloat(-1.0, 1.0);
  float humidity = 52.0 + 2.0 * sin(timestamp / 60000.0) + randomFloat(-0.25, 0.25);

  String json = "{";
  json += "\"timestamp\":" + String(timestamp) + ",";
  json += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  json += "\"frequency\":" + String(frequency, 1) + ",";
  json += "\"realImpedance\":" + String(realImpedance, 3) + ",";
  json += "\"imaginaryImpedance\":" + String(imaginaryImpedance, 3) + ",";
  json += "\"relativeHumidity\":" + String(humidity, 2);
  json += "}";
  return json;
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  HC05.begin(9600, SERIAL_8N1, HC05_RX_PIN, HC05_TX_PIN);
  randomSeed(analogRead(34));

  Serial.println();
  Serial.println("ESP32 HC-05 simulated data transmitter started.");
  Serial.println("Sending one JSON packet per second at 9600 baud.");
}

void loop() {
  unsigned long now = millis();
  if (now - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = now;
    String packet = buildSimulatedPacket();
    HC05.println(packet);
    Serial.println(packet);
  }
}
