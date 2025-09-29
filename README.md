# Cell Impedance Visualization App

This web application connects to a Bluetooth-enabled ESP32 device that simulates an RC circuit. It streams complex impedance data in real time and visualizes it using **Bode** and **Nyquist** plots. The tool is designed for use in bioelectrical measurement applications such as ingestible or wearable impedance sensing systems.

---

##  How It Works

- The **ESP32 microcontroller** simulates impedance data from an RC circuit and sends:
  - `timestamp` – Time in milliseconds since power-on
  - `freq` – Frequency of measurement (Hz)
  - `real` – Real part of impedance (Ω)
  - `imag` – Imaginary part of impedance (Ω)

- The **Web App** connects via the [Web Bluetooth API](https://web.dev/bluetooth/), parses the incoming JSON data, and:
  - Calculates `|Z| (dB)` and phase angle (°)
  - Updates the **Bode plot**:
    - Left Y-axis: Magnitude (dB)
    - Right Y-axis: Phase (°)
  - Updates the **Nyquist plot**:
    - X-axis: Real (Ω)
    - Y-axis: –Imaginary (Ω) (flipped for convention)
  - Displays data in a **live scrollable table**

---

## 🗂 File Overview

| File                | Description |
|---------------------|-------------|
| `index.html`        | Main interface (BLE connect button, chart layout, data table) |
| `realtime.js`       | Handles BLE communication, chart updates, and table rendering |
| `Server/Server.ino` | Arduino sketch simulating RC impedance and sending BLE JSON |
| `README.md`         | This documentation file |
| `script.js` _(unused)_ | Legacy JS file for mock testing (no longer used) |
| `upload.html` _(unused)_ | Legacy file upload interface (no longer used) |

---

## Setup Instructions

### 1. Flash ESP32
Upload `Server.ino` to an ESP32 board using the Arduino IDE. The sketch will:
- Simulate impedance across a log-spaced frequency sweep
- Add light random noise to resemble real measurements
- Broadcast BLE JSON packets every 500 ms

### 2. Open Web App
- Open `index.html` in **Google Chrome** or another [Web Bluetooth–compatible browser](https://caniuse.com/web-bluetooth).
- Click **"🔗 Connect BLE"** to pair with your ESP32.
- Click **"⏸️ / ▶️"** to start or pause data collection.

### 3. View Results
- View real-time Bode and Nyquist plots
- Inspect the live-updating data table (with impedance breakdown)
- Scroll locked UI ensures visibility of both charts and table

---

## Next Steps (Planned Features)

- Export impedance data as `.csv`
- Multiple BLE device support
- Toggle between different chart layouts (e.g., Time-Domain mode)
- Interactive impedance calibration or annotation tools

---

##  Author

**Zack Groth**  
Biomedical Sciences & Computer Engineering  
University of Central Florida | Burnett Honors College  
[GitHub](https://github.com/ZackGroth)
