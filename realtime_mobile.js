/**
 * realtime_mobile.js
 * Mobile-friendly BLE handling, multi-chart plotting, live table,
 * AND a view-mode toggle:
 *  - bodeNyquist: Bode + Nyquist (existing)
 *  - timeFreq: |Z| vs Time + |Z| vs Frequency (paper + live)
 */

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const PAPER_MODE = true; // set true for screenshots, false for real BLE

let bodeChart, nyquistChart, humidityChart, timeChart, freqChart;
let collecting = true;

// Data storage
let bodeData = [];      // { freq, zDb, phase }
let nyquistData = [];   // { real, imag, freq }
let humidityData = [];  // { time, hum }
let timeMagData = [];   // { x: timeSec, y: zMag }
let freqMagData = [];   // { x: freq, y: zMag }

// Table reference
let tableBody = document.querySelector('#dataTable tbody');

// View mode state
let currentViewMode = 'bodeNyquist';

// ------------------------- VIEW MODE TOGGLE -------------------------
// Expects: <select id="viewMode"> with values "bodeNyquist" and "timeFreq"
function setViewMode(mode) {
  currentViewMode = mode;

  // You need these wrappers in index_mobile.html:
  // <div id="charts-bodeNyquist"> ... </div>
  // <div id="charts-timeFreq"> ... </div>
  const bodeNyqWrap = document.getElementById('charts-bodeNyquist');
  const timeFreqWrap = document.getElementById('charts-timeFreq');

  if (bodeNyqWrap && timeFreqWrap) {
    if (mode === 'bodeNyquist') {
      bodeNyqWrap.style.display = '';
      timeFreqWrap.style.display = 'none';
    } else {
      bodeNyqWrap.style.display = 'none';
      timeFreqWrap.style.display = '';
    }
  }

  // If you also use tab canvas switching, we’ll keep it working:
  // When switching modes, ensure the first chart in that mode is visible.
  if (mode === 'bodeNyquist') {
    showCanvas('bodeChart');
  } else {
    showCanvas('timeChart');
  }

  requestAnimationFrame(() => {
    bodeChart?.resize();
    nyquistChart?.resize();
    humidityChart?.resize();
    timeChart?.resize();
    freqChart?.resize();
  });
}

const viewModeEl = document.getElementById('viewMode');
if (viewModeEl) {
  viewModeEl.addEventListener('change', (e) => setViewMode(e.target.value));
}

// Helper for tab system (same as your old logic, but reusable)
function showCanvas(canvasId) {
  const container = document.getElementById('chart-container');
  if (!container) return;

  container.querySelectorAll('canvas').forEach(c => c.classList.add('hidden'));
  const target = document.getElementById(canvasId);
  if (target) target.classList.remove('hidden');
}

// ------------------------- BLE CONNECT -------------------------
document.getElementById('connectBtn').onclick = async () => {
  if (PAPER_MODE) return;

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

// ------------------------- PAPER MODE LOADERS -------------------------
function loadPaperTimeFreq() {
  if (!window.PAPER_DATA) {
    console.error("PAPER_DATA not loaded.");
    return;
  }

  const { time, zMag1, zMag2, frequencyHz } = window.PAPER_DATA;

  // |Z| vs Time (two measurements)
  const series1_time = time.map((t, i) => ({ x: t, y: zMag1[i] }));
  const series2_time = time.map((t, i) => ({ x: t, y: zMag2[i] }));

  timeChart.data.datasets[0].label = 'Z_Mag (measurement 1)';
  timeChart.data.datasets[1].label = 'Z_Mag (measurement 2)';
  timeChart.data.datasets[0].data = series1_time;
  timeChart.data.datasets[1].data = series2_time;
  timeChart.update();

  // |Z| vs Frequency (all points are at 30kHz -> vertical stack of points)
  const series1_freq = time.map((_, i) => ({ x: frequencyHz, y: zMag1[i] }));
  const series2_freq = time.map((_, i) => ({ x: frequencyHz, y: zMag2[i] }));

  freqChart.data.datasets[0].label = 'Z_Mag (measurement 1)';
  freqChart.data.datasets[1].label = 'Z_Mag (measurement 2)';
  freqChart.data.datasets[0].data = series1_freq;
  freqChart.data.datasets[1].data = series2_freq;
  freqChart.update();
}

// Optional: keep your old quick hack for “paper bode” if you want,
// but Nyquist can’t be generated without real/imag.
function loadPaperBodeMagnitudeOnly() {
  if (!window.PAPER_DATA) return;

  const { time, zMag1, zMag2, frequencyHz } = window.PAPER_DATA;
  const series1 = time.map((_, i) => ({ x: frequencyHz, y: zMag1[i] }));
  const series2 = time.map((_, i) => ({ x: frequencyHz, y: zMag2[i] }));

  bodeChart.data.datasets[0].label = 'Z_Mag (measurement 1)';
  bodeChart.data.datasets[1].label = 'Z_Mag (measurement 2)';
  bodeChart.data.datasets[0].data = series1;
  bodeChart.data.datasets[1].data = series2;

  bodeChart.options.scales.x.type = 'linear';
  bodeChart.options.scales.x.title.text = 'Frequency (Hz)';
  bodeChart.update();

  nyquistChart.data.datasets[0].data = [];
  nyquistChart.update();
}

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
    data = JSON.parse(value);   // expects {timestamp, freq, real, imag, humidity?}
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
  const timeSec = parseFloat((d.timestamp / 1000).toFixed(2));

  const zMag = Math.sqrt(real ** 2 + imag ** 2);
  const zDb = 20 * Math.log10(zMag);
  const phase = Math.atan2(imag, real) * (180 / Math.PI);

  // Bode data
  bodeData.push({ freq, zDb, phase });
  bodeData.sort((a, b) => a.freq - b.freq);

  // Nyquist data
  nyquistData.push({ real, imag, freq });
  if (nyquistData.length > 200) nyquistData.shift();

  // Humidity data
  if (d.humidity !== undefined) {
    humidityData.push({ time: timeSec, hum: d.humidity });
    if (humidityData.length > 200) humidityData.shift();
  }

  // Time vs |Z|
  timeMagData.push({ x: timeSec, y: zMag });
  if (timeMagData.length > 500) timeMagData.shift();

  // Frequency vs |Z|
  freqMagData.push({ x: freq, y: zMag });
  if (freqMagData.length > 500) freqMagData.shift();
}

