// HC-SR04 ultrasonic sensor
// Trigger -> pin 10, Echo -> pin 11
const int TRIG_PIN = 10;
const int ECHO_PIN = 11;

void setup()
{
  Serial.begin(9600);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
}

void loop()
{
  // Send a 10 microsecond trigger pulse
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // Measure echo pulse length (timeout 30 ms ~ 5 m)
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0)
  {
    Serial.println("DIST:-1"); // no echo / out of range
  }
  else
  {
    float distanceCm = duration * 0.0343 / 2.0;
    Serial.print("DIST:");
    Serial.println(distanceCm, 1); // sends "DIST:23.4\r\n"
  }

  delay(200);
}
