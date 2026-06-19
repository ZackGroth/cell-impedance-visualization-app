/**
 * realtime.js
 * Handles the web app controls, BLE packet parsing, impedance calculations,
 * chart updates, and live tables.
 */

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const DEMO_MODE = false;

let bodeChart;
let nyquistChart;
let humidityChart;
let collectionTimer = null;
let collecting = false;

const impedanceRows = [];
const humidityRows = [];

const nodes = {
  A: { label: 'ESP32-A', device: null },
  B: { label: 'ESP32-B', device: null }
};

const els = {
  themeToggle: document.getElementById('themeToggle'),
  startCycleButton: document.getElementById('startCycleButton'),
  pairNodeAButton: document.getElementById('pairNodeAButton'),
  pairNodeBButton: document.getElementById('pairNodeBButton'),
  collectionInterval: document.getElementById('collectionInterval'),
  viewMode: document.getElementById('viewMode'),
  collectionStatus: document.getElementById('collectionStatus'),
  bodeView: document.getElementById('bodeView'),
  nyquistView: document.getElementById('nyquistView'),
  humidityView: document.getElementById('humidityView'),
  bodeTableBody: document.getElementById('bodeTableBody'),
  nyquistTableBody: document.getElementById('nyquistTableBody'),
  humidityTableBody: document.getElementById('humidityTableBody')
};

