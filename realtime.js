/**
 * realtime.js
 * Handles Bluetooth communication with the ESP32 device.
 * Parses incoming impedance data, updates plots in real-time,
 * and manages the live data table.
 */

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const PAPER_MODE = true; // set true for screenshots, false for real BLE

let bodeChart, nyquistChart, timeChart, freqChart;
let tableBody = document.querySelector('#liveDataTable tbody');
let collecting = true;

// Live data stores
let impedanceData = [];     // for bode: { x: freq, zDb, phase }
let nyquistData = [];       // for nyquist: { real, imag, freq }
let timeMagData = [];       // for time chart: { x: timeSec, y: zMag }
let freqMagData = [];       // for freq chart: { x: freq, y: zMag }

let currentViewMode = 'bodeNyquist';

// ------------------------- UTIL: RESIZE FIX -------------------------
function forceResizeAllCharts() {
  // Chart.js often measures 0px when canvas was hidden -> tiny charts after toggling.
  // Do a resize on the next paint frame (after DOM visibility changes apply).
  requestAnimationFrame(() => {
    bodeChart?.resize();
    nyquistChart?.resize();
    timeChart?.resize();
    freqChart?.resize();

    // "none" prevents animation / reflow jank
    bodeChart?.update('none');
    nyquistChart?.update('none');
    timeChart?.update('none');
    freqChart?.update('none');
  });
}

// ------------------------- UI BUTTONS -------------------------
document.getElementById('toggleCollectButton').addEventListener('click', () => {
  collecting = !collecting;
  document.getElementById('toggleCollectButton').textContent =
    collecting ? '⏸️ Pause Collection' : '▶️ Start Collection';
});

document.getElementById('bleConnectButton').addEventListener('click', async () => {
  if (PAPER_MODE) return;

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }]
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', handleNotification);

  } catch (error) {
    console.error('BLE connection failed:', error);
  }
});

// Mode toggle (expects <select id="viewMode">)
const viewModeEl = document.getElementById('viewMode');
if (viewModeEl) {
  viewModeEl.addEventListener('change', (e) => setViewMode(e.target.value));
}

function setViewMode(mode) {
  currentViewMode = mode;

  const bodeNyq = document.getElementById('charts-bodeNyquist');
  const timeFreq = document.getElementById('charts-timeFreq');

  if (bodeNyq && timeFreq) {
    if (mode === 'bodeNyquist') {
      bodeNyq.style.display = '';
      timeFreq.style.display = 'none';
    } else {
      bodeNyq.style.display = 'none';
      timeFreq.style.display = '';
    }
  }

  // Critical: charts must resize AFTER the new container is visible.
  forceResizeAllCharts();
}

// Extra safety: resize when browser window resizes
window.addEventListener('resize', () => forceResizeAllCharts());

// ------------------------- BLE NOTIFICATIONS -------------------------
function handleNotification(event) {
  if (!collecting) return;

  const value = new TextDecoder().decode(event.target.value);

  try {
    const data = JSON.parse(value);
    updateTable(data);
    processData(data);
    updateCharts();
  } catch (e) {
    console.warn('Bad BLE packet:', value);
  }
}

function processData(data) {
  const freq = data.freq;
  const real = data.real;
  const imag = data.imag;

  const zMag = Math.sqrt(real ** 2 + imag ** 2);
  const zDb = 20 * Math.log10(zMag);
  const phase = Math.atan2(imag, real) * (180 / Math.PI);
  const timeSec = parseFloat((data.timestamp / 1000).toFixed(2));

  // Bode data (sorted by frequency)
  impedanceData.push({ x: freq, zDb, phase });
  impedanceData.sort((a, b) => a.x - b.x);

  // Nyquist data
  nyquistData.push({ real, imag, freq });
  if (nyquistData.length > 200) nyquistData.shift();

  // Time vs |Z|
  timeMagData.push({ x: timeSec, y: zMag });
  if (timeMagData.length > 500) timeMagData.shift();

  // Frequency vs |Z|
  freqMagData.push({ x: freq, y: zMag });
  if (freqMagData.length > 500) freqMagData.shift();
}

function updateCharts() {
  // ----- BODE -----
  bodeChart.data.datasets[0].data = impedanceData.map(p => ({ x: p.x, y: p.zDb }));
  bodeChart.data.datasets[1].data = impedanceData.map(p => ({ x: p.x, y: p.phase }));
  bodeChart.update('none');

  // ----- NYQUIST -----
  const sortedNyquist = [...nyquistData].sort((a, b) => a.freq - b.freq);
  nyquistChart.data.datasets[0].data = sortedNyquist.map(p => ({ x: p.real, y: -p.imag }));
  nyquistChart.update('none');

  // ----- TIME vs |Z| -----
  timeChart.data.datasets[0].data = timeMagData;
  timeChart.update('none');

  // ----- FREQ vs |Z| -----
  freqChart.data.datasets[0].data = freqMagData;
  freqChart.update('none');
}

