#define SDA_PIN 32
#define SCL_PIN 33

void setup() {
  Serial.begin(115200);

  pinMode(SDA_PIN, INPUT_PULLUP);
  pinMode(SCL_PIN, INPUT_PULLUP);

  Serial.println("I2C lines set to idle input pullup. Measure SDA/SCL now.");
}

void loop() {
}