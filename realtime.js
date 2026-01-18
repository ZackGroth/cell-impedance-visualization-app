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
  requestAnimationFrame(() => {
    bodeChart?.resize();
    nyquistChart?.resize();
    timeChart?.resize();
    freqChart?.resize();

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

  forceResizeAllCharts();
}

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
  // If paper mode rebuilt datasets dynamically, keep using dataset[0] as live stream target.
  if (timeChart.data.datasets.length > 0) {
    timeChart.data.datasets[0].data = timeMagData;
  }
  timeChart.update('none');

  // ----- FREQ vs |Z| -----
  if (freqChart.data.datasets.length > 0) {
    freqChart.data.datasets[0].data = freqMagData;
  }
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

// ------------------------- PAPER MODE: DYNAMIC DATASETS -------------------------
function getZSeriesFromPaperData(P) {
  // Returns an array of { name, values } for any zMag* arrays that match time length.
  const series = [];
  if (!P || !Array.isArray(P.time)) return series;

  const n = P.time.length;

  if (Array.isArray(P.zMag1) && P.zMag1.length === n) series.push({ name: 'Z_Mag', values: P.zMag1 });
  if (Array.isArray(P.zMag2) && P.zMag2.length === n) series.push({ name: 'Z_Mag (2)', values: P.zMag2 });

  return series;
}

function applyTimeChartDatasets(chart, time, zSeries) {
  chart.data.datasets = zSeries.map(s => ({
    label: s.name,
    data: time.map((t, i) => ({ x: t, y: s.values[i] })),
    pointRadius: 3,
    fill: false
  }));
  chart.update();
}

function applyFreqChartDatasets(chart, time, freqHz, zSeries) {
  chart.data.datasets = zSeries.map(s => ({
    label: s.name,
    data: time.map((_, i) => ({ x: freqHz, y: s.values[i] })),
    pointRadius: 4,
    showLine: false
  }));
  chart.update();
}

function loadPaperTimeFreq() {
  if (!window.PAPER_DATA) return;

  const P = window.PAPER_DATA;
  const { time, frequencyHz } = P;

  const zSeries = getZSeriesFromPaperData(P);
  if (zSeries.length === 0) {
    console.error("No valid zMag arrays found (need zMag1 with same length as time).");
    return;
  }

  applyTimeChartDatasets(timeChart, time, zSeries);
  applyFreqChartDatasets(freqChart, time, frequencyHz, zSeries);
}

function loadPaperBodeMagnitudeOnly() {
  if (!window.PAPER_DATA) return;

  const P = window.PAPER_DATA;
  const { time, frequencyHz } = P;

  const zSeries = getZSeriesFromPaperData(P);
  if (zSeries.length === 0) {
    console.error("No valid zMag arrays found for bode magnitude-only fallback.");
    return;
  }

  // Plot each Z series as a vertical stack at a single frequency (since only magnitude is provided)
  const datasets = zSeries.map((s) => ({
    label: s.name,
    data: time.map((_, i) => ({ x: frequencyHz, y: s.values[i] })),
    pointRadius: 3,
    fill: false,
    showLine: false
  }));

  // Replace bode datasets with magnitude-only datasets
  bodeChart.data.datasets = datasets;

  bodeChart.options.scales.x.type = 'linear';
  bodeChart.options.scales.x.title.text = 'Frequency (Hz)';
  // In this fallback, we only have one y-axis effectively
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
      maintainAspectRatio: false,
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
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Real (Ω)' } },
        y: { type: 'linear', title: { display: true, text: 'Imag (Ω)' }, reverse: true }
      }
    }
  });

  // ----- TIME CHART -----
  // Start with ONE dataset; paper mode will replace datasets dynamically if needed.
  timeChart = new Chart(document.getElementById('timeChart').getContext('2d'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Z_Mag', pointRadius: 3, fill: false, data: [] }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Time (s)' } },
        y: { title: { display: true, text: 'Z_Mag (Ω)' } }
      }
    }
  });

  // ----- FREQ CHART -----
  // Start with ONE dataset; paper mode will replace datasets dynamically if needed.
  freqChart = new Chart(document.getElementById('freqChart').getContext('2d'), {
    type: 'scatter',
    data: {
      datasets: [
        { label: 'Z_Mag', pointRadius: 4, showLine: false, data: [] }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
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

    // Populate time+freq requested view
    loadPaperTimeFreq();

    // If user flips to bodeNyquist during paper mode, show magnitude-only fallback
    if (viewModeEl) {
      viewModeEl.addEventListener('change', (e) => {
        if (e.target.value === 'bodeNyquist') loadPaperBodeMagnitudeOnly();
      });
    }
  }

  forceResizeAllCharts();
};
