/*
  HC05_SHT40_Data.ino

  Reads a real SHT40 over I2C and sends newline-delimited JSON through an
  HC-05 connected to ESP32 UART2. USB Serial receives the same readings for
  initial sensor verification.

  SHT40 wiring:
    SHT40 SDA -> ESP32 GPIO21
    SHT40 SCL -> ESP32 GPIO22
    SHT40 VDD -> ESP32 3V3
    SHT40 VSS -> ESP32 GND

  HC-05 wiring:
    ESP32 GPIO17 TX -> HC-05 RXD
    ESP32 GPIO16 RX -> HC-05 TXD
    ESP32 GND       -> HC-05 GND

  Arduino Library Manager dependencies:
    Adafruit SHT4x Library
    Adafruit Unified Sensor
*/

#include <Wire.h>
#include <Adafruit_SHT4x.h>

HardwareSerial HC05(2);
Adafruit_SHT4x sht40;

const int SHT40_SDA_PIN = 21;
const int SHT40_SCL_PIN = 22;
const int HC05_RX_PIN = 16;
const int HC05_TX_PIN = 17;

const unsigned long SEND_INTERVAL_MS = 1000;
const char* DEVICE_ID = "HC05_A";

unsigned long lastSendTime = 0;

String buildSensorPacket(
  unsigned long timestamp,
  float humidity,
  float temperature
) {
  String json = "{";
  json += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  json += "\"timestamp\":" + String(timestamp) + ",";
  json += "\"frequency\":0,";
  json += "\"real\":0,";
  json += "\"imag\":0,";
  json += "\"humidity\":" + String(humidity, 2) + ",";
  json += "\"temperature\":" + String(temperature, 2);
  json += "}";
  return json;
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Wire.begin(SHT40_SDA_PIN, SHT40_SCL_PIN);
  HC05.begin(9600, SERIAL_8N1, HC05_RX_PIN, HC05_TX_PIN);

  if (!sht40.begin(&Wire)) {
    Serial.println("SHT40 not detected. Check 3.3 V, GND, SDA, and SCL.");
    while (true) delay(1000);
  }

  sht40.setPrecision(SHT4X_HIGH_PRECISION);
  sht40.setHeater(SHT4X_NO_HEATER);

  Serial.println("SHT40 detected.");
  Serial.println("USB Serial: 115200 baud");
  Serial.println("HC-05 UART: 9600 baud");
}

void loop() {
  unsigned long now = millis();
  if (now - lastSendTime < SEND_INTERVAL_MS) return;
  lastSendTime = now;

  sensors_event_t humidityEvent;
  sensors_event_t temperatureEvent;

  if (!sht40.getEvent(&humidityEvent, &temperatureEvent)) {
    Serial.println("SHT40 read failed.");
    return;
  }

  float humidity = humidityEvent.relative_humidity;
  float temperature = temperatureEvent.temperature;

  Serial.print("Humidity: ");
  Serial.print(humidity, 2);
  Serial.print(" %RH, Temperature: ");
  Serial.print(temperature, 2);
  Serial.println(" C");

  String packet = buildSensorPacket(now, humidity, temperature);

  HC05.print(packet);
  HC05.print('\n');
  Serial.println(packet);
}
