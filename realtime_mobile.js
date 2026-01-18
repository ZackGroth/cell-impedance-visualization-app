/**
 * realtime_mobile.js
 * Mobile-friendly BLE handling + correct UI switching.
 *
 * Requires these IDs in index_mobile.html:
 *  - connectBtn, startBtn
 *  - viewMode (select with values: bodeNyquist, timeFreq)
 *  - tabs-bodeNyquist (buttons .tab-btn with data-tab="bode|nyquist|humidity")
 *  - tabs-timeFreq (buttons .tab-btn2 with data-tab="time|freq")
 *  - canvases: bodeChart, nyquistChart, humidityChart, timeChart, freqChart
 *  - table: #dataTable tbody
 */

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const PAPER_MODE = true; // true for screenshots, false for real BLE

let collecting = true;

// Charts
let bodeChart, nyquistChart, humidityChart, timeChart, freqChart;

// Data
let bodeData = [];      // { freq, zDb, phase }
let nyquistData = [];   // { real, imag, freq }
let humidityData = [];  // { time, hum }
let timeMagData = [];   // { x: timeSec, y: zMag }
let freqMagData = [];   // { x: freq, y: zMag }

// Table
let tableBody = document.querySelector('#dataTable tbody');

// UI
let currentMode = 'bodeNyquist';   // 'bodeNyquist' | 'timeFreq'
let currentTab = 'bode';           // active chart within mode