function numberFrom(data, keys) {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && value !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function stringFrom(data, keys, fallback = '') {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return fallback;
}

function normalizeImpedancePacket(data, fallbackDeviceId = 'ESP32') {
  const timestamp = numberFrom(data, ['timestamp', 'time', 't']);
  const frequency = numberFrom(data, ['frequency', 'freq', 'frequencyHz']);
  const real = numberFrom(data, ['real', 'realImpedance', 'real impedance']);
  const imag = numberFrom(data, ['imag', 'imaginary', 'imaginaryImpedance', 'imaginary impedance']);
  const deviceId = stringFrom(data, ['deviceId', 'deviceID', 'id'], fallbackDeviceId);

  if (timestamp === null || frequency === null || real === null || imag === null) {
    return null;
  }

  const magnitude = Math.sqrt((real ** 2) + (imag ** 2));
  const phase = Math.atan2(imag, real) * (180 / Math.PI);
  const magnitudeDb = 20 * Math.log10(magnitude);

  return {
    timestamp,
    timeSec: timestamp > 1000000000 ? timestamp : timestamp / 1000,
    deviceId,
    frequency,
    real,
    imag,
    magnitude,
    magnitudeDb,
    phase
  };
}

function normalizeHumidityPacket(data, fallbackDeviceId = 'ESP32') {
  const humidity = numberFrom(data, ['humidity', 'humidity %', 'relativeHumidity', 'relative humidity %', 'rh']);
  if (humidity === null) return null;

  const timestamp = numberFrom(data, ['timestamp', 'time', 't']) ?? Date.now();

  return {
    timestamp,
    timeSec: timestamp > 1000000000 ? timestamp / 1000 : timestamp / 1000,
    deviceId: stringFrom(data, ['deviceId', 'deviceID', 'id'], fallbackDeviceId),
    humidity
  };
}

function formatTime(timestamp) {
  if (timestamp > 1000000000) {
    return new Date(timestamp).toLocaleTimeString();
  }
  return `${(timestamp / 1000).toFixed(2)} s`;
}

function trimRows(rows, maxRows = 200) {
  while (rows.length > maxRows) rows.shift();
}

function addPacket(data, fallbackDeviceId) {
  const impedance = normalizeImpedancePacket(data, fallbackDeviceId);
  if (impedance) {
    impedanceRows.push(impedance);
    trimRows(impedanceRows);
    updateImpedanceViews();
  }

  const humidity = normalizeHumidityPacket(data, fallbackDeviceId);
  if (humidity) {
    humidityRows.push(humidity);
    trimRows(humidityRows);
    updateHumidityView();
  }

  if (!impedance && !humidity) {
    console.warn('Packet did not include supported data fields:', data);
  }
}

function updateImpedanceViews() {
  const sortedByFrequency = [...impedanceRows].sort((a, b) => a.frequency - b.frequency);
  const deviceIds = [...new Set(sortedByFrequency.map(row => row.deviceId))];

  bodeChart.data.datasets = deviceIds.flatMap(deviceId => {
    const rows = sortedByFrequency.filter(row => row.deviceId === deviceId);
    return [
      {
        label: `${deviceId} |Z| (dB)`,
        yAxisID: 'magnitudeAxis',
        data: rows.map(row => ({ x: row.frequency, y: row.magnitudeDb })),
        pointRadius: 3,
        borderWidth: 2
      },
      {
        label: `${deviceId} Phase (deg)`,
        yAxisID: 'phaseAxis',
        data: rows.map(row => ({ x: row.frequency, y: row.phase })),
        pointRadius: 3,
        borderWidth: 2,
        borderDash: [5, 4]
      }
    ];
  });
  bodeChart.update('none');

  nyquistChart.data.datasets = deviceIds.map(deviceId => {
    const rows = sortedByFrequency.filter(row => row.deviceId === deviceId);
    return {
      label: deviceId,
      data: rows.map(row => ({ x: row.real, y: -row.imag })),
      pointRadius: 4,
      borderWidth: 2,
      tension: 0.2
    };
  });
  nyquistChart.update('none');

  renderImpedanceTables();
}

function updateHumidityView() {
  const deviceIds = [...new Set(humidityRows.map(row => row.deviceId))];
  humidityChart.data.datasets = deviceIds.map(deviceId => {
    const rows = humidityRows.filter(row => row.deviceId === deviceId);
    return {
      label: `${deviceId} humidity (%)`,
      data: rows.map(row => ({ x: row.timeSec, y: row.humidity })),
      pointRadius: 3,
      borderWidth: 2
    };
  });
  humidityChart.update('none');
  renderHumidityTable();
}

function renderImpedanceTables() {
  const rows = impedanceRows.slice(-80).map(row => `
    <tr>
      <td>${formatTime(row.timestamp)}</td>
      <td>${row.deviceId}</td>
      <td>${row.frequency.toFixed(2)}</td>
      <td>${row.real.toFixed(3)}</td>
      <td>${row.imag.toFixed(3)}</td>
      <td>${row.magnitude.toFixed(3)}</td>
      <td>${row.phase.toFixed(2)}</td>
    </tr>
  `).join('');

  els.bodeTableBody.innerHTML = rows;

  els.nyquistTableBody.innerHTML = impedanceRows.slice(-80).map(row => `
    <tr>
      <td>${formatTime(row.timestamp)}</td>
      <td>${row.deviceId}</td>
      <td>${row.frequency.toFixed(2)}</td>
      <td>${row.real.toFixed(3)}</td>
      <td>${(-row.imag).toFixed(3)}</td>
      <td>${row.magnitude.toFixed(3)}</td>
      <td>${row.phase.toFixed(2)}</td>
    </tr>
  `).join('');
}

function renderHumidityTable() {
  els.humidityTableBody.innerHTML = humidityRows.slice(-80).map(row => `
    <tr>
      <td>${formatTime(row.timestamp)}</td>
      <td>${row.deviceId}</td>
      <td>${row.humidity.toFixed(2)}</td>
    </tr>
  `).join('');
}

function setView(viewName) {
  const views = {
    bode: els.bodeView,
    nyquist: els.nyquistView,
    humidity: els.humidityView
  };

  Object.entries(views).forEach(([name, view]) => {
    view.classList.toggle('active', name === viewName);
  });

  requestAnimationFrame(() => {
    bodeChart?.resize();
    nyquistChart?.resize();
    humidityChart?.resize();
  });
}

function setStatus(message) {
  els.collectionStatus.textContent = message;
}

async function pairNode(slot) {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth is not available in this browser.');
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICE_UUID] }]
  });

  nodes[slot].device = device;
  const button = slot === 'A' ? els.pairNodeAButton : els.pairNodeBButton;
  button.textContent = `${nodes[slot].label} Paired`;
  button.classList.add('paired');
  setStatus(`${nodes[slot].label} paired: ${device.name || device.id}`);
}

async function readNodePacket(slot) {
  const node = nodes[slot];
  if (!node.device) return null;

  setStatus(`Connecting to ${node.label}...`);
  const server = await node.device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);
  const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
  const value = await characteristic.readValue();
  const text = new TextDecoder().decode(value);
  node.device.gatt.disconnect();

  return {
    fallbackDeviceId: node.label,
    packet: JSON.parse(text)
  };
}

