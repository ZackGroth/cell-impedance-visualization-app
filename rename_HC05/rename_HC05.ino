// Use AT+NAME=" " to rename
HardwareSerial HC05(2);

const int HC05_RX_PIN = 16;
const int HC05_TX_PIN = 17;

void setup() {
  Serial.begin(115200);
  delay(1000);

  HC05.begin(38400, SERIAL_8N1, HC05_RX_PIN, HC05_TX_PIN);

  Serial.println();
  Serial.println("ESP32 <-> HC-05 AT bridge ready.");
  Serial.println("Serial Monitor: 115200 baud, Both NL & CR.");
}

void loop() {
  while (Serial.available()) {
    HC05.write(Serial.read());
  }

  while (HC05.available()) {
    Serial.write(HC05.read());
  }
}