// ------------------------- VISIBILITY HELPERS -------------------------
function hideAllCanvases() {
  ['bodeChart','nyquistChart','humidityChart','timeChart','freqChart'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

function showCanvas(id) {
  hideAllCanvases();
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function setActiveTabStyles() {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('bg-gray-800'));
  document.querySelectorAll('.tab-btn2').forEach(b => b.classList.remove('bg-gray-800'));

  if (currentMode === 'bodeNyquist') {
    const btn = document.querySelector(`.tab-btn[data-tab="${currentTab}"]`);
    if (btn) btn.classList.add('bg-gray-800');
  } else {
    const btn = document.querySelector(`.tab-btn2[data-tab="${currentTab}"]`);
    if (btn) btn.classList.add('bg-gray-800');
  }
}

function forceResizeAllCharts() {
  requestAnimationFrame(() => {
    bodeChart?.resize(); bodeChart?.update('none');
    nyquistChart?.resize(); nyquistChart?.update('none');
    humidityChart?.resize(); humidityChart?.update('none');
    timeChart?.resize(); timeChart?.update('none');
    freqChart?.resize(); freqChart?.update('none');
  });
}

function setMode(mode) {
  currentMode = mode;

  const tabs1 = document.getElementById('tabs-bodeNyquist');
  const tabs2 = document.getElementById('tabs-timeFreq');

  if (mode === 'bodeNyquist') {
    if (tabs1) tabs1.classList.remove('hidden');
    if (tabs2) tabs2.classList.add('hidden');
    currentTab = 'bode';
    showCanvas('bodeChart');
  } else {
    if (tabs1) tabs1.classList.add('hidden');
    if (tabs2) tabs2.classList.remove('hidden');
    currentTab = 'time';
    showCanvas('timeChart');
  }

  setActiveTabStyles();
  forceResizeAllCharts();
}

function setTab(tabName) {
  currentTab = tabName;

  if (currentMode === 'bodeNyquist') {
    if (tabName === 'bode') showCanvas('bodeChart');
    if (tabName === 'nyquist') showCanvas('nyquistChart');
    if (tabName === 'humidity') showCanvas('humidityChart');
  } else {
    if (tabName === 'time') showCanvas('timeChart');
    if (tabName === 'freq') showCanvas('freqChart');
  }

  setActiveTabStyles();
  forceResizeAllCharts();
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

// ------------------------- START/STOP -------------------------
document.getElementById('startBtn').onclick = () => {
  collecting = !collecting;
  document.getElementById('startBtn').textContent = collecting ? "Pause" : "Start";
};

// ------------------------- NOTIFICATION HANDLER -------------------------
function onNotification(event) {
  if (!collecting) return;

  const value = new TextDecoder().decode(event.target.value);

  let d;
  try {
    d = JSON.parse(value);   // expects {timestamp, freq, real, imag, humidity?}
  } catch {
    console.warn("Bad BLE packet:", value);
    return;
  }

  processData(d);
  updateTable(d);
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

  bodeData.push({ freq, zDb, phase });
  bodeData.sort((a, b) => a.freq - b.freq);

  nyquistData.push({ real, imag, freq });
  if (nyquistData.length > 200) nyquistData.shift();

  timeMagData.push({ x: timeSec, y: zMag });
  if (timeMagData.length > 500) timeMagData.shift();

  freqMagData.push({ x: freq, y: zMag });
  if (freqMagData.length > 500) freqMagData.shift();

  if (d.humidity !== undefined) {
    humidityData.push({ time: timeSec, hum: d.humidity });
    if (humidityData.length > 500) humidityData.shift();
  }
}

// ------------------------- UPDATE CHARTS -------------------------
function updateCharts() {
  bodeChart.data.datasets[0].data = bodeData.map(p => ({ x: p.freq, y: p.zDb }));
  bodeChart.data.datasets[1].data = bodeData.map(p => ({ x: p.freq, y: p.phase }));
  bodeChart.update('none');

  const sortedN = [...nyquistData].sort((a, b) => a.freq - b.freq);
  nyquistChart.data.datasets[0].data = sortedN.map(p => ({ x: p.real, y: -p.imag }));
  nyquistChart.update('none');

  humidityChart.data.datasets[0].data = humidityData.map(p => ({ x: p.time, y: p.hum }));
  humidityChart.update('none');

  timeChart.data.datasets[0].data = timeMagData;
  timeChart.update('none');

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
      <td>${(Math.atan2(d.imag, d.real) * (180 / Math.PI)).toFixed(1)}</td>
      <td>${d.humidity ?? "-"}</td>
    </tr>
  `;

  tableBody.insertAdjacentHTML('beforeend', row);
  if (tableBody.children.length > 100) tableBody.removeChild(tableBody.children[0]);
}

// ------------------------- PAPER MODE: DYNAMIC DATASETS -------------------------
function getZSeriesFromPaperData(P) {
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
    pointRadius: 2,
    fill: false
  }));
  chart.update();
}

function applyFreqChartDatasets(chart, time, freqHz, zSeries) {
  chart.data.datasets = zSeries.map(s => ({
    label: s.name,
    data: time.map((_, i) => ({ x: freqHz, y: s.values[i] })),
    pointRadius: 3,
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

// ------------------------- INIT -------------------------
window.onload = () => {
  const viewSel = document.getElementById('viewMode');
  if (viewSel) viewSel.addEventListener('change', (e) => setMode(e.target.value));

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  document.querySelectorAll('.tab-btn2').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  bodeChart = new Chart(document.getElementById('bodeChart').getContext('2d'), {
    type: 'line',
    data: { datasets: [
      { label: '|Z| (dB)', data: [], pointRadius: 2, fill: false },
      { label: 'Phase (°)', data: [], pointRadius: 2, fill: false }
    ]},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { type: 'logarithmic', title: { display: true, text: 'Frequency (Hz)' } },
        y: { title: { display: true, text: 'dB / Phase' } }
      }
    }
  });

  nyquistChart = new Chart(document.getElementById('nyquistChart').getContext('2d'), {
    type: 'line',
    data: { datasets: [
      { label: 'Nyquist', data: [], pointRadius: 3, showLine: true, fill: false, tension: 0.2 }
    ]},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { title: { display: true, text: 'Real (Ω)' } },
        y: { title: { display: true, text: 'Imag (Ω)' }, reverse: true }
      }
    }
  });

  humidityChart = new Chart(document.getElementById('humidityChart').getContext('2d'), {
    type: 'line',
    data: { datasets: [
      { label: 'Ingress (µL)', data: [], pointRadius: 2, fill: false, tension: 0.2 }
    ]},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { title: { display: true, text: 'Time (s)' } },
        y: { title: { display: true, text: 'Ingress (µL)' } }
      }
    }
  });

  timeChart = new Chart(document.getElementById('timeChart').getContext('2d'), {
    type: 'line',
    data: { datasets: [
      { label: 'Z_Mag', data: [], pointRadius: 2, fill: false }
    ]},
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

  freqChart = new Chart(document.getElementById('freqChart').getContext('2d'), {
    type: 'scatter',
    data: { datasets: [
      { label: 'Z_Mag', data: [], pointRadius: 3, showLine: false }
    ]},
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

  setMode(viewSel?.value || 'bodeNyquist');

  if (PAPER_MODE) {
    const connectBtn = document.getElementById('connectBtn');
    if (connectBtn) connectBtn.disabled = true;

    if (viewSel) viewSel.value = 'timeFreq';
    setMode('timeFreq');
    loadPaperTimeFreq();
  }
};