// ------------------------- UPDATE CHARTS -------------------------
function updateCharts() {
  // BODE
  bodeChart.data.datasets[0].data = bodeData.map(p => ({ x: p.freq, y: p.zDb }));
  bodeChart.data.datasets[1].data = bodeData.map(p => ({ x: p.freq, y: p.phase }));
  bodeChart.update('none');

  // NYQUIST
  const sortedN = [...nyquistData].sort((a, b) => a.freq - b.freq);
  nyquistChart.data.datasets[0].data = sortedN.map(p => ({ x: p.real, y: -p.imag }));
  nyquistChart.update('none');

  // HUMIDITY
  humidityChart.data.datasets[0].data = humidityData.map(p => ({ x: p.time, y: p.hum }));
  humidityChart.update('none');

  // TIME vs |Z|
  timeChart.data.datasets[0].data = timeMagData;
  timeChart.update('none');

  // FREQ vs |Z|
  freqChart.data.datasets[0].data = freqMagData;
  freqChart.update('none');
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
        x: { type: 'logarithmic', title: { text: 'Frequency (Hz)', display: true } },
        y: { title: { text: 'dB / Phase', display: true } }
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
        x: { title: { text: 'Real (Ω)', display: true } },
        y: { title: { text: 'Imag (Ω)', display: true }, reverse: true }
      }
    }
  });

  // Humidity Chart
  humidityChart = new Chart(document.getElementById('humidityChart'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Humidity (%)', data: [], borderColor: 'orange', pointRadius: 3, fill: false, tension: 0.2 }
      ]
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: { title: { text: 'Time (s)', display: true } },
        y: { title: { text: 'Humidity (%)', display: true } }
      }
    }
  });

  // NEW: |Z| vs Time
  timeChart = new Chart(document.getElementById('timeChart'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Z_Mag', data: [], borderColor: 'white', pointRadius: 2, fill: false },
        { label: '', data: [], borderColor: 'gray', pointRadius: 2, fill: false } // used in paper mode
      ]
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: { type: 'linear', title: { text: 'Time (s)', display: true } },
        y: { title: { text: 'Z_Mag (Ω)', display: true } }
      }
    }
  });

  // NEW: |Z| vs Frequency
  freqChart = new Chart(document.getElementById('freqChart'), {
    type: 'scatter',
    data: {
      datasets: [
        { label: 'Z_Mag', data: [], borderColor: 'white', pointRadius: 3, showLine: false },
        { label: '', data: [], borderColor: 'gray', pointRadius: 3, showLine: false } // used in paper mode
      ]
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: { type: 'linear', title: { text: 'Frequency (Hz)', display: true } },
        y: { title: { text: 'Z_Mag (Ω)', display: true } }
      }
    }
  });

  // PAPER MODE: disable connect and load paper charts
  if (PAPER_MODE) {
    const connectBtn = document.getElementById('connectBtn');
    if (connectBtn) connectBtn.disabled = true;

    // Load the requested “time + frequency” graphs
    loadPaperTimeFreq();

    // If you flip to bodeNyquist while in paper mode, show magnitude-only fallback
    if (viewModeEl) {
      viewModeEl.addEventListener('change', (e) => {
        if (e.target.value === 'bodeNyquist') loadPaperBodeMagnitudeOnly();
      });
    }
  }

  // Tab logic (kept) — but now we force it to respect current mode
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('bg-gray-800'));
      btn.classList.add('bg-gray-800');

      const target = btn.dataset.tab + 'Chart';

      // If you're in bodeNyquist mode, allow bode/nyquist/humidity tabs.
      // If you're in timeFreq mode, allow time/freq (and optionally humidity).
      if (currentViewMode === 'bodeNyquist') {
        if (target === 'timeChart' || target === 'freqChart') return;
      } else {
        if (target === 'bodeChart' || target === 'nyquistChart') return;
      }

      showCanvas(target);
    };
  });

  // Default view mode
  if (viewModeEl) {
    // If your HTML default is different, it will overwrite this
    setViewMode(viewModeEl.value || 'bodeNyquist');
  } else {
    setViewMode('bodeNyquist');
  }
};
