import asyncio
from bleak import BleakClient
import json
import time

# Replace with your receiver’s MAC address (you’ll use your desktop’s address when ready)
RECEIVER_ADDRESS = "XX:XX:XX:XX:XX:XX"
CHAR_UUID = "00002a37-0000-1000-8000-00805f9b34fb"  # Replace if needed

mock_data = [
    {"time": 0, "frequency": 1000, "real": 110, "imag": 30},
    {"time": 1, "frequency": 2000, "real": 112, "imag": 32},
    {"time": 2, "frequency": 3000, "real": 115, "imag": 35},
    {"time": 3, "frequency": 4000, "real": 118, "imag": 37},
    {"time": 4, "frequency": 5000, "real": 120, "imag": 40},
]

async def send_data():
    async with BleakClient(RECEIVER_ADDRESS) as client:
        print("Connected to receiver.")
        for entry in mock_data:
            payload = json.dumps(entry).encode('utf-8')
            await client.write_gatt_char(CHAR_UUID, payload)
            print("Sent:", entry)
            time.sleep(1)

asyncio.run(send_data())
