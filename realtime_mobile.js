/**
 * realtime_mobile.js
 * Mobile-friendly BLE handling, multi-chart plotting, and live data table.
 */

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

let bodeChart, nyquistChart, humidityChart;
let collecting = true;

// Data storage
let bodeData = [];      // { freq, zDb, phase }
let nyquistData = [];   // { real, imag, freq }
let humidityData = [];  // { time, humidity }

// Table reference
let tableBody = document.querySelector('#dataTable tbody');


// ------------------------- BLE CONNECT -------------------------
document.getElementById('connectBtn').onclick = async () => {
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }]
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', onNotification);

    alert("BLE connected!");
  } catch (err) {
    console.error("BLE Connection Failed:", err);
    alert("BLE connection failed.");
  }
};


// ------------------------- START/STOP -------------------------
document.getElementById('startBtn').onclick = () => {
  collecting = !collecting;
  document.getElementById('startBtn').textContent = collecting ? "Pause" : "Start";
};


// ------------------------- NOTIFICATION HANDLER -------------------------
function onNotification(event) {
  if (!collecting) return;

  const value = new TextDecoder().decode(event.target.value);

  let data;
  try {
    data = JSON.parse(value);   // expects {timestamp, freq, real, imag, humidity}
  } catch (e) {
    console.warn("Bad BLE packet:", value);
    return;
  }

  processData(data);
  updateTable(data);
  updateCharts();
}


// ------------------------- PROCESS DATA -------------------------
function processData(d) {
  const real = d.real;
  const imag = d.imag;
  const freq = d.freq;
  const timeSec = (d.timestamp / 1000).toFixed(2);

  // Impedance magnitude + phase
  const zMag = Math.sqrt(real ** 2 + imag ** 2);
  const zDb = 20 * Math.log10(zMag);
  const phase = Math.atan2(imag, real) * (180 / Math.PI);

  // Save Bode data
  bodeData.push({ freq, zDb, phase });
  bodeData.sort((a, b) => a.freq - b.freq);

  // Save Nyquist data
  nyquistData.push({ real, imag, freq });
  if (nyquistData.length > 200) nyquistData.shift();

  // Save Humidity data
  if (d.humidity !== undefined) {
    humidityData.push({ time: parseFloat(timeSec), hum: d.humidity });
    if (humidityData.length > 200) humidityData.shift();
  }
}


// ------------------------- UPDATE CHARTS -------------------------
function updateCharts() {
  // BODE
  bodeChart.data.datasets[0].data = bodeData.map(p => ({ x: p.freq, y: p.zDb }));
  bodeChart.data.datasets[1].data = bodeData.map(p => ({ x: p.freq, y: p.phase }));
  bodeChart.update();

  // NYQUIST
  const sortedN = [...nyquistData].sort((a, b) => a.freq - b.freq);
  nyquistChart.data.datasets[0].data = sortedN.map(p => ({ x: p.real, y: -p.imag }));
  nyquistChart.update();

  // HUMIDITY
  humidityChart.data.datasets[0].data = humidityData.map(p => ({ x: p.time, y: p.hum }));
  humidityChart.update();
}


// ------------------------- UPDATE TABLE -------------------------
function updateTable(d) {
  const zMag = Math.sqrt(d.real ** 2 + d.imag ** 2).toFixed(2);
  const time = (d.timestamp / 1000).toFixed(2);

  const row = `
    <tr>
      <td>${time}</td>
      <td>${d.freq}</td>
      <td>${zMag}</td>
      <td>${d.phase || "-"}</td>
      <td>${d.humidity ?? "-"}</td>
    </tr>
  `;

  tableBody.insertAdjacentHTML('beforeend', row);
  if (tableBody.children.length > 100) tableBody.removeChild(tableBody.children[0]);
}


// ------------------------- CHART INITIALIZATION -------------------------
window.onload = () => {

  // Bode chart
  bodeChart = new Chart(document.getElementById('bodeChart'), {
    type: 'line',
    data: {
      datasets: [
        { label: '|Z| (dB)', data: [], borderColor: 'cyan', pointRadius: 2 },
        { label: 'Phase (°)', data: [], borderColor: 'magenta', pointRadius: 2 }
      ]
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: { type: 'logarithmic', title: { text: 'Frequency (Hz)', display: true }},
        y: { title: { text: 'dB / Phase', display: true }}
      }
    }
  });

  // Nyquist Chart
  nyquistChart = new Chart(document.getElementById('nyquistChart'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Nyquist', data: [], borderColor: 'lime', pointRadius: 3, showLine: true }
      ]
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: { title: { text: 'Real (Ω)', display: true }},
        y: { title: { text: 'Imag (Ω)', display: true }, reverse: true }
      }
    }
  });

  // Humidity Chart (NEW)
  humidityChart = new Chart(document.getElementById('humidityChart'), {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Humidity (%)',
          data: [],
          borderColor: 'orange',
          pointRadius: 3,
          fill: false,
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: { title: { text: 'Time (s)', display: true }},
        y: { title: { text: 'Humidity (%)', display: true }}
      }
    }
  });

  // Tab logic
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('bg-gray-800'));
      btn.classList.add('bg-gray-800');

      const target = btn.dataset.tab + 'Chart';

      document.querySelectorAll('#chart-container canvas').forEach(c =>
        c.classList.add('hidden')
      );
      document.getElementById(target).classList.remove('hidden');
    };
  });
};