function demoPacket(deviceId) {
  const timestamp = Date.now();
  const frequencyOptions = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  const frequency = frequencyOptions[impedanceRows.length % frequencyOptions.length];
  const resistance = 1000;
  const capacitance = 0.000001;
  const omega = 2 * Math.PI * frequency;
  const imag = -1 / (omega * capacitance);

  return {
    timestamp,
    frequency,
    real: resistance,
    imag,
    deviceId,
    humidity: 52 + Math.sin(impedanceRows.length / 3) * 1.5
  };
}

async function collectOnce() {
  try {
    if (DEMO_MODE) {
      addPacket(demoPacket('ESP32-A'), 'ESP32-A');
      addPacket(demoPacket('ESP32-B'), 'ESP32-B');
      setStatus(`Demo packets received at ${new Date().toLocaleTimeString()}`);
      return;
    }

    const pairedSlots = Object.keys(nodes).filter(slot => nodes[slot].device);
    if (pairedSlots.length === 0) {
      throw new Error('Pair ESP32-A or ESP32-B before starting collection.');
    }

    for (const slot of pairedSlots) {
      const result = await readNodePacket(slot);
      if (result) addPacket(result.packet, result.fallbackDeviceId);
    }

    setStatus(`Last packet received at ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    collecting = false;
    stopCollectionCycle();
    setStatus(error.message);
    console.error(error);
  }
}

function startCollectionCycle() {
  if (collecting) return;

  collecting = true;
  els.startCycleButton.textContent = 'Stop Collection Cycle';

  const intervalMs = Number(els.collectionInterval.value);
  setStatus(`Collecting every ${intervalMs / 1000} seconds`);

  collectOnce();
  collectionTimer = window.setInterval(collectOnce, intervalMs);
}

function stopCollectionCycle() {
  collecting = false;
  els.startCycleButton.textContent = 'Start Collection Cycle';

  if (collectionTimer) {
    window.clearInterval(collectionTimer);
    collectionTimer = null;
  }
}

function toggleCollectionCycle() {
  if (collecting) {
    stopCollectionCycle();
    setStatus('Collection stopped');
  } else {
    startCollectionCycle();
  }
}

function resetCollectionTimerIfRunning() {
  if (!collecting) return;
  stopCollectionCycle();
  startCollectionCycle();
}

function initCharts() {
  bodeChart = new Chart(document.getElementById('bodeChart'), {
    type: 'line',
    data: {
      datasets: [
        { label: '|Z| (dB)', yAxisID: 'magnitudeAxis', data: [], pointRadius: 3, borderWidth: 2 },
        { label: 'Phase (deg)', yAxisID: 'phaseAxis', data: [], pointRadius: 3, borderWidth: 2 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      scales: {
        x: { type: 'logarithmic', title: { display: true, text: 'Frequency (Hz)' } },
        magnitudeAxis: { position: 'left', title: { display: true, text: '|Z| (dB)' } },
        phaseAxis: {
          position: 'right',
          title: { display: true, text: 'Phase (deg)' },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });

  nyquistChart = new Chart(document.getElementById('nyquistChart'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Nyquist', data: [], pointRadius: 4, borderWidth: 2, tension: 0.2 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Real (ohm)' } },
        y: { type: 'linear', title: { display: true, text: '-Imaginary (ohm)' } }
      }
    }
  });

  humidityChart = new Chart(document.getElementById('humidityChart'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Humidity (%)', data: [], pointRadius: 3, borderWidth: 2 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Time (s)' } },
        y: { title: { display: true, text: 'Humidity (%)' } }
      }
    }
  });
}

window.addEventListener('load', () => {
  initCharts();
  setView(els.viewMode.value);

  els.themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    els.themeToggle.textContent = document.body.classList.contains('dark')
      ? 'Light Mode'
      : 'Dark Mode';
  });

  els.viewMode.addEventListener('change', event => setView(event.target.value));
  els.startCycleButton.addEventListener('click', toggleCollectionCycle);
  els.pairNodeAButton.addEventListener('click', () => pairNode('A').catch(error => setStatus(error.message)));
  els.pairNodeBButton.addEventListener('click', () => pairNode('B').catch(error => setStatus(error.message)));
  els.collectionInterval.addEventListener('change', resetCollectionTimerIfRunning);

  if (DEMO_MODE) {
    setStatus('Demo mode ready');
  }
});