// ------------------------- TABLE -------------------------
function updateTable(data) {
  const zMag = Math.sqrt(data.real ** 2 + data.imag ** 2);

  const row = `
    <tr>
      <td>${(data.timestamp / 1000).toFixed(2)}</td>
      <td>${data.freq}</td>
      <td>${data.real.toFixed(2)}</td>
      <td>${data.imag.toFixed(2)}</td>
      <td>${zMag.toFixed(2)}</td>
    </tr>
  `;

  tableBody.insertAdjacentHTML('beforeend', row);

  if (tableBody.children.length > 50) {
    tableBody.removeChild(tableBody.children[0]);
  }

  document.querySelector('.table-scroll').scrollTop = tableBody.scrollHeight;
}

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

  // |Z| vs Frequency (all points at same freq -> vertical stack of points)
  const series1_freq = time.map((_, i) => ({ x: frequencyHz, y: zMag1[i] }));
  const series2_freq = time.map((_, i) => ({ x: frequencyHz, y: zMag2[i] }));

  freqChart.data.datasets[0].label = 'Z_Mag (measurement 1)';
  freqChart.data.datasets[1].label = 'Z_Mag (measurement 2)';
  freqChart.data.datasets[0].data = series1_freq;
  freqChart.data.datasets[1].data = series2_freq;
  freqChart.update();
}

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
  bodeChart.options.scales.y1.title.text = 'Z_Mag (Ω)';
  bodeChart.options.scales.y2.display = false;

  bodeChart.update();

  // Nyquist cannot be generated without real/imag
  nyquistChart.data.datasets[0].data = [];
  nyquistChart.update();
}

// ------------------------- INIT -------------------------
window.onload = () => {
  // ----- BODE CHART -----
  bodeChart = new Chart(document.getElementById('bodeChart').getContext('2d'), {
    type: 'line',
    data: {
      datasets: [
        { label: '|Z| (dB)', yAxisID: 'y1', pointRadius: 3, fill: false, data: [] },
        { label: 'Phase (°)', yAxisID: 'y2', pointRadius: 3, fill: false, data: [] }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false, // IMPORTANT: prevents shrink/expand weirdness
      animation: false,
      scales: {
        x: { type: 'logarithmic', title: { display: true, text: 'Frequency (Hz)' } },
        y1: { position: 'left', title: { display: true, text: '|Z| (dB)' } },
        y2: { position: 'right', title: { display: true, text: 'Phase (°)' }, grid: { drawOnChartArea: false } }
      }
    }
  });

  // ----- NYQUIST CHART -----
  nyquistChart = new Chart(document.getElementById('nyquistChart').getContext('2d'), {
    type: 'line',
    data: {
      datasets: [{
        label: 'Nyquist Plot',
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
        tension: 0.3,
        fill: false,
        showLine: true,
        data: []
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false, // IMPORTANT
      animation: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Real (Ω)' } },
        y: { type: 'linear', title: { display: true, text: 'Imag (Ω)' }, reverse: true }
      }
    }
  });

  // ----- TIME CHART (|Z| vs time) -----
  timeChart = new Chart(document.getElementById('timeChart').getContext('2d'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Z_Mag', pointRadius: 3, fill: false, data: [] },
        { label: '', pointRadius: 3, fill: false, data: [] } // second dataset used for paper mode
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false, // IMPORTANT
      animation: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Time (s)' } },
        y: { title: { display: true, text: 'Z_Mag (Ω)' } }
      }
    }
  });

  // ----- FREQ CHART (|Z| vs frequency) -----
  freqChart = new Chart(document.getElementById('freqChart').getContext('2d'), {
    type: 'scatter',
    data: {
      datasets: [
        { label: 'Z_Mag', pointRadius: 4, showLine: false, data: [] },
        { label: '', pointRadius: 4, showLine: false, data: [] } // second dataset used for paper mode
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false, // IMPORTANT
      animation: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Frequency (Hz)' } },
        y: { title: { display: true, text: 'Z_Mag (Ω)' } }
      }
    }
  });

  // Default view
  setViewMode(currentViewMode);
  if (viewModeEl) viewModeEl.value = currentViewMode;

  // PAPER MODE: disable BLE and load paper plots
  if (PAPER_MODE) {
    const connectBtn = document.getElementById('bleConnectButton');
    if (connectBtn) connectBtn.disabled = true;

    // Populate time+freq requested view (you can set default view to timeFreq if you want)
    loadPaperTimeFreq();

    // If user flips to bodeNyquist during paper mode, show magnitude-only fallback
    if (viewModeEl) {
      viewModeEl.addEventListener('change', (e) => {
        if (e.target.value === 'bodeNyquist') loadPaperBodeMagnitudeOnly();
      });
    }
  }

  // One more resize after everything initializes
  forceResizeAllCharts();
};
