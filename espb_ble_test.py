import asyncio
from bleak import BleakClient, BleakScanner

SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab"
REQUEST_CHAR_UUID = "12345678-1234-1234-1234-1234567890ac"
RESPONSE_CHAR_UUID = "12345678-1234-1234-1234-1234567890ad"

ESP_B_NAME = "ESP-B_Storage"
received_lines = []

def notification_handler(sender, data):
    line = data.decode("utf-8").strip()
    received_lines.append(line)
    print(f"📡 Received from ESP-B: {line}")

async def main():
    print("🔍 Scanning for ESP-B...")
    devices = await BleakScanner.discover()
    esp_b = next((d for d in devices if d.name and ESP_B_NAME in d.name), None)

    if not esp_b:
        print("❌ ESP-B not found. Make sure it's powered and advertising.")
        return

    print(f"✅ Found {esp_b.name} ({esp_b.address}) — connecting...")
    async with BleakClient(esp_b.address) as client:
        print("🔗 Connected. Subscribing to notifications...")

        await client.start_notify(RESPONSE_CHAR_UUID, notification_handler)

        # === Choose your time range in SECONDS relative to ESP-B start ===
        start_seconds = 20
        end_seconds = 40
        time_range = f"{start_seconds},{end_seconds}"

        print(f"📤 Sending time range: {time_range}")
        await client.write_gatt_char(REQUEST_CHAR_UUID, time_range.encode())

        # Allow time for response
        await asyncio.sleep(5)

        await client.stop_notify(RESPONSE_CHAR_UUID)
        print("✅ Finished receiving data.")

if __name__ == "__main__":
    asyncio.run(main())